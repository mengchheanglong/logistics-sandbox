import { RoutingAlgorithm, Vehicle } from '../world/types.js';
import { World } from '../world/world.js';
import { SimulationClock } from './clock.js';
import { RoutingClient } from '../routing/client.js';
import { IPersistenceLayer, TelemetryPing } from '../persistence/index.js';
import { PredictiveAiEngine } from '../dispatch/predictive-ai.js';
import { haversineDistance, interpolateAlongPath } from '../utils/geo.js';

export type EventEmitFn = (
  entityType: string,
  entityId: string,
  eventType: string,
  payload: Record<string, unknown>
) => void;

export interface FleetAdvancerOptions {
  routingClient: RoutingClient;
  persistence: IPersistenceLayer;
  predictiveAiEngine: PredictiveAiEngine;
  emitEvent: EventEmitFn;
}

export class FleetAdvancer {
  private cumulativeDistanceKm: number = 0;

  constructor(private readonly options: FleetAdvancerOptions) {}

  public getCumulativeDistanceKm(): number {
    return this.cumulativeDistanceKm;
  }

  public resetCumulativeDistance(): void {
    this.cumulativeDistanceKm = 0;
  }

  public updateVehicles(
    world: World,
    clock: SimulationClock,
    deltaSimMs: number,
    trafficMultiplier: number,
    tickCounter: number,
    simulationId: string,
    activeRoutingAlgorithm: RoutingAlgorithm,
    onQueryRecorded?: (queries: number, queryTimeMs: number, nodesVisited: number) => void
  ): void {
    if (clock.isPaused || deltaSimMs <= 0) return;
    const simTime = clock.getSimulatedTime();

    // 1. Monitor SLA deadlines
    for (const order of world.getAllOrders()) {
      if (order.status === 'delivered' || order.status === 'cancelled') continue;
      if (order.slaDeadline) {
        if (simTime > order.slaDeadline) {
          if (order.slaStatus !== 'breached') {
            order.slaStatus = 'breached';
            this.options.emitEvent('order', order.id, 'order.sla.breached', {
              orderId: order.id,
              priority: order.priority,
              deadline: order.slaDeadline,
              simTime,
            });
          }
        } else if (order.slaDeadline - simTime < 10 * 60 * 1000) {
          order.slaStatus = 'at_risk';
        } else {
          order.slaStatus = 'on_time';
        }
      }
    }

    // 2. Advance vehicles
    for (const vehicle of world.getAllVehicles()) {
      if (vehicle.status === 'en_route' || vehicle.status === 'returning') {
        this.advanceVehicle(
          vehicle,
          world,
          clock,
          deltaSimMs,
          trafficMultiplier,
          tickCounter,
          simulationId,
          activeRoutingAlgorithm,
          onQueryRecorded
        );
      }
    }
  }

  public advanceVehicle(
    vehicle: Vehicle,
    world: World,
    clock: SimulationClock,
    deltaSimMs: number,
    trafficMultiplier: number,
    tickCounter: number,
    simulationId: string,
    activeRoutingAlgorithm: RoutingAlgorithm,
    onQueryRecorded?: (queries: number, queryTimeMs: number, nodesVisited: number) => void
  ): void {
    if (clock.isPaused || deltaSimMs <= 0) return;
    if (vehicle.routeGeometry.length < 2 || vehicle.routeDurationS <= 0) {
      this.completeVehicleRoute(vehicle, world, clock, activeRoutingAlgorithm, onQueryRecorded);
      return;
    }

    const deltaSimS = deltaSimMs / 1000;
    const effectiveSpeedFactor = 1 / Math.max(0.2, trafficMultiplier);
    const progressIncrement = (deltaSimS / vehicle.routeDurationS) * effectiveSpeedFactor;
    vehicle.routeProgress = Math.min(1, vehicle.routeProgress + progressIncrement);

    const newPosition = interpolateAlongPath(vehicle.routeGeometry, vehicle.routeProgress);
    vehicle.position = newPosition;
    vehicle.speed_kmh = (vehicle.routeDistanceM / vehicle.routeDurationS) * 3.6 * effectiveSpeedFactor;

    if (!vehicle.trailHistory) vehicle.trailHistory = [];
    const simTime = clock.getSimulatedTime();
    const lastTrail = vehicle.trailHistory[vehicle.trailHistory.length - 1];
    if (
      !lastTrail ||
      haversineDistance(newPosition, { lat: lastTrail[1], lon: lastTrail[0] }) >= 15 ||
      simTime - lastTrail[2] >= 1000
    ) {
      vehicle.trailHistory.push([newPosition.lon, newPosition.lat, simTime]);
      if (vehicle.trailHistory.length > 35) {
        vehicle.trailHistory.shift();
      }
    }

    if (tickCounter % 5 === 0) {
      this.options.emitEvent('vehicle', vehicle.id, 'vehicle.position.updated', {
        lat: newPosition.lat,
        lon: newPosition.lon,
        progress: vehicle.routeProgress,
        speed_kmh: vehicle.speed_kmh,
      });

      const ping: TelemetryPing = {
        rider_id: vehicle.driverId,
        ping_timestamp: simTime,
        ping_date: new Date(simTime).toISOString().split('T')[0],
        lat: newPosition.lat,
        lon: newPosition.lon,
        speed_kmh: vehicle.speed_kmh,
        battery_level: 92,
        status: vehicle.status,
        simulation_id: simulationId,
      };
      this.options.persistence.telemetry.savePing(ping).catch((error: unknown) => {
        this.options.emitEvent('vehicle', vehicle.id, 'telemetry.storage.failed', {
          source: 'simulated',
          durable: false,
          stored: false,
          error: error instanceof Error ? error.message : 'Telemetry storage failed',
        });
      });
      this.options.persistence.vehicles.saveVehicleState(vehicle).catch(() => {});
    }

    if (vehicle.routeProgress >= 1) {
      this.completeVehicleRoute(vehicle, world, clock, activeRoutingAlgorithm, onQueryRecorded);
    }
  }

  public completeVehicleRoute(
    vehicle: Vehicle,
    world: World,
    clock: SimulationClock,
    activeRoutingAlgorithm: RoutingAlgorithm,
    onQueryRecorded?: (queries: number, queryTimeMs: number, nodesVisited: number) => void
  ): void {
    const simTime = clock.getSimulatedTime();

    // 1. Multi-stop tour progressive execution
    if (vehicle.routeLegs && vehicle.routeLegs.length > 0) {
      const legIndex = vehicle.currentLegIndex ?? 0;
      const leg = vehicle.routeLegs[legIndex];

      if (leg && leg.orderId) {
        const order = world.getOrder(leg.orderId);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = simTime;
          vehicle.currentLoad_kg = Math.max(0, vehicle.currentLoad_kg - order.totalWeight_kg);
          this.options.persistence.orders.updateOrderStatus(order.id, 'delivered', simTime).catch(() => {});
          this.options.persistence.relationships.updateOrderStatus(order.id, 'delivered').catch(() => {});

          this.options.emitEvent('order', order.id, 'order.delivered', {
            vehicleId: vehicle.id,
            deliveredAt: simTime,
            legIndex: legIndex + 1,
            totalLegs: vehicle.routeLegs.length,
          });
        }
        vehicle.assignedOrderIds = vehicle.assignedOrderIds.filter((id) => id !== leg.orderId);
      }

      if (leg) this.cumulativeDistanceKm += leg.distanceM / 1000;
      const nextIndex = legIndex + 1;
      if (nextIndex < vehicle.routeLegs.length) {
        vehicle.currentLegIndex = nextIndex;
        const nextLeg = vehicle.routeLegs[nextIndex];
        vehicle.routeGeometry = nextLeg.path;
        vehicle.routeDistanceM = nextLeg.distanceM;
        vehicle.routeDurationS = nextLeg.durationS;
        vehicle.routeProgress = 0;
        vehicle.status = nextLeg.orderId ? 'en_route' : 'returning';

        this.options.emitEvent('vehicle', vehicle.id, 'vehicle.leg.advanced', {
          currentLegIndex: nextIndex + 1,
          totalLegs: vehicle.routeLegs.length,
          isReturnLeg: !nextLeg.orderId,
        });
        return;
      } else {
        this.resetVehicleToIdle(vehicle);
        this.options.emitEvent('vehicle', vehicle.id, 'vehicle.tour.completed', {
          depotId: vehicle.depotId,
        });
        return;
      }
    }

    // 2. Standard single-order delivery
    if (vehicle.status === 'en_route') {
      for (const orderId of vehicle.assignedOrderIds) {
        const order = world.getOrder(orderId);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = simTime;
          if (order.slaDeadline && simTime <= order.slaDeadline) {
            this.options.predictiveAiEngine.recordAvertedBreach();
          }
          this.options.persistence.orders.updateOrderStatus(orderId, 'delivered', simTime).catch(() => {});
          this.options.persistence.relationships.updateOrderStatus(orderId, 'delivered').catch(() => {});

          this.options.emitEvent('order', orderId, 'order.delivered', {
            vehicleId: vehicle.id,
            deliveredAt: simTime,
          });
        }
      }

      this.options.emitEvent('vehicle', vehicle.id, 'vehicle.arrived', {
        orderIds: vehicle.assignedOrderIds,
      });

      if (vehicle.currentRouteId?.startsWith('REBAL-') || vehicle.assignedOrderIds.length === 0) {
        this.resetVehicleToIdle(vehicle);
        this.options.emitEvent('vehicle', vehicle.id, 'vehicle.rebalance.completed', {
          position: vehicle.position,
        });
        return;
      }

      const depot = world.getAllWarehouses().find((w) => w.id === vehicle.depotId);
      if (depot) {
        this.options.routingClient
          .calculateRoute(vehicle.position, depot.position, {
            algorithm: activeRoutingAlgorithm,
            metric: 'time',
          })
          .then((returnRoute) => {
            if (onQueryRecorded) {
              onQueryRecorded(1, returnRoute.queryTimeMs || 0, returnRoute.nodesVisited || 0);
            }
            vehicle.status = 'returning';
            vehicle.routeGeometry = returnRoute.path;
            vehicle.routeProgress = 0;
            vehicle.routeDistanceM = returnRoute.distanceM;
            vehicle.routeDurationS = returnRoute.durationS;
            vehicle.assignedOrderIds = [];
            vehicle.currentLoad_kg = 0;
            vehicle.currentRouteId = `RET-${vehicle.id}`;
            vehicle.trailHistory = [[vehicle.position.lon, vehicle.position.lat, clock.getSimulatedTime()]];
          })
          .catch(() => {
            this.resetVehicleToIdle(vehicle);
          });
      } else {
        this.resetVehicleToIdle(vehicle);
      }
    } else if (vehicle.status === 'returning') {
      this.resetVehicleToIdle(vehicle);
      this.options.emitEvent('vehicle', vehicle.id, 'vehicle.returned_to_depot', {
        depotId: vehicle.depotId,
      });
    }
  }

  public resetVehicleToIdle(vehicle: Vehicle): void {
    if (vehicle.routeDistanceM > 0 && vehicle.routeProgress >= 0.9) {
      this.cumulativeDistanceKm += vehicle.routeDistanceM / 1000;
    }
    vehicle.status = 'idle';
    vehicle.routeGeometry = [];
    vehicle.routeProgress = 0;
    vehicle.routeDistanceM = 0;
    vehicle.routeDurationS = 0;
    vehicle.currentRouteId = null;
    vehicle.assignedOrderIds = [];
    vehicle.currentLoad_kg = 0;
    vehicle.speed_kmh = 0;
    vehicle.routeLegs = [];
    vehicle.currentLegIndex = 0;
    vehicle.totalLegsCount = 0;
    vehicle.trailHistory = [];
  }
}
