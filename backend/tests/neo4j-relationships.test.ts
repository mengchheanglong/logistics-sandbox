import { describe, it, expect, beforeEach } from 'vitest';
import { Neo4jRelationshipRepository } from '../src/persistence/neo4j/relationship.repository.js';
import { Warehouse, Vehicle, Driver, Order } from '../src/world/types.js';

describe('Phase 3: Neo4j Logistics Relationship Graph & Incident Impact Analysis', () => {
  let repo: Neo4jRelationshipRepository;

  const mockWarehouses: Warehouse[] = [
    {
      id: 'WH-CENTRAL',
      name: 'Phnom Penh Central Distribution Hub',
      position: { lat: 11.568, lon: 104.922 },
      capacity: 5000,
      currentStock: 3500,
      type: 'warehouse',
      status: 'open',
    },
    {
      id: 'DEPOT-A',
      name: 'Depot A (Daun Penh)',
      position: { lat: 11.572, lon: 104.925 },
      capacity: 1000,
      currentStock: 450,
      type: 'depot',
      status: 'open',
    },
  ];

  const mockDrivers: Driver[] = [
    {
      id: 'DRV-001',
      name: 'Chan Vuthy',
      status: 'on_shift',
      vehicleId: 'VEH-001',
      shifStart: 0,
      shiftEnd: 28800000,
    },
  ];

  const mockVehicles: Vehicle[] = [
    {
      id: 'VEH-001',
      name: 'Van 1',
      type: 'van',
      status: 'idle',
      driverId: 'DRV-001',
      depotId: 'DEPOT-A',
      position: { lat: 11.572, lon: 104.925 },
      capacity_kg: 500,
      currentLoad_kg: 0,
      speed_kmh: 30,
      routeGeometry: [],
      routeProgress: 0,
      routeDistanceM: 0,
      routeDurationS: 0,
      currentRouteId: null,
      assignedOrderIds: [],
    },
  ];

  beforeEach(() => {
    repo = new Neo4jRelationshipRepository();
  });

  it('synchronizes supply chain topology (Warehouses -> Depots -> Vehicles -> Drivers)', async () => {
    await repo.syncTopology(mockWarehouses, mockVehicles, mockDrivers);
    const topology = await repo.getGraphTopology();

    expect(topology.nodes.length).toBeGreaterThanOrEqual(4); // WH, Depot, Driver, Vehicle
    expect(topology.relationships.length).toBeGreaterThanOrEqual(3); // FEEDS, DISPATCHES, ASSIGNED_TO

    const feedsEdge = topology.relationships.find((r) => r.type === 'FEEDS');
    expect(feedsEdge).toBeDefined();
    expect(feedsEdge?.from).toBe('WH-CENTRAL');
    expect(feedsEdge?.to).toBe('DEPOT-A');

    const dispatchesEdge = topology.relationships.find((r) => r.type === 'DISPATCHES');
    expect(dispatchesEdge).toBeDefined();
    expect(dispatchesEdge?.from).toBe('DEPOT-A');
    expect(dispatchesEdge?.to).toBe('VEH-001');

    const assignedEdge = topology.relationships.find((r) => r.type === 'ASSIGNED_TO');
    expect(assignedEdge).toBeDefined();
    expect(assignedEdge?.from).toBe('VEH-001');
    expect(assignedEdge?.to).toBe('DRV-001');
  });

  it('links active orders and customer recipients to delivery vehicles', async () => {
    await repo.syncTopology(mockWarehouses, mockVehicles, mockDrivers);

    const mockOrder: Order = {
      id: 'ORD-TEST-99',
      customerId: 'C0457',
      status: 'assigned',
      priority: 'express',
      totalWeight_kg: 8.5,
      items: [{ name: 'Fragrant Rice', quantity: 2 }],
      pickupLocation: { lat: 11.572, lon: 104.925 },
      deliveryLocation: { lat: 11.554, lon: 104.918 },
      assignedVehicleId: 'VEH-001',
      createdAt: 1000,
      assignedAt: 2000,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: 5000,
    };

    await repo.syncOrder(mockOrder, 'VEH-001');
    const topology = await repo.getGraphTopology();

    const carriesEdge = topology.relationships.find((r) => r.type === 'CARRIES');
    expect(carriesEdge).toBeDefined();
    expect(carriesEdge?.from).toBe('VEH-001');
    expect(carriesEdge?.to).toBe('ORD-TEST-99');

    const deliversEdge = topology.relationships.find((r) => r.type === 'DELIVERS_TO');
    expect(deliversEdge).toBeDefined();
    expect(deliversEdge?.from).toBe('ORD-TEST-99');
    expect(deliversEdge?.to).toBe('C0457');
  });

  it('runs cascade failure impact analysis on vehicle breakdown', async () => {
    await repo.syncTopology(mockWarehouses, mockVehicles, mockDrivers);

    const mockOrder: Order = {
      id: 'ORD-IMPACT-01',
      customerId: 'C0457',
      status: 'in_transit',
      priority: 'urgent',
      totalWeight_kg: 12.0,
      items: [{ name: 'High-Value Electronics', quantity: 1 }],
      pickupLocation: { lat: 11.572, lon: 104.925 },
      deliveryLocation: { lat: 11.554, lon: 104.918 },
      assignedVehicleId: 'VEH-001',
      createdAt: 1000,
      assignedAt: 2000,
      pickedUpAt: 3000,
      deliveredAt: null,
      estimatedDeliveryTime: 6000,
    };

    await repo.syncOrder(mockOrder, 'VEH-001');

    const impact = await repo.getImpactAnalysis('vehicle', 'VEH-001');

    expect(impact.targetEntity.id).toBe('VEH-001');
    expect(impact.impactedVehicles.length).toBe(1);
    expect(impact.impactedVehicles[0].driverName).toBe('Chan Vuthy');
    expect(impact.impactedOrders.length).toBe(1);
    expect(impact.impactedOrders[0].id).toBe('ORD-IMPACT-01');
    expect(impact.impactedCustomers.length).toBe(1);
    expect(impact.impactedCustomers[0].id).toBe('C0457');
    expect(impact.totalOrdersAtRisk).toBe(1);
    expect(impact.totalPayloadKg).toBe(12.0);
    expect(impact.cypherQuery).toContain('MATCH (v:Vehicle {id: \'VEH-001\'})');
  });

  it('runs cascade failure impact analysis on depot closure', async () => {
    await repo.syncTopology(mockWarehouses, mockVehicles, mockDrivers);

    const mockOrder: Order = {
      id: 'ORD-DEPOT-01',
      customerId: 'C0457',
      status: 'assigned',
      priority: 'standard',
      totalWeight_kg: 5.0,
      items: [{ name: 'Jasmine Rice', quantity: 1 }],
      pickupLocation: { lat: 11.572, lon: 104.925 },
      deliveryLocation: { lat: 11.554, lon: 104.918 },
      assignedVehicleId: 'VEH-001',
      createdAt: 1000,
      assignedAt: 2000,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: 6000,
    };

    await repo.syncOrder(mockOrder, 'VEH-001');

    const impact = await repo.getImpactAnalysis('depot', 'DEPOT-A');

    expect(impact.targetEntity.id).toBe('DEPOT-A');
    expect(impact.impactedVehicles.length).toBe(1);
    expect(impact.impactedOrders.length).toBe(1);
    expect(impact.totalOrdersAtRisk).toBe(1);
    expect(impact.cypherQuery).toContain('MATCH (d:Depot {id: \'DEPOT-A\'})');
  });

  it('updates order node status and clears CARRIES edge on delivery', async () => {
    await repo.syncTopology(mockWarehouses, mockVehicles, mockDrivers);

    const mockOrder: Order = {
      id: 'ORD-DELIVER-01',
      customerId: 'C0457',
      status: 'assigned',
      totalWeight_kg: 3.0,
      items: [],
      pickupLocation: { lat: 11.572, lon: 104.925 },
      deliveryLocation: { lat: 11.554, lon: 104.918 },
      assignedVehicleId: 'VEH-001',
      createdAt: 1000,
      assignedAt: 2000,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: 4000,
    };

    await repo.syncOrder(mockOrder, 'VEH-001');
    await repo.updateOrderStatus('ORD-DELIVER-01', 'delivered');

    const topology = await repo.getGraphTopology();
    const orderNode = topology.nodes.find((n) => n.id === 'ORD-DELIVER-01');
    expect(orderNode?.properties.status).toBe('delivered');

    // CARRIES edge should be cleared so delivered orders are no longer carried by vehicles
    const carriesEdge = topology.relationships.find(
      (r) => r.type === 'CARRIES' && r.to === 'ORD-DELIVER-01'
    );
    expect(carriesEdge).toBeUndefined();
  });
});
