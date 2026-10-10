import { describe, it, expect } from 'vitest';
import { SimulationClock } from '../src/simulation/clock.js';
import { World } from '../src/world/world.js';
import { defaultScenario } from '../src/scenarios/default.js';
import { interpolateAlongPath, haversineDistance, pathDistance } from '../src/utils/geo.js';
import { SeededRandom } from '../src/utils/random.js';
import { Dispatcher } from '../src/dispatch/dispatcher.js';
import { RoutingClient } from '../src/routing/client.js';

describe('SimulationClock', () => {
  it('advances simulation time based on speed ratio', () => {
    const clock = new SimulationClock(0, 1);
    // At 1x speed, ratio is 60 (1 real second = 60 sim seconds = 60,000 sim ms)
    clock.tick(1000); // 1 real second
    expect(clock.getSimulatedTime()).toBe(60000);
  });

  it('respects pause and speed adjustments', () => {
    const clock = new SimulationClock(0, 10);
    clock.pause();
    clock.tick(1000);
    expect(clock.getSimulatedTime()).toBe(0);

    clock.resume();
    clock.tick(1000); // 1 real second at 10x = 600,000 sim ms
    expect(clock.getSimulatedTime()).toBe(600000);
  });
});

describe('SeededRandom', () => {
  it('produces identical sequences with the same seed', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);

    const seq1 = [rng1.next(), rng1.next(), rng1.next()];
    const seq2 = [rng2.next(), rng2.next(), rng2.next()];

    expect(seq1).toEqual(seq2);
  });
});

describe('Geo Utilities', () => {
  it('calculates haversine distance between Phnom Penh landmarks', () => {
    // Central Market to Russian Market ~ 2.5 km
    const centralMarket = { lat: 11.568, lon: 104.9223 };
    const russianMarket = { lat: 11.549, lon: 104.928 };
    const dist = haversineDistance(centralMarket, russianMarket);
    expect(dist).toBeGreaterThan(2000);
    expect(dist).toBeLessThan(3000);
  });

  it('interpolates along polyline path with distance weighting', () => {
    const path: [number, number][] = [
      [104.92, 11.56],
      [104.93, 11.56],
      [104.93, 11.57],
    ];

    const start = interpolateAlongPath(path, 0);
    expect(start.lon).toBeCloseTo(104.92, 4);
    expect(start.lat).toBeCloseTo(11.56, 4);

    const end = interpolateAlongPath(path, 1);
    expect(end.lon).toBeCloseTo(104.93, 4);
    expect(end.lat).toBeCloseTo(11.57, 4);

    const mid = interpolateAlongPath(path, 0.5);
    expect(mid.lon).toBeGreaterThanOrEqual(104.92);
    expect(mid.lat).toBeGreaterThanOrEqual(11.56);
  });
});

describe('World and Scenario Initialization', () => {
  it('initializes world entities from default scenario', () => {
    const world = new World(defaultScenario);
    const vehicles = world.getAllVehicles();
    const warehouses = world.getAllWarehouses();

    expect(vehicles.length).toBe(defaultScenario.vehicleCount);
    expect(warehouses.length).toBe(defaultScenario.depots.length);

    // Initial vehicle state
    const idleVehicles = world.getIdleVehicles();
    expect(idleVehicles.length).toBe(defaultScenario.vehicleCount);

    // Dynamic order generation
    const order = world.generateOrder(1000);
    expect(order.status).toBe('pending');
    expect(order.pickupLocation).toBeDefined();
    expect(order.deliveryLocation).toBeDefined();
  });
});

describe('Dispatcher', () => {
  it('finds nearest vehicle and assigns order', async () => {
    const world = new World(defaultScenario);
    const dispatcher = new Dispatcher();
    const routingClient = new RoutingClient('http://localhost:8000');

    const order = world.generateOrder(0);
    const vehicles = world.getAllVehicles();

    const result = await dispatcher.assignOrder(order, vehicles, routingClient);
    expect(result).not.toBeNull();
    expect(result?.vehicleId).toBeDefined();
    expect(result?.route.path.length).toBeGreaterThanOrEqual(2);
  });
});
