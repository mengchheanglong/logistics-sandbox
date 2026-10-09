/**
 * @fileoverview Determinism, Replay, Injected Clock, and Race-Free Queue Tests (Milestone M1 / P0-04).
 *
 * Verifies:
 * 1. SimulationClock decoupling from Date.now, discrete stepping, pause, and reset.
 * 2. Strict pause freezing (zero vehicle movement, progress, or SLA transitions during pause).
 * 3. Discrete stepping engine API (engine.step) and REST endpoint POST /api/simulation/step.
 * 4. Full engine reset to clean zero-state (engine.reset) and REST endpoint POST /api/simulation/reset.
 * 5. PRNG reseeding on World.reset and deterministic entity generation reproducibility.
 * 6. Race-free dispatch queue (no dropped orders upon async assignment completion).
 * 7. Stable 4-tier EDF dispatch queue sorting comparator.
 * 8. Monotonic event sequencing and canonical event sequence SHA-256 hashing.
 * 9. Replay test verifying identical canonical SHA-256 digests across repeated identical scenario runs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { SimulationClock } from '../src/simulation/clock.js';
import { World } from '../src/world/world.js';
import { SimulationEngine } from '../src/simulation/engine.js';
import { setupRoutes } from '../src/api/routes.js';
import { defaultScenario } from '../src/scenarios/default.js';
import { SCENARIO_PRESETS } from '../src/scenarios/presets.js';
import { EventBus } from '../src/events/event-bus.js';
import {
  canonicalizeValue,
  canonicalizeEvent,
  computeCanonicalEventSequenceHash,
  VOLATILE_EXCLUDED_KEYS,
} from '../src/events/canonical-hash.js';
import { Order, Vehicle, SimulationEvent } from '../src/world/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Milestone M1: P0-04 Simulation Determinism & Replay', () => {
  describe('1. SimulationClock Injected Time & Stepping', () => {
    it('initializes decoupled from Date.now() and starts at initialSimTime', () => {
      const clock = new SimulationClock(1000, 2);
      expect(clock.getSimulatedTime()).toBe(1000);
      expect(clock.speed).toBe(2);
      expect(clock.isPaused).toBe(false);
      expect(clock.realTimeStart).toBe(0);
    });

    it('advances simulation time via tick according to speed and 60x ratio', () => {
      const clock = new SimulationClock(0, 1);
      clock.tick(100); // 100 real ms * 1 * 60 = 6000 sim ms
      expect(clock.getSimulatedTime()).toBe(6000);

      clock.setSpeed(2);
      clock.tick(100); // 100 real ms * 2 * 60 = 12000 sim ms
      expect(clock.getSimulatedTime()).toBe(18000);
    });

    it('advances discretely via step() independent of speed multiplier', () => {
      const clock = new SimulationClock(5000, 10);
      clock.step(2500);
      expect(clock.getSimulatedTime()).toBe(7500);

      clock.step(0);
      expect(clock.getSimulatedTime()).toBe(7500);

      clock.step(-100);
      expect(clock.getSimulatedTime()).toBe(7500);
    });

    it('freezes tick progression when paused and resumes cleanly', () => {
      const clock = new SimulationClock(0, 1);
      clock.pause();
      expect(clock.isPaused).toBe(true);

      clock.tick(1000);
      expect(clock.getSimulatedTime()).toBe(0);

      clock.resume();
      expect(clock.isPaused).toBe(false);

      clock.tick(1000);
      expect(clock.getSimulatedTime()).toBe(60000);
    });

    it('resets clock back to zero baseline with unpaused state', () => {
      const clock = new SimulationClock(10000, 5);
      clock.pause();
      expect(clock.isPaused).toBe(true);

      clock.reset(0, 1);
      expect(clock.getSimulatedTime()).toBe(0);
      expect(clock.speed).toBe(1);
      expect(clock.isPaused).toBe(false);
    });
  });

  describe('2. Strict Pause Freezing in SimulationEngine', () => {
    it('immediately reports paused status via getStatus() and getState() when paused', () => {
      const engine = new SimulationEngine();
      expect(engine.getStatus()).toBe('stopped');
      expect(engine.getState().status).toBe('stopped');

      engine.start();
      expect(engine.getStatus()).toBe('running');
      expect(engine.getState().status).toBe('running');

      engine.pause();
      expect(engine.getStatus()).toBe('paused');
      expect(engine.getState().status).toBe('paused');

      engine.resume();
      expect(engine.getStatus()).toBe('running');
      expect(engine.getState().status).toBe('running');

      engine.stop();
      expect(engine.getStatus()).toBe('stopped');
      expect(engine.getState().status).toBe('stopped');
    });

    it('strictly freezes vehicle coordinates, progress, and trail history when paused', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });

      const vehicle = engine.world.getAllVehicles()[0];
      vehicle.status = 'en_route';
      vehicle.routeGeometry = [
        [104.92, 11.56],
        [104.93, 11.56],
        [104.94, 11.57],
      ];
      vehicle.routeDurationS = 100;
      vehicle.routeDistanceM = 3000;
      vehicle.routeProgress = 0.25;
      vehicle.position = { lat: 11.56, lon: 104.925 };
      vehicle.trailHistory = [[104.925, 11.56, 1000]];

      const initialPos = { ...vehicle.position };
      const initialProgress = vehicle.routeProgress;
      const initialTrailLen = vehicle.trailHistory.length;

      // Pause the engine
      engine.pause();

      // Attempt to step or advance vehicles while paused
      // (engine.tick exits early, and updateVehicles/advanceVehicle return early)
      for (let i = 0; i < 10; i++) {
        // Direct invocation of engine internal tick
        (engine as any).tick();
      }

      expect(vehicle.position.lat).toBe(initialPos.lat);
      expect(vehicle.position.lon).toBe(initialPos.lon);
      expect(vehicle.routeProgress).toBe(initialProgress);
      expect(vehicle.trailHistory.length).toBe(initialTrailLen);
    });

    it('freezes SLA deadline evaluations during pause', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });

      const order = engine.world.createCustomOrder({
        pickupLocation: { lat: 11.56, lon: 104.92 },
        deliveryLocation: { lat: 11.57, lon: 104.93 },
        simTimestamp: 1000,
        slaDurationMin: 15,
      });

      expect(order.slaStatus).toBe('on_time');

      engine.pause();
      // Even if simulated time in test were set higher, updateVehicles returns early
      (engine as any).updateVehicles(order.slaDeadline! + 1000, 6000);

      expect(order.slaStatus).toBe('on_time');
    });
  });

  describe('3. Discrete Stepping API', () => {
    it('advances simulation by discrete step counts and delta', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });
      expect(engine.clock.getSimulatedTime()).toBe(0);

      const result = engine.step(3, 5000); // 3 steps * 5000 ms = 15000 ms
      expect(result.stepsExecuted).toBe(3);
      expect(result.deltaSimMs).toBe(5000);
      expect(result.simTime).toBe(15000);
      expect(engine.clock.getSimulatedTime()).toBe(15000);
    });

    it('preserves paused status before and after stepping', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });
      engine.pause();
      expect(engine.getStatus()).toBe('paused');

      const result = engine.step(2, 4000);
      expect(result.stepsExecuted).toBe(2);
      expect(result.simTime).toBe(8000);
      expect(engine.getStatus()).toBe('paused');
    });

    it('emits simulation.stepped event with step details', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });

      let receivedEvent: SimulationEvent | null = null;
      engine.eventBus.on('simulation.stepped', (evt) => {
        receivedEvent = evt;
      });

      engine.step(4, 3000);
      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.eventType).toBe('simulation.stepped');
      expect((receivedEvent!.payload as any).stepsExecuted).toBe(4);
      expect((receivedEvent!.payload as any).deltaSimMs).toBe(3000);
    });
  });

  describe('4. Full Simulator Reset & Zero State', () => {
    it('restores clean zero-state without orphaned deliveries or vehicles', async () => {
      const engine = new SimulationEngine();
      // Seed orders and execute steps to mutate internal state
      engine.reset(defaultScenario, { seedOrders: true });
      engine.step(10, 6000);

      expect(engine.world.getAllOrders().length).toBeGreaterThan(0);
      expect(engine.eventBus.getHistory().length).toBeGreaterThan(0);
      expect(engine.clock.getSimulatedTime()).toBeGreaterThan(0);

      // Now perform clean reset without seeding orders
      const resetResult = engine.reset(defaultScenario, { seedOrders: false });
      expect(resetResult.success).toBe(true);

      // Check clean zero-state invariants
      expect(engine.clock.getSimulatedTime()).toBe(0);
      expect(engine.getStatus()).toBe('stopped');
      expect(engine.world.getAllOrders().length).toBe(0);
      expect(engine.eventBus.getHistory().length).toBe(1); // Only the simulation.reset event
      expect(engine.eventBus.getHistory()[0].eventType).toBe('simulation.reset');
      expect(engine.chaosEngine.getMode()).toBe('off');
      expect(engine.chaosEngine.getActiveEvents().length).toBe(0);

      // Verify all vehicles are idle at depot coordinates with 0 progress
      for (const vehicle of engine.world.getAllVehicles()) {
        expect(vehicle.status).toBe('idle');
        expect(vehicle.routeProgress).toBe(0);
        expect(vehicle.assignedOrderIds.length).toBe(0);
        expect(vehicle.routeGeometry.length).toBe(0);
      }

      // In-memory repositories are cleared
      const orderRepoStatus = engine.persistence.orders.getStatus();
      expect(orderRepoStatus.orderCount).toBe(0);
      const telemetryRepoStatus = engine.persistence.telemetry.getStatus();
      expect(telemetryRepoStatus.pingCount).toBe(0);
    });
  });

  describe('5. PRNG Reseeding & Invariant Generation', () => {
    it('reseeds PRNG on World.reset() and generates identical entities across identical seeds', () => {
      const config = defaultScenario;
      const worldA = new World(config);
      const ordersRun1 = [
        worldA.generateOrder(1000),
        worldA.generateOrder(2000),
        worldA.generateOrder(3000),
      ];

      // Mutate worldA further
      worldA.generateOrder(4000);
      worldA.generateOrder(5000);

      // Reset worldA with identical scenario config & seed
      worldA.reset(config);
      const ordersRun2 = [
        worldA.generateOrder(1000),
        worldA.generateOrder(2000),
        worldA.generateOrder(3000),
      ];

      for (let i = 0; i < ordersRun1.length; i++) {
        expect(ordersRun1[i].id).toBe(ordersRun2[i].id);
        expect(ordersRun1[i].deliveryLocation.lat).toBeCloseTo(ordersRun2[i].deliveryLocation.lat, 6);
        expect(ordersRun1[i].deliveryLocation.lon).toBeCloseTo(ordersRun2[i].deliveryLocation.lon, 6);
        expect(ordersRun1[i].priority).toBe(ordersRun2[i].priority);
        expect(ordersRun1[i].slaDeadline).toBe(ordersRun2[i].slaDeadline);
        expect(ordersRun1[i].items.length).toBe(ordersRun2[i].items.length);
        expect(ordersRun1[i].totalWeight_kg).toBe(ordersRun2[i].totalWeight_kg);
      }
    });

    it('exposes world.getRng() matching seeded stream', () => {
      const world = new World(defaultScenario);
      const rng = world.getRng();
      expect(rng).toBeDefined();
      expect(typeof rng.next).toBe('function');
      expect(typeof rng.nextFloat).toBe('function');
    });
  });

  describe('6. Race-Free Dispatch Queue & Stable EDF Sorting', () => {
    it('dequeueOrder evicts strictly the assigned order and preserves unshifted urgent orders', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });

      const queue = (engine as any).dispatchQueue as string[];
      queue.push('ORD-NORMAL-1', 'ORD-NORMAL-2');

      // Simulate urgent order arrival unshifting into queue during async routing window
      queue.unshift('ORD-URGENT-TOP');
      expect(queue).toEqual(['ORD-URGENT-TOP', 'ORD-NORMAL-1', 'ORD-NORMAL-2']);

      // When ORD-NORMAL-1 assignment resolves, targeted dequeueOrder is called
      const dequeued = (engine as any).dequeueOrder('ORD-NORMAL-1');
      expect(dequeued).toBe(true);

      // ORD-URGENT-TOP remains untouched at index 0!
      expect(queue).toEqual(['ORD-URGENT-TOP', 'ORD-NORMAL-2']);
      expect(queue[0]).toBe('ORD-URGENT-TOP');
    });

    it('sortDispatchQueueByEDF performs 4-tier total tie-breaking', () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });

      // Create orders with identical deadlines but different priority, seq, and ID
      const orderA = engine.world.createCustomOrder({
        pickupLocation: { lat: 11.56, lon: 104.92 },
        deliveryLocation: { lat: 11.57, lon: 104.93 },
        simTimestamp: 1000,
        priority: 'standard',
        slaDurationMin: 60, // deadline: 1000 + 3600000 = 3601000
      });
      const orderB = engine.world.createCustomOrder({
        pickupLocation: { lat: 11.56, lon: 104.92 },
        deliveryLocation: { lat: 11.57, lon: 104.93 },
        simTimestamp: 1000,
        priority: 'urgent',
        slaDurationMin: 60, // same deadline, but urgent priority
      });
      const orderC = engine.world.createCustomOrder({
        pickupLocation: { lat: 11.56, lon: 104.92 },
        deliveryLocation: { lat: 11.57, lon: 104.93 },
        simTimestamp: 1000,
        priority: 'express',
        slaDurationMin: 60, // same deadline, express priority
      });

      const queue = (engine as any).dispatchQueue as string[];
      queue.length = 0;
      queue.push(orderA.id, orderB.id, orderC.id);

      (engine as any).sortDispatchQueueByEDF();

      // Tier 2 priority: urgent (0) < express (1) < standard (2)
      expect(queue[0]).toBe(orderB.id); // urgent
      expect(queue[1]).toBe(orderC.id); // express
      expect(queue[2]).toBe(orderA.id); // standard
    });
  });

  describe('7. Monotonic Event Sequencing & Canonical Hashing', () => {
    it('assigns strictly monotonic sequence numbers to emitted events', () => {
      const bus = new EventBus();
      const events: SimulationEvent[] = [];

      bus.on('*', (e) => events.push(e));

      bus.emit({
        sequenceNumber: 0, // Should be auto-assigned
        eventId: 'E1',
        simulationId: 'S1',
        simTimestamp: 100,
        entityType: 'vehicle',
        entityId: 'V1',
        eventType: 'test.1',
        payload: { a: 1 },
      });

      bus.emit({
        sequenceNumber: 0,
        eventId: 'E2',
        simulationId: 'S1',
        simTimestamp: 200,
        entityType: 'vehicle',
        entityId: 'V2',
        eventType: 'test.2',
        payload: { b: 2 },
      });

      expect(events[0].sequenceNumber).toBe(1);
      expect(events[1].sequenceNumber).toBe(2);
      expect(bus.getSequenceCounter()).toBe(2);

      bus.clear();
      expect(bus.getHistory().length).toBe(0);
      expect(bus.getSequenceCounter()).toBe(0);
    });

    it('canonicalizeValue strips volatile wall-clock fields and sorts keys', () => {
      const rawPayload = {
        zeta: 'last',
        realTimestamp: 1728472900000,
        alpha: 'first',
        queryTimeMs: 14.5,
        nested: {
          query_time_ms: 12,
          count: 5,
          wallClockTime: '2026-10-09',
        },
      };

      const canonical = canonicalizeValue(rawPayload) as Record<string, any>;
      const keys = Object.keys(canonical);
      expect(keys).toEqual(['alpha', 'nested', 'zeta']);
      expect(canonical.realTimestamp).toBeUndefined();
      expect(canonical.queryTimeMs).toBeUndefined();
      expect(Object.keys(canonical.nested)).toEqual(['count']);
    });

    it('produces identical SHA-256 hashes for identical canonical event sequences', () => {
      const eventsA: SimulationEvent[] = [
        {
          sequenceNumber: 1,
          eventId: 'EVT-001',
          simulationId: 'sim-test-1',
          simTimestamp: 100,
          realTimestamp: 1111111, // volatile, should be ignored
          entityType: 'vehicle',
          entityId: 'V1',
          eventType: 'vehicle.dispatched',
          payload: { queryTimeMs: 12.3, routePoints: 50 },
        },
        {
          sequenceNumber: 2,
          eventId: 'EVT-002',
          simulationId: 'sim-test-1',
          simTimestamp: 200,
          realTimestamp: 2222222,
          entityType: 'order',
          entityId: 'ORD-1',
          eventType: 'order.created',
          payload: { price: 25 },
        },
      ];

      const eventsB: SimulationEvent[] = [
        {
          sequenceNumber: 1,
          eventId: 'EVT-001',
          simulationId: 'sim-test-2', // Different simId, but normalized or excluded
          simTimestamp: 100,
          realTimestamp: 9999999, // Different wall clock
          entityType: 'vehicle',
          entityId: 'V1',
          eventType: 'vehicle.dispatched',
          payload: { routePoints: 50, queryTimeMs: 99.9 }, // Different queryTimeMs
        },
        {
          sequenceNumber: 2,
          eventId: 'EVT-002',
          simulationId: 'sim-test-2',
          simTimestamp: 200,
          realTimestamp: 8888888,
          entityType: 'order',
          entityId: 'ORD-1',
          eventType: 'order.created',
          payload: { price: 25 },
        },
      ];

      const hashA = computeCanonicalEventSequenceHash(eventsA);
      const hashB = computeCanonicalEventSequenceHash(eventsB);

      expect(hashA).toHaveLength(64);
      expect(hashA).toBe(hashB);
    });
  });

  describe('8. Deterministic Replay Test across Independent Runs', () => {
    it('produces identical canonical SHA-256 event sequence hashes across repeated simulation runs', () => {
      // Run 1
      const engine1 = new SimulationEngine();
      engine1.reset(defaultScenario, { seedOrders: false });
      engine1.step(5, 6000);
      const hashRecord1 = engine1.getEventSequenceHash();

      // Run 2 (fresh engine instance, identical seed)
      const engine2 = new SimulationEngine();
      engine2.reset(defaultScenario, { seedOrders: false });
      engine2.step(5, 6000);
      const hashRecord2 = engine2.getEventSequenceHash();

      expect(hashRecord1.hash).toHaveLength(64);
      expect(hashRecord2.hash).toHaveLength(64);
      expect(hashRecord1.eventCount).toBe(hashRecord2.eventCount);
      expect(hashRecord1.hash).toBe(hashRecord2.hash);
    });
  });

  describe('9. REST Endpoints for Determinism Controls', () => {
    it('POST /api/simulation/step and GET /api/simulation/events/hash work via HTTP', async () => {
      const engine = new SimulationEngine();
      engine.reset(defaultScenario, { seedOrders: false });

      const app = express();
      app.use(express.json());
      app.use('/api', setupRoutes(engine));

      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));

      try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');

        // 1. POST /api/simulation/step
        const stepResponse = await new Promise<{ status: number; body: any }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/api/simulation/step',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
            }
          );
          req.on('error', reject);
          req.end(JSON.stringify({ steps: 2, deltaSimMs: 3000 }));
        });

        expect(stepResponse.status).toBe(200);
        expect(stepResponse.body.success).toBe(true);
        expect(stepResponse.body.stepsExecuted).toBe(2);
        expect(stepResponse.body.simTime).toBe(6000);

        // 2. GET /api/simulation/events/hash
        const hashResponse = await new Promise<{ status: number; body: any }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/api/simulation/events/hash',
              method: 'GET',
            },
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
            }
          );
          req.on('error', reject);
          req.end();
        });

        expect(hashResponse.status).toBe(200);
        expect(hashResponse.body.hash).toHaveLength(64);
        expect(hashResponse.body.eventCount).toBeGreaterThan(0);

        // 3. POST /api/simulation/reset
        const resetResponse = await new Promise<{ status: number; body: any }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/api/simulation/reset',
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
              let body = '';
              res.on('data', (c) => (body += c));
              res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
            }
          );
          req.on('error', reject);
          req.end(JSON.stringify({ seedOrders: false }));
        });

        expect(resetResponse.status).toBe(200);
        expect(resetResponse.body.success).toBe(true);
        expect(resetResponse.body.state.simTime).toBe(0);
      } finally {
        engine.stop();
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    });
  });
});
