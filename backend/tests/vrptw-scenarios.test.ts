import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/simulation/engine.js';
import { SCENARIO_PRESETS } from '../src/scenarios/presets.js';
import { World } from '../src/world/world.js';
import { defaultScenario } from '../src/scenarios/presets.js';

describe('VRPTW, SLA Tracking & Scenario Presets', () => {
  it('generates orders with randomized priority and valid SLA deadlines', () => {
    const world = new World(defaultScenario);
    const simTime = 1000000;
    const order = world.generateOrder(simTime);

    expect(order.id).toBeDefined();
    expect(['standard', 'express', 'urgent']).toContain(order.priority);
    expect(order.slaDeadline).toBeGreaterThan(simTime);
    expect(order.slaStatus).toBe('on_time');

    if (order.priority === 'urgent') {
      expect(order.slaDurationMin).toBe(15);
    } else if (order.priority === 'express') {
      expect(order.slaDurationMin).toBe(35);
    } else {
      expect(order.slaDurationMin).toBe(120);
    }
  });

  it('lists scenario presets and switches scenarios with clean state reset', () => {
    const engine = new SimulationEngine();
    const presets = engine.getScenarioPresets();

    expect(presets.length).toBeGreaterThanOrEqual(3);
    const ids = presets.map((p) => p.id);
    expect(ids).toContain('morning_delivery');
    expect(ids).toContain('depot_stress_test');
    expect(ids).toContain('express_rush_hour');

    // Switch to depot stress test
    const result = engine.loadScenario('depot_stress_test');
    expect(result.success).toBe(true);
    expect(result.scenario.id).toBe('depot_stress_test');

    const state = engine.getState();
    expect(state.activeScenarioId).toBe('depot_stress_test');
    expect(state.vehicles.length).toBe(35);
    expect(state.orders.length).toBe(0);
    expect(state.stats.deliveredOrders).toBe(0);
    expect(state.stats.slaComplianceRate).toBe(100);
  });

  it('tracks SLA status and updates stats accurately', () => {
    const engine = new SimulationEngine();
    const simTime = engine.clock.getSimulatedTime();

    // Ingest marketplace order with 35m SLA
    const order = engine.ingestEcommerceOrder({
      order_id: 'TEST-SLA-001',
      customer_id: 'CUST-1',
      customer_name: 'Test Customer',
      province: 'Phnom Penh',
      status: 'Pending',
      total: 50,
      delivery_address: 'St 214, Phnom Penh',
      items: [{ name: 'Test Box', quantity: 1 }],
      created_at: new Date().toISOString(),
    });

    expect(order.priority).toBe('express');
    expect(order.slaStatus).toBe('on_time');

    const state = engine.getState();
    expect(state.stats.totalOrders).toBeGreaterThanOrEqual(1);
    expect(state.stats.slaComplianceRate).toBe(100);
    expect(state.stats.atRiskOrdersCount).toBe(0);
  });
});
