/**
 * @fileoverview Multi-Stop Tour & Vehicle Routing Problem (VRP) Solver.
 *
 * Implements delivery batching and route sequencing for multi-drop delivery tours:
 * 1. Batches multiple pending orders onto a single vehicle up to capacity
 * 2. Sequences delivery stops using a Nearest-Neighbor TSP heuristic
 * 3. Calls osm-pathfinder for each leg between consecutive stops
 * 4. Appends a return leg back to the origin depot
 */

import { Order, Vehicle, RouteLeg, RoutingAlgorithm, Coordinate } from '../world/types.js';
import { RoutingClient } from '../routing/client.js';
import { haversineDistance } from '../utils/geo.js';

export interface MultiStopTourResult {
  vehicleId: string;
  orderIds: string[];
  legs: RouteLeg[];
  totalDistanceM: number;
  totalDurationS: number;
  totalQueries: number;
  totalQueryTimeMs: number;
  totalNodesVisited: number;
  totalLoadKg: number;
}

export class VrpTourSolver {
  /**
   * Determine max stops based on vehicle type.
   */
  public getMaxStopsForVehicle(vehicleOrType: Vehicle | string): number {
    const type = typeof vehicleOrType === 'string' ? vehicleOrType : vehicleOrType.type;
    switch (type) {
      case 'motorcycle':
        return 3;
      case 'van':
        return 6;
      case 'truck':
      default:
        return 8;
    }
  }

  /**
   * Solve and construct a multi-stop delivery tour for an idle vehicle.
   */
  public async planTour(
    vehicle: Vehicle,
    pendingOrders: Order[],
    depotPosition: Coordinate,
    routingClient: RoutingClient,
    routingAlgorithm: RoutingAlgorithm = 'contraction_hierarchies'
  ): Promise<MultiStopTourResult | null> {
    const maxStops = this.getMaxStopsForVehicle(vehicle.type);

    // 1. Filter orders that originate from or are near the vehicle's depot
    const depotOrders = pendingOrders.filter(
      (o) => o.status === 'pending'
    );

    if (depotOrders.length === 0) return null;

    // 2. Earliest Deadline First (EDF): prioritize orders with tighter SLA deadlines
    const sortedDepotOrders = [...depotOrders].sort(
      (a, b) => (a.slaDeadline || Infinity) - (b.slaDeadline || Infinity)
    );

    // Select a batch of orders that fit within the vehicle's capacity
    const selectedOrders: Order[] = [];
    let currentLoadKg = 0;

    for (const order of sortedDepotOrders) {
      if (selectedOrders.length >= maxStops) break;
      if (currentLoadKg + order.totalWeight_kg <= vehicle.capacity_kg) {
        selectedOrders.push(order);
        currentLoadKg += order.totalWeight_kg;
      }
    }

    if (selectedOrders.length === 0) return null;

    // 3. Sequence delivery stops using Nearest-Neighbor TSP heuristic
    const sequencedOrders = this.sequenceStops(vehicle.position, selectedOrders);

    // 4. Compute road paths for each leg via osm-pathfinder
    const legs: RouteLeg[] = [];
    let currentPos = vehicle.position;
    let totalDistanceM = 0;
    let totalDurationS = 0;
    let totalQueries = 0;
    let totalQueryTimeMs = 0;
    let totalNodesVisited = 0;

    // Deliveries legs: Stop_i -> Stop_i+1
    for (const order of sequencedOrders) {
      try {
        const route = await routingClient.calculateRoute(
          currentPos,
          order.deliveryLocation,
          { algorithm: routingAlgorithm, metric: 'time' }
        );

        legs.push({
          orderId: order.id,
          destination: order.deliveryLocation,
          path: route.path,
          distanceM: route.distanceM,
          durationS: route.durationS,
        });

        totalDistanceM += route.distanceM;
        totalDurationS += route.durationS;
        totalQueries++;
        totalQueryTimeMs += route.queryTimeMs || 0;
        totalNodesVisited += route.nodesVisited || 0;

        currentPos = order.deliveryLocation;
      } catch (err) {
        console.warn(`[VrpTourSolver] Failed to calculate leg for order ${order.id}:`, (err as Error).message);
        return null;
      }
    }

    // Return leg: Last customer -> Origin Depot
    try {
      const returnRoute = await routingClient.calculateRoute(
        currentPos,
        depotPosition,
        { algorithm: routingAlgorithm, metric: 'time' }
      );

      legs.push({
        orderId: undefined, // Return to depot leg
        destination: depotPosition,
        path: returnRoute.path,
        distanceM: returnRoute.distanceM,
        durationS: returnRoute.durationS,
      });

      totalDistanceM += returnRoute.distanceM;
      totalDurationS += returnRoute.durationS;
      totalQueries++;
      totalQueryTimeMs += returnRoute.queryTimeMs || 0;
      totalNodesVisited += returnRoute.nodesVisited || 0;
    } catch {
      // If return route calculation fails, create a 2-point direct leg
      legs.push({
        orderId: undefined,
        destination: depotPosition,
        path: [
          [currentPos.lon, currentPos.lat],
          [depotPosition.lon, depotPosition.lat],
        ],
        distanceM: haversineDistance(currentPos, depotPosition),
        durationS: 180,
      });
    }

    return {
      vehicleId: vehicle.id,
      orderIds: sequencedOrders.map((o) => o.id),
      legs,
      totalDistanceM,
      totalDurationS,
      totalQueries,
      totalQueryTimeMs,
      totalNodesVisited,
      totalLoadKg: currentLoadKg,
    };
  }

  /**
   * Sort orders into a nearest-neighbor TSP sequence starting from startLocation.
   */
  private sequenceStops(startLocation: Coordinate, orders: Order[]): Order[] {
    const unvisited = [...orders];
    const sequence: Order[] = [];
    let currentPoint = startLocation;

    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const dist = haversineDistance(currentPoint, unvisited[i].deliveryLocation);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIndex = i;
        }
      }

      const nextOrder = unvisited.splice(nearestIndex, 1)[0];
      sequence.push(nextOrder);
      currentPoint = nextOrder.deliveryLocation;
    }

    return sequence;
  }
}
