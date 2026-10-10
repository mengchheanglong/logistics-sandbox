import { describe, it, expect, vi } from 'vitest';
import { VrpTourSolver } from '../src/dispatch/vrp.js';
import { RoutingClient } from '../src/routing/client.js';
import type { Vehicle, Order } from '../src/world/types.js';

describe('VrpTourSolver', () => {
  const solver = new VrpTourSolver();

  it('determines appropriate max stops based on vehicle type', () => {
    const truck: Partial<Vehicle> = { type: 'truck' };
    const van: Partial<Vehicle> = { type: 'van' };
    const moto: Partial<Vehicle> = { type: 'motorcycle' };

    // Access private method via any
    expect(solver.getMaxStopsForVehicle(truck as Vehicle)).toBe(8);
    expect(solver.getMaxStopsForVehicle(van as Vehicle)).toBe(6);
    expect(solver.getMaxStopsForVehicle(moto as Vehicle)).toBe(3);
  });

  it('sequences orders using nearest-neighbor heuristic', () => {
    const origin = { lat: 11.55, lon: 104.90 };
    const orders: Order[] = [
      {
        id: 'O-FAR',
        customerId: 'C1',
        status: 'pending',
        items: [],
        totalWeight_kg: 10,
        pickupLocation: origin,
        deliveryLocation: { lat: 11.60, lon: 104.95 }, // furthest
        assignedVehicleId: null,
        createdAt: 0,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      },
      {
        id: 'O-CLOSE',
        customerId: 'C2',
        status: 'pending',
        items: [],
        totalWeight_kg: 10,
        pickupLocation: origin,
        deliveryLocation: { lat: 11.552, lon: 104.902 }, // closest to origin
        assignedVehicleId: null,
        createdAt: 0,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      },
      {
        id: 'O-MID',
        customerId: 'C3',
        status: 'pending',
        items: [],
        totalWeight_kg: 10,
        pickupLocation: origin,
        deliveryLocation: { lat: 11.56, lon: 104.91 }, // closer to O-CLOSE than O-FAR
        assignedVehicleId: null,
        createdAt: 0,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      },
    ];

    const solverAny = solver as any;
    const sequenced = solverAny.sequenceStops(origin, orders);

    expect(sequenced.length).toBe(3);
    expect(sequenced[0].id).toBe('O-CLOSE');
    expect(sequenced[1].id).toBe('O-MID');
    expect(sequenced[2].id).toBe('O-FAR');
  });

  it('constructs a multi-stop tour with return leg to depot', async () => {
    const depot = { lat: 11.568, lon: 104.922 };
    const vehicle: Vehicle = {
      id: 'V-001',
      name: 'Van 1',
      type: 'van',
      status: 'idle',
      driverId: 'D-001',
      position: depot,
      speed_kmh: 0,
      capacity_kg: 500,
      currentLoad_kg: 0,
      currentRouteId: null,
      assignedOrderIds: [],
      routeGeometry: [],
      routeProgress: 0,
      routeDistanceM: 0,
      routeDurationS: 0,
      depotId: 'DEPOT-A',
    };

    const orders: Order[] = [
      {
        id: 'O-1',
        customerId: 'C1',
        status: 'pending',
        items: [],
        totalWeight_kg: 20,
        pickupLocation: depot,
        deliveryLocation: { lat: 11.57, lon: 104.925 },
        assignedVehicleId: null,
        createdAt: 0,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      },
      {
        id: 'O-2',
        customerId: 'C2',
        status: 'pending',
        items: [],
        totalWeight_kg: 30,
        pickupLocation: depot,
        deliveryLocation: { lat: 11.575, lon: 104.93 },
        assignedVehicleId: null,
        createdAt: 0,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      },
    ];

    // Mock routing client
    const routingClient = new RoutingClient('http://localhost:8000');
    vi.spyOn(routingClient, 'calculateRoute').mockImplementation(async (start, end) => ({
      path: [
        [start.lon, start.lat],
        [end.lon, end.lat],
      ],
      distanceM: 1200,
      durationS: 180,
      algorithm: 'contraction_hierarchies',
      nodesVisited: 12,
      queryTimeMs: 0.1,
    }));

    const tour = await solver.planTour(vehicle, orders, depot, routingClient);

    expect(tour).not.toBeNull();
    if (!tour) return;

    expect(tour.orderIds).toEqual(['O-1', 'O-2']);
    expect(tour.totalLoadKg).toBe(50);
    // 2 customer delivery legs + 1 return to depot leg = 3 legs
    expect(tour.legs.length).toBe(3);
    expect(tour.legs[0].orderId).toBe('O-1');
    expect(tour.legs[1].orderId).toBe('O-2');
    expect(tour.legs[2].orderId).toBeUndefined(); // Final return leg
    expect(tour.legs[2].destination).toEqual(depot);
    expect(tour.totalQueries).toBe(3);
  });
});
