/**
 * @fileoverview Dispatch engine for assigning orders to vehicles.
 *
 * Supports multiple pluggable dispatch strategies for algorithm comparison:
 * 1. 'nearest_available': Greedy proximity — assigns to the closest idle vehicle by distance.
 * 2. 'route_aware': Capacity-weighted greedy — penalizes heavily loaded vehicles and balances fleet utilization.
 * 3. 'cluster_zone': Geographic clustering — prioritizes vehicles stationed at the depot closest to the customer to minimize cross-city trips.
 */

import { Order, Vehicle, DispatchStrategy, RoutingAlgorithm } from '../world/types.js';
import { RoutingClient, RouteResult } from '../routing/client.js';
import { haversineDistance } from '../utils/geo.js';

export interface AssignmentResult {
  vehicleId: string;
  route: RouteResult;
  strategyUsed: DispatchStrategy;
}

export class Dispatcher {
  /**
   * Assign an order to the best available vehicle using the configured strategy.
   */
  public async assignOrder(
    order: Order,
    vehicles: Vehicle[],
    routingClient: RoutingClient,
    options: {
      strategy?: DispatchStrategy;
      routingAlgorithm?: RoutingAlgorithm;
    } = {}
  ): Promise<AssignmentResult | null> {
    const strategy = options.strategy || 'nearest_available';
    const routingAlgorithm = options.routingAlgorithm || 'contraction_hierarchies';

    // 1. Filter eligible idle vehicles with sufficient weight capacity
    const eligible = vehicles.filter(
      (v) => v.status === 'idle' && v.capacity_kg >= order.totalWeight_kg
    );

    if (eligible.length === 0) {
      return null;
    }

    // 2. Select vehicle based on dispatch strategy
    const chosenVehicle = this.selectVehicle(order, eligible, strategy);
    if (!chosenVehicle) return null;

    // 3. Calculate route with osm-pathfinder using selected routing algorithm
    try {
      const route = await routingClient.calculateRoute(
        order.pickupLocation,
        order.deliveryLocation,
        { algorithm: routingAlgorithm, metric: 'time' }
      );

      return {
        vehicleId: chosenVehicle.id,
        route,
        strategyUsed: strategy,
      };
    } catch (err) {
      console.error(
        `[Dispatcher] Failed to calculate route for order ${order.id}:`,
        (err as Error).message
      );
      return null;
    }
  }

  /**
   * Select best vehicle among eligible candidates using the chosen dispatch strategy.
   */
  private selectVehicle(
    order: Order,
    eligible: Vehicle[],
    strategy: DispatchStrategy
  ): Vehicle | null {
    switch (strategy) {
      case 'route_aware': {
        // Balances proximity and remaining vehicle capacity
        return [...eligible].sort((a, b) => {
          const distA = haversineDistance(a.position, order.pickupLocation);
          const distB = haversineDistance(b.position, order.pickupLocation);
          const loadRatioA = a.currentLoad_kg / a.capacity_kg;
          const loadRatioB = b.currentLoad_kg / b.capacity_kg;

          // Penalize vehicle with high load ratio
          const scoreA = distA * (1 + loadRatioA * 0.5);
          const scoreB = distB * (1 + loadRatioB * 0.5);
          return scoreA - scoreB;
        })[0];
      }

      case 'cluster_zone': {
        // Prioritize vehicles whose stationed depot is closer to the delivery destination
        return [...eligible].sort((a, b) => {
          const depotDistA = haversineDistance(a.position, order.deliveryLocation);
          const depotDistB = haversineDistance(b.position, order.deliveryLocation);
          const pickupDistA = haversineDistance(a.position, order.pickupLocation);
          const pickupDistB = haversineDistance(b.position, order.pickupLocation);

          const scoreA = depotDistA * 0.6 + pickupDistA * 0.4;
          const scoreB = depotDistB * 0.6 + pickupDistB * 0.4;
          return scoreA - scoreB;
        })[0];
      }

      case 'nearest_available':
      default: {
        // Pure greedy proximity to pickup point
        return [...eligible].sort((a, b) => {
          const distA = haversineDistance(a.position, order.pickupLocation);
          const distB = haversineDistance(b.position, order.pickupLocation);
          return distA - distB;
        })[0];
      }
    }
  }
}
