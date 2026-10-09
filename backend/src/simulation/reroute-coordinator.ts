import { Coordinate, RoadIncident, RoutingAlgorithm, Vehicle } from '../world/types.js';
import { World } from '../world/world.js';
import { RoutingClient } from '../routing/client.js';
import { calculateAvoidanceWaypoint } from '../utils/geo.js';
import { IncidentManager } from './incident-manager.js';

export interface RerouteOptions {
  reason?: string;
  avoidIncidents?: boolean;
}

export interface RerouteResult {
  success: boolean;
  message: string;
  vehicleId: string;
  oldRemainingDistanceM?: number;
  newDistanceM?: number;
  newDurationS?: number;
  rerouteCount?: number;
  queries?: number;
  queryTimeMs?: number;
  nodesVisited?: number;
  avoidedIncidentId?: string | null;
}

export class RerouteCoordinator {
  constructor(
    private readonly routingClient: RoutingClient,
    private readonly incidentManager: IncidentManager
  ) {}

  public async rerouteVehicle(
    vehicle: Vehicle,
    world: World,
    simTime: number,
    departureTime: string,
    routingAlgorithm: RoutingAlgorithm,
    options?: RerouteOptions
  ): Promise<RerouteResult> {
    if (vehicle.status !== 'en_route' && vehicle.status !== 'returning') {
      return {
        success: false,
        message: `Vehicle ${vehicle.id} is ${vehicle.status}. In-flight re-routing only applies to en_route or returning vehicles.`,
        vehicleId: vehicle.id,
      };
    }

    let targetDestination: Coordinate | null = null;
    if (vehicle.routeLegs && vehicle.routeLegs.length > 0) {
      const leg = vehicle.routeLegs[vehicle.currentLegIndex ?? 0];
      if (leg) targetDestination = leg.destination;
    } else if (vehicle.status === 'en_route' && vehicle.assignedOrderIds.length > 0) {
      const order = world.getOrder(vehicle.assignedOrderIds[0]);
      if (order) targetDestination = order.deliveryLocation;
    } else if (vehicle.status === 'returning') {
      const depot = world.getAllWarehouses().find((w) => w.id === vehicle.depotId);
      if (depot) targetDestination = depot.position;
    }

    if (!targetDestination && vehicle.routeGeometry.length > 0) {
      const last = vehicle.routeGeometry[vehicle.routeGeometry.length - 1];
      targetDestination = { lon: last[0], lat: last[1] };
    }

    if (!targetDestination) {
      return {
        success: false,
        message: `Could not resolve destination for vehicle ${vehicle.id}`,
        vehicleId: vehicle.id,
      };
    }

    const avoid = options?.avoidIncidents ?? true;
    const activeIncidents = this.incidentManager.getActiveIncidents();
    let blockingIncident: RoadIncident | undefined;

    if (avoid) {
      blockingIncident = activeIncidents.find((inc) =>
        this.incidentManager.isRouteIntersectingIncident(vehicle.routeGeometry, vehicle.routeProgress, inc)
      );
    }

    let newPath: [number, number][];
    let newDistanceM: number;
    let newDurationS: number;
    let queries = 0;
    let queryTimeMs = 0;
    let nodesVisited = 0;

    if (blockingIncident) {
      const detourPoint = calculateAvoidanceWaypoint(
        vehicle.position,
        targetDestination,
        blockingIncident.position,
        blockingIncident.radiusM
      );

      try {
        const leg1 = await this.routingClient.calculateRoute(vehicle.position, detourPoint, {
          algorithm: routingAlgorithm,
          metric: 'time',
          departureTime,
        });
        const leg2 = await this.routingClient.calculateRoute(detourPoint, targetDestination, {
          algorithm: routingAlgorithm,
          metric: 'time',
          departureTime,
        });

        newPath = [...leg1.path, ...leg2.path.slice(1)];
        newDistanceM = leg1.distanceM + leg2.distanceM;
        newDurationS = leg1.durationS + leg2.durationS;
        queries = 2;
        queryTimeMs = (leg1.queryTimeMs || 0) + (leg2.queryTimeMs || 0);
        nodesVisited = (leg1.nodesVisited || 0) + (leg2.nodesVisited || 0);
      } catch {
        const direct = await this.routingClient.calculateRoute(vehicle.position, targetDestination, {
          algorithm: routingAlgorithm,
          metric: 'time',
          departureTime,
        });
        newPath = direct.path;
        newDistanceM = direct.distanceM;
        newDurationS = direct.durationS;
        queries = 1;
        queryTimeMs = direct.queryTimeMs || 0;
        nodesVisited = direct.nodesVisited || 0;
      }
    } else {
      const direct = await this.routingClient.calculateRoute(vehicle.position, targetDestination, {
        algorithm: routingAlgorithm,
        metric: 'time',
        departureTime,
      });
      newPath = direct.path;
      newDistanceM = direct.distanceM;
      newDurationS = direct.durationS;
      queries = 1;
      queryTimeMs = direct.queryTimeMs || 0;
      nodesVisited = direct.nodesVisited || 0;
    }

    const oldRemainingM = Math.round(vehicle.routeDistanceM * (1 - vehicle.routeProgress));
    vehicle.routeGeometry = newPath;
    vehicle.routeDistanceM = newDistanceM;
    vehicle.routeDurationS = newDurationS;
    vehicle.routeProgress = 0;
    vehicle.rerouteCount = (vehicle.rerouteCount || 0) + 1;
    vehicle.lastReroutedAt = simTime;
    vehicle.rerouteReason =
      options?.reason || (blockingIncident ? `avoid_${blockingIncident.type}` : 'in_flight_optimization');

    if (vehicle.routeLegs && vehicle.routeLegs[vehicle.currentLegIndex ?? 0]) {
      const leg = vehicle.routeLegs[vehicle.currentLegIndex ?? 0];
      leg.path = newPath;
      leg.distanceM = newDistanceM;
      leg.durationS = newDurationS;
    }

    return {
      success: true,
      message: `Vehicle ${vehicle.id} dynamically re-routed. New path: ${(newDistanceM / 1000).toFixed(2)}km, ${(newDurationS / 60).toFixed(1)}min.`,
      vehicleId: vehicle.id,
      oldRemainingDistanceM: oldRemainingM,
      newDistanceM,
      newDurationS,
      rerouteCount: vehicle.rerouteCount,
      queries,
      queryTimeMs,
      nodesVisited,
      avoidedIncidentId: blockingIncident ? blockingIncident.id : null,
    };
  }

  public async rerouteFleet(
    vehicles: Vehicle[],
    world: World,
    simTime: number,
    departureTime: string,
    routingAlgorithm: RoutingAlgorithm,
    options?: RerouteOptions
  ): Promise<{ reroutedCount: number; vehicles: string[]; totalQueries: number; totalQueryTimeMs: number; totalNodesVisited: number }> {
    const enRoute = vehicles.filter((v) => v.status === 'en_route' || v.status === 'returning');
    if (enRoute.length === 0) {
      return { reroutedCount: 0, vehicles: [], totalQueries: 0, totalQueryTimeMs: 0, totalNodesVisited: 0 };
    }

    const results = await Promise.allSettled(
      enRoute.map((v) => this.rerouteVehicle(v, world, simTime, departureTime, routingAlgorithm, options))
    );

    const successfulIds: string[] = [];
    let totalQueries = 0;
    let totalQueryTimeMs = 0;
    let totalNodesVisited = 0;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === 'fulfilled' && res.value.success) {
        successfulIds.push(enRoute[i].id);
        totalQueries += res.value.queries || 0;
        totalQueryTimeMs += res.value.queryTimeMs || 0;
        totalNodesVisited += res.value.nodesVisited || 0;
      }
    }

    return {
      reroutedCount: successfulIds.length,
      vehicles: successfulIds,
      totalQueries,
      totalQueryTimeMs,
      totalNodesVisited,
    };
  }
}
