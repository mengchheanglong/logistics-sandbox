/**
 * @fileoverview Unit tests for Phase 3 Persistence Layer & Inventory Synchronization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryTelemetryRepository,
  InMemoryOrderRepository,
  InMemoryVehicleRepository,
  InMemoryScenarioRepository,
  CassandraTelemetryRepository,
  MongoOrderRepository,
  createPersistenceLayer,
  TelemetryPing,
} from '../src/persistence/index.js';
import { World } from '../src/world/world.js';
import { defaultScenario } from '../src/scenarios/default.js';
import { FALLBACK_CAMBODIA_CATALOG, EcommerceClient } from '../src/integrations/ecommerce.js';
import { Order } from '../src/world/types.js';

describe('Phase 3: Persistence Layer & Polyglot NoSQL Adapters', () => {
  describe('Telemetry Repository (Cassandra Schema)', () => {
    let repo: InMemoryTelemetryRepository;

    beforeEach(() => {
      repo = new InMemoryTelemetryRepository(10); // Small capacity to test ring eviction
    });

    it('records GPS pings and retrieves newest first (descending timestamp)', async () => {
      const ping1: TelemetryPing = {
        rider_id: 'R-101',
        ping_timestamp: 1000,
        ping_date: '2026-10-08',
        lat: 11.55,
        lon: 104.92,
        speed_kmh: 35,
        battery_level: 95,
        status: 'en_route',
        simulation_id: 'sim-1',
      };
      const ping2: TelemetryPing = {
        rider_id: 'R-101',
        ping_timestamp: 2000,
        ping_date: '2026-10-08',
        lat: 11.56,
        lon: 104.93,
        speed_kmh: 42,
        battery_level: 94,
        status: 'en_route',
        simulation_id: 'sim-1',
      };

      await repo.savePing(ping1);
      await repo.savePing(ping2);

      const recent = await repo.getRecentPings('R-101', 5);
      expect(recent.length).toBe(2);
      expect(recent[0].ping_timestamp).toBe(2000); // Newest first
      expect(recent[1].ping_timestamp).toBe(1000);
    });

    it('enforces FIFO eviction when capacity is reached', async () => {
      for (let i = 0; i < 15; i++) {
        await repo.savePing({
          rider_id: 'R-102',
          ping_timestamp: i * 100,
          ping_date: '2026-10-08',
          lat: 11.50 + i * 0.001,
          lon: 104.90 + i * 0.001,
          speed_kmh: 30,
          battery_level: 90,
          status: 'delivering',
          simulation_id: 'sim-1',
        });
      }

      expect(repo.getTotalPingCount()).toBe(10);
      const recent = await repo.getRecentPings('R-102', 20);
      expect(recent.length).toBe(10);
      // Oldest remaining should be index 5 (timestamp 500)
      expect(recent[recent.length - 1].ping_timestamp).toBe(500);
    });

    it('queries pings within a given time range', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.savePing({
          rider_id: 'R-103',
          ping_timestamp: i * 1000,
          ping_date: '2026-10-08',
          lat: 11.52,
          lon: 104.91,
          speed_kmh: 25,
          battery_level: 88,
          status: 'idle',
          simulation_id: 'sim-1',
        });
      }

      const rangePings = await repo.getPingsByTimeRange('R-103', 1000, 3000);
      expect(rangePings.length).toBe(3);
      expect(rangePings[0].ping_timestamp).toBe(1000);
      expect(rangePings[2].ping_timestamp).toBe(3000);
    });
  });

  describe('Order Repository (MongoDB Schema)', () => {
    let repo: InMemoryOrderRepository;

    beforeEach(() => {
      repo = new InMemoryOrderRepository();
    });

    it('persists customer orders and computes delivery KPIs', async () => {
      const order1: Order = {
        id: 'ORD-001',
        customerId: 'CUST-01',
        status: 'pending',
        priority: 'express',
        slaDeadline: 5000,
        slaDurationMin: 35,
        slaStatus: 'on_time',
        items: [
          { product_id: 'P0875', name: 'Kampot Organic Black Pepper', quantity: 2, price: 7.5 },
        ],
        totalWeight_kg: 0.5,
        pickupLocation: { lat: 11.56, lon: 104.92 },
        deliveryLocation: { lat: 11.57, lon: 104.93 },
        assignedVehicleId: null,
        createdAt: 1000,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      };

      await repo.saveOrder(order1);
      const retrieved = await repo.getOrder('ORD-001');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.items.length).toBe(1);
      expect(retrieved?.items[0].product_id).toBe('P0875');

      await repo.updateOrderStatus('ORD-001', 'delivered', 4500);
      const updated = await repo.getOrder('ORD-001');
      expect(updated?.status).toBe('delivered');
      expect(updated?.deliveredAt).toBe(4500);

      const metrics = await repo.getMetrics();
      expect(metrics.total).toBe(1);
      expect(metrics.delivered).toBe(1);
      expect(metrics.onTimeRate).toBe(100);
    });
  });

  describe('Persistence Factory', () => {
    it('creates polyglot persistence layer with composite status', () => {
      const layer = createPersistenceLayer('polyglot');
      expect(layer.driverType).toBe('polyglot');
      const status = layer.getStatus();
      expect(status.telemetry.driver).toContain('Cassandra');
      expect(status.orders.driver).toContain('MongoDB');
      expect(status.vehicles.driver).toContain('in-memory');
    });

    it('supports pure in-memory mode', () => {
      const layer = createPersistenceLayer('in-memory');
      expect(layer.driverType).toBe('in-memory');
      const status = layer.getStatus();
      expect(status.telemetry.driver).toContain('in-memory');
    });
  });

  describe('E-Commerce Item & Inventory Synchronization', () => {
    it('generates scenario orders with authentic catalog items instead of generic packages', () => {
      const world = new World(defaultScenario);
      const order = world.generateOrder(1000);

      expect(order.items.length).toBeGreaterThanOrEqual(1);
      expect(order.items[0].product_id).toBeDefined();
      expect(order.items[0].name).toBeDefined();
      expect(order.items[0].price).toBeGreaterThan(0);
      expect(order.totalWeight_kg).toBeGreaterThan(0);
    });

    it('allows live catalog update from upstream marketplace', () => {
      const world = new World(defaultScenario);
      const customCatalog = [
        { product_id: 'TEST-1', name: 'Angkor Craft Beer 6-Pack', category: 'Beverages', price: 8.5, stock: 100, weight_kg: 2.2 },
      ];
      world.setCatalog(customCatalog);

      const order = world.generateOrder(2000);
      expect(order.items[0].product_id).toBe('TEST-1');
      expect(order.items[0].name).toBe('Angkor Craft Beer 6-Pack');
    });

    it('decrements catalog stock in EcommerceClient', async () => {
      const client = new EcommerceClient('http://localhost:4000');
      const initialStock = client.getCatalog().find(c => c.product_id === 'P0874')?.stock ?? 250;

      await client.adjustStock([{ product_id: 'P0874', quantity: 5 }]);
      const updatedStock = client.getCatalog().find(c => c.product_id === 'P0874')?.stock;

      expect(updatedStock).toBe(initialStock - 5);
    });

    it('handles offline fallback gracefully when warehouse is queried', async () => {
      // Connect to non-existent port to test resilient fallback
      const offlineClient = new EcommerceClient('http://localhost:9999');
      const analytics = await offlineClient.fetchWarehouseAnalytics();
      expect(analytics).toBeNull();

      const queryResult = await offlineClient.executeHiveQuery('D1');
      expect(queryResult.success).toBe(false);
      expect(queryResult.status).toBe('OFFLINE');
    });
  });
});

