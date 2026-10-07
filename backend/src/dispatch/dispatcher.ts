/**
 * @fileoverview Dispatch engine for assigning orders to vehicles.
 *
 * V1 implements a simple nearest-available-vehicle strategy:
 * 1. Filter vehicles that are idle and have sufficient capacity
 * 2. Find the nearest vehicle by haversine distance
 * 3. Calculate the actual route via osm-pathfinder
 * 4. Return the assignment with route geometry
 *
 * Future versions will support pluggable dispatch strategies:
 * - Route-aware greedy
 * - Multi-stop optimization
 * - Vehicle Routing Problem (VRP)
 * - VRP with Time Windows (VRPTW)
 */

import { Order, Vehicle } from '../world/types.js';
import { RoutingClient, RouteResult } from '../routing/client.js';
import { haversineDistance } from '../utils/geo.js';

/** Result of a successful order assignment */
export interface AssignmentResult {
  /** ID of the vehicle assigned to the order */
  vehicleId: string;
  /** Calculated route from vehicle position to delivery location */
  route: RouteResult;
}

export class Dispatcher {
  /**
   * Attempt to assign an order to the best available vehicle.
   *
   * Strategy (V1 — nearest available):
   * 1. Filter idle vehicles with capacity >= order weight
   * 2. Sort by haversine distance to pickup location
   * 3. Try the nearest vehicle first
   * 4. Calculate route via routing client (pickup → delivery)
   * 5. Return assignment result
   *
   * @returns Assignment result, or null if no vehicle is available
   */
  public async assignOrder(
    order: Order,
    vehicles: Vehicle[],
    routingClient: RoutingClient
  ): Promise<AssignmentResult | null> {
    // Filter eligible vehicles: must be idle and have capacity
    const eligible = vehicles.filter(
      (v) => v.status === 'idle' && v.capacity_kg >= order.totalWeight_kg
    );

    if (eligible.length === 0) {
      return null;
    }

    // Sort by haversine distance to the pickup location (depot)
    const sorted = eligible
      .map((v) => ({
        vehicle: v,
        distance: haversineDistance(v.position, order.pickupLocation),
      }))
      .sort((a, b) => a.distance - b.distance);

    // Try to calculate route for the nearest vehicle
    // Route goes from pickup (depot) to delivery (customer)
    const nearest = sorted[0].vehicle;

    try {
      const route = await routingClient.calculateRoute(
        order.pickupLocation,
        order.deliveryLocation
      );

      return {
        vehicleId: nearest.id,
        route,
      };
    } catch (err) {
      console.error(
        `[Dispatcher] Failed to calculate route for order ${order.id}:`,
        (err as Error).message
      );
      return null;
    }
  }
}
