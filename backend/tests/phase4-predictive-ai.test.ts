/**
 * @fileoverview Phase 4 Unit Tests: Predictive AI Dispatch, District Forecasting,
 * SLA Risk Radar, and Cassandra Historical Telemetry Trip Playback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PredictiveAiEngine, PHNOM_PENH_DISTRICTS } from '../src/dispatch/predictive-ai.js';
import { Dispatcher } from '../src/dispatch/dispatcher.js';
import { World } from '../src/world/world.js';
import { defaultScenario } from '../src/scenarios/default.js';
import { SCENARIO_PRESETS } from '../src/scenarios/presets.js';
import { InMemoryTelemetryRepository } from '../src/persistence/in-memory/telemetry.repository.js';
import { Order, Vehicle, TelemetryPing } from '../src/world/types.js';

describe('Phase 4: Predictive AI Dispatch & Advanced Analytics', () => {
  let aiEngine: PredictiveAiEngine;
  let world: World;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    aiEngine = new PredictiveAiEngine();
    world = new World(defaultScenario);
    dispatcher = new Dispatcher();
  });

  describe('Geographic Zoning & Demand Forecasting', () => {
    it('maps Phnom Penh coordinates to the correct district zone', () => {
      // Wat Phnom / Riverside -> Daun Penh
      const daunPenhCoord = { lat: 11.575, lon: 104.931 };
      const d1 = aiEngine.getDistrictForCoordinate(daunPenhCoord);
      expect(d1.id).toBe('daun_penh');

      // TK Avenue -> Tuol Kork
      const tkCoord = { lat: 11.573, lon: 104.898 };
      const d2 = aiEngine.getDistrictForCoordinate(tkCoord);
      expect(d2.id).toBe('tuol_kork');

      // AEON 2 -> Sen Sok
      const senSokCoord = { lat: 11.585, lon: 104.882 };
      const d3 = aiEngine.getDistrictForCoordinate(senSokCoord);
      expect(d3.id).toBe('sen_sok');
    });

    it('computes real-time district demand forecasts and detects courier deficits', () => {
      // Generate some orders destined for Sen Sok
      const senSokDest = { lat: 11.585, lon: 104.882 };
      const orderIds: string[] = [];

      for (let i = 0; i < 5; i++) {
        const order: Order = {
          id: `ORD-SENSOK-${i}`,
          customerId: `C-${i}`,
          status: 'pending',
          priority: 'express',
          slaDeadline: 5000,
          totalWeight_kg: 5,
          pickupLocation: { lat: 11.568, lon: 104.922 },
          deliveryLocation: senSokDest,
          items: [{ name: 'Item', quantity: 1 }],
          assignedVehicleId: null,
          createdAt: 1000,
          assignedAt: null,
          pickedUpAt: null,
          deliveredAt: null,
          estimatedDeliveryTime: null,
        };
        world.addOrder(order);
        orderIds.push(order.id);
      }

      const forecasts = aiEngine.computeDistrictForecasts(world, orderIds);
      expect(forecasts.length).toBe(PHNOM_PENH_DISTRICTS.length);

      const senSokForecast = forecasts.find((f) => f.districtId === 'sen_sok');
      expect(senSokForecast).toBeDefined();
      expect(senSokForecast?.currentPendingOrders).toBe(5);
      expect(senSokForecast?.deficitScore).toBeGreaterThan(0);
    });
  });

  describe('Dynamic SLA Breach Risk Radar', () => {
    it('accurately predicts breach risk for in-transit orders based on traffic and deadline margin', () => {
      const vehicle = world.getAllVehicles()[0];
      vehicle.status = 'en_route';
      vehicle.speed_kmh = 30;
      vehicle.routeDistanceM = 5000;
      vehicle.routeProgress = 0.2; // 4000m remaining = ~480s (8 min) travel time

      const order: Order = {
        id: 'ORD-RISK-01',
        customerId: 'CUST-RISK',
        status: 'in_transit',
        priority: 'urgent',
        slaDeadline: 1000 + 4 * 60 * 1000, // Deadline in 4 minutes (travel takes 8 min -> overdue!)
        totalWeight_kg: 2,
        pickupLocation: { lat: 11.56, lon: 104.92 },
        deliveryLocation: { lat: 11.58, lon: 104.88 },
        items: [{ name: 'Urgent Doc', quantity: 1 }],
        assignedVehicleId: vehicle.id,
        createdAt: 1000,
        assignedAt: 1000,
        pickedUpAt: 1000,
        deliveredAt: null,
        estimatedDeliveryTime: 1000 + 8 * 60 * 1000,
      };

      world.addOrder(order);
      vehicle.assignedOrderIds = [order.id];

      const predictions = aiEngine.evaluateSlaBreachRisks(world, 1000, 1.0);
      expect(predictions.length).toBeGreaterThanOrEqual(1);

      const riskItem = predictions.find((p) => p.orderId === 'ORD-RISK-01');
      expect(riskItem).toBeDefined();
      expect(riskItem?.riskLevel).toBe('critical');
      expect(riskItem?.riskScore).toBe(100);
      expect(riskItem?.marginMinutes).toBeLessThan(0); // Overdue
    });
  });

  describe('Predictive AI Dispatch Strategy', () => {
    it('scores candidates favoring vehicles whose delivery lands in a high-deficit zone', () => {
      const order: Order = {
        id: 'ORD-SCORE-01',
        customerId: 'CUST-01',
        status: 'pending',
        priority: 'standard',
        totalWeight_kg: 10,
        pickupLocation: { lat: 11.568, lon: 104.922 },
        deliveryLocation: { lat: 11.585, lon: 104.882 }, // Sen Sok
        items: [{ name: 'Package', quantity: 1 }],
        assignedVehicleId: null,
        createdAt: 1000,
        assignedAt: null,
        pickedUpAt: null,
        deliveredAt: null,
        estimatedDeliveryTime: null,
      };

      const v1: Vehicle = {
        id: 'VAN-1',
        name: 'Van 1',
        type: 'van',
        status: 'idle',
        driverId: 'D-1',
        depotId: 'depot-a',
        position: { lat: 11.568, lon: 104.922 }, // At pickup
        capacity_kg: 200,
        currentLoad_kg: 0,
        speed_kmh: 30,
        routeGeometry: [],
        routeProgress: 0,
        routeDistanceM: 0,
        routeDurationS: 0,
        currentRouteId: null,
        assignedOrderIds: [],
      };

      const forecasts = aiEngine.computeDistrictForecasts(world, [order.id]);
      const score = aiEngine.scorePredictiveVehicle(order, v1, forecasts);
      expect(score).toBeGreaterThan(0);
    });

    it('dispatcher assigns order using predictive_ai strategy', async () => {
      const order = world.generateOrder(1000);
      const vehicles = world.getAllVehicles();

      const mockRoutingClient: any = {
        calculateRoute: async () => ({
          path: [[104.92, 11.56], [104.93, 11.57]],
          distanceM: 2500,
          durationS: 450,
          algorithm: 'contraction_hierarchies',
          nodesVisited: 35,
          queryTimeMs: 4,
        }),
      };

      const forecasts = aiEngine.computeDistrictForecasts(world, [order.id]);
      const result = await dispatcher.assignOrder(order, vehicles, mockRoutingClient, {
        strategy: 'predictive_ai',
        predictiveEngine: aiEngine,
        forecasts,
      });

      expect(result).not.toBeNull();
      expect(result?.strategyUsed).toBe('predictive_ai');
      expect(result?.vehicleId).toBeDefined();
    });
  });

  describe('Historical Cassandra Telemetry Playback', () => {
    it('stores and retrieves chronological time-series pings for trip playback scrubbing', async () => {
      const telemetryRepo = new InMemoryTelemetryRepository();

      const riderId = 'RIDER-TEST-77';
      const now = Date.now();

      for (let i = 0; i < 10; i++) {
        await telemetryRepo.savePing({
          rider_id: riderId,
          ping_timestamp: now + i * 1000,
          ping_date: '2026-10-08',
          lat: 11.56 + i * 0.001,
          lon: 104.92 + i * 0.001,
          speed_kmh: 25 + i,
          battery_level: 95 - i,
          status: 'en_route',
          simulation_id: 'sim-phase4',
        });
      }

      const pings = await telemetryRepo.getPingsByTimeRange(riderId, now, now + 10000);
      expect(pings.length).toBe(10);
      expect(pings[0].ping_timestamp).toBe(now);
      expect(pings[pings.length - 1].ping_timestamp).toBe(now + 9000);
    });
  });

  describe('Phase 4 Scenario Preset', () => {
    it('loads ai_surge_rebalance scenario preset successfully', () => {
      const scenario = SCENARIO_PRESETS.ai_surge_rebalance;
      expect(scenario).toBeDefined();
      expect(scenario.name).toContain('AI Predictive Rebalancing');
      expect(scenario.vehicleCount).toBe(36);
      expect(scenario.orderCount).toBe(240);
    });
  });
});
