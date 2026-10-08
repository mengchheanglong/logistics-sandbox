/**
 * @fileoverview Comprehensive Resilience, Chaos Monkey, SLA Mitigation, and System Integrity Tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SimulationEngine } from '../src/simulation/engine.js';
import { defaultScenario } from '../src/scenarios/presets.js';
import { ChaosEngine } from '../src/simulation/chaos-engine.js';
import { Order, Vehicle } from '../src/world/types.js';

describe('Chaos Monkey Resilience & Autonomous Self-Healing', () => {
  let engine: SimulationEngine;
  let chaos: ChaosEngine;

  beforeEach(() => {
    engine = new SimulationEngine();
    chaos = new ChaosEngine();
  });

  describe('Chaos Engine Mechanics', () => {
    it('initializes in OFF mode and transitions cleanly between intensity levels', () => {
      expect(chaos.getMode()).toBe('off');

      chaos.setMode('low');
      expect(chaos.getMode()).toBe('low');

      chaos.setMode('medium');
      expect(chaos.getMode()).toBe('medium');

      chaos.setMode('extreme');
      expect(chaos.getMode()).toBe('extreme');

      chaos.setMode('off');
      expect(chaos.getMode()).toBe('off');
    });

    it('injects and tracks authentic Phnom Penh urban chaos events', () => {
      chaos.setMode('extreme');
      const simTime = 10000;

      // Simulate enough ticks to trigger chaos
      for (let i = 0; i < 35; i++) {
        chaos.tick(simTime, engine);
      }

      const metrics = chaos.getMetrics();
      expect(metrics.totalEventsTriggered).toBeGreaterThanOrEqual(1);
      expect(metrics.activeEventsCount).toBeGreaterThanOrEqual(1);

      const activeEvent = chaos.getActiveEvents()[0];
      expect(activeEvent.name).toBeDefined();
      expect(activeEvent.locationName).toBeDefined();
      expect(activeEvent.autoHealAtSimMs).toBeGreaterThan(simTime);
    });

    it('autonomously heals expired chaos events when recovery duration elapses', () => {
      chaos.setMode('extreme');
      const startSimTime = 10000;

      // Trigger chaos
      for (let i = 0; i < 35; i++) {
        chaos.tick(startSimTime, engine);
      }

      const activeCount = chaos.getActiveEvents().length;
      expect(activeCount).toBeGreaterThanOrEqual(1);

      // Fast-forward simulation time beyond healing window (60 seconds)
      const healedSimTime = startSimTime + 70000;
      chaos.tick(healedSimTime, engine);

      const metrics = chaos.getMetrics();
      expect(metrics.totalEventsHealed).toBeGreaterThanOrEqual(1);
      expect(metrics.activeEventsCount).toBeLessThan(activeCount);
    });
  });

  describe('Dynamic SLA Breach Risk Auto-Mitigation Directive', () => {
    it('elevates priority to urgent and grants time buffer for pending orders', async () => {
      const order = engine.world.generateOrder(5000);
      const originalDeadline = order.slaDeadline;

      const result = await engine.mitigateSlaBreachRisk(order.id);
      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe('priority_reassignment');

      const updatedOrder = engine.world.getOrder(order.id);
      expect(updatedOrder?.priority).toBe('urgent');
      expect(updatedOrder?.slaDeadline).toBeGreaterThan(originalDeadline);
    });

    it('dynamically reroutes courier via expedited corridor when order is in-transit', async () => {
      const order = engine.world.generateOrder(5000);
      const vehicle = engine.world.getAllVehicles()[0];

      // Simulate order assigned and en route
      order.status = 'assigned';
      order.assignedVehicleId = vehicle.id;
      vehicle.status = 'en_route';
      vehicle.assignedOrderIds = [order.id];
      vehicle.routeGeometry = [
        [104.9223, 11.5680],
        [104.9250, 11.5580],
        [104.9282, 11.5528],
      ];
      vehicle.routeDistanceM = 2500;
      vehicle.routeProgress = 0.2;

      const result = await engine.mitigateSlaBreachRisk(order.id);
      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe('expedited_reroute');
      expect(order.priority).toBe('urgent');
    });
  });

  describe('System Integrity & State Serialization', () => {
    it('serializes complete digital-twin state with chaosMode and active metrics', () => {
      engine.setChaosMode('low');
      const state = engine.getState();

      expect(state.simulationId).toBeDefined();
      expect(state.chaosMode).toBe('low');
      expect(typeof state.chaosActiveEventsCount).toBe('number');
      expect(state.vehicles.length).toBe(defaultScenario.vehicleCount);
      expect(state.warehouses.length).toBe(defaultScenario.depots.length);
      expect(state.stats).toBeDefined();
      expect(state.predictiveAi).toBeDefined();
    });
  });
});
