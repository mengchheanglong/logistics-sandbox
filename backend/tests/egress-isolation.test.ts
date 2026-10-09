import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { SimulationEngine } from '../src/simulation/engine.js';
import { setupRoutes } from '../src/api/routes.js';
import { createPersistenceLayer } from '../src/persistence/factory.js';
import {
  EcommerceReadClient,
  FALLBACK_CAMBODIA_CATALOG,
} from '../src/integrations/ecommerce.js';
import { defaultScenario } from '../src/scenarios/default.js';

const upstreamUrl = 'http://operational.test';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Simulation operational write boundary', () => {
  it('delivers 500 imported orders over 24 simulated hours without changing upstream orders, stock or GPS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    vi.stubEnv('PERSISTENCE_DRIVER', 'in-memory');
    // Stale write credentials/URLs must never activate adapters.
    vi.stubEnv('NEO4J_HTTP_URL', upstreamUrl);
    vi.stubEnv('NEO4J_USER', 'operational-writer');
    vi.stubEnv('NEO4J_PASSWORD', 'must-not-be-sent');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const upstream = {
      orders: Array.from({ length: 500 }, (_, i) => ({
        order_id: `UPSTREAM-${i}`,
        customer_id: `CUSTOMER-${i}`,
        customer_name: `Customer ${i}`,
        items: [{ product_id: 'P0874', name: 'Rice', quantity: 1, price: 4.8 }],
        total: 4.8,
        province: 'Phnom Penh',
        payment_method: 'Cash',
        status: 'Pending',
      })),
      products: structuredClone(FALLBACK_CAMBODIA_CATALOG),
      gps: [
        { rider_id: 'REAL-RIDER', lat: defaultScenario.depots[0].position.lat },
      ],
    };
    const before = JSON.stringify(upstream);
    const writes: string[] = [];
    const reads: string[] = [];
    const unexpected: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        if (url.origin === upstreamUrl) {
          if (method !== 'GET') {
            writes.push(`${method} ${url.pathname}`);
            // A real mutable target: any unexpected write corrupts all three stores.
            upstream.orders[0].status = 'Delivered';
            upstream.products[0].stock--;
            upstream.gps.push({ rider_id: 'SIMULATED', lat: 0 });
            return Response.json({ success: true });
          }
          reads.push(url.pathname);
          expect(init?.headers).toBeUndefined();
          expect(init?.credentials).toBe('omit');
          expect(init?.redirect).toBe('error');
          if (url.pathname === '/api/products')
            return Response.json(structuredClone(upstream.products));
          if (url.pathname === '/api/orders')
            return Response.json(structuredClone(upstream.orders));
          return Response.json({ success: true });
        }
        if (url.origin === 'http://localhost:3000') {
          if (url.pathname === '/api/health')
            return Response.json({ status: 'ok' });
          const route = JSON.parse(String(init?.body));
          // Router contract fixture only: isolation test, not road-network validation.
          return Response.json({
            path: [
              [route.start_lon, route.start_lat],
              [route.end_lon, route.end_lat],
            ],
            distance_m: 100,
            duration_s: 1,
            algorithm: 'test_fixture',
            nodes_visited: 2,
            query_time_ms: 1,
          });
        }
        unexpected.push(`${method} ${url}`);
        throw new Error(`Unexpected network request: ${method} ${url}`);
      }),
    );

    const engine = new SimulationEngine({ ecommerceReadUrl: upstreamUrl });
    try {
      await engine.ecommerceClient.checkHealth();
      engine.setAlgorithms({ dispatchStrategy: 'multi_stop_tour' });
      const imported = await engine.ecommerceClient.fetchPendingOrders();
      for (const order of imported) engine.ingestEcommerceOrder(order);
      engine.setSpeed(60); // Current clock: 60 * 60 sim seconds per real second.
      await vi.advanceTimersByTimeAsync(24_000);
      engine.stop();
      expect(engine.clock.getSimulatedTime()).toBe(24 * 60 * 60 * 1000);
      const delivered = engine.world
        .getAllOrders()
        .filter(
          (o) => o.id.startsWith('UPSTREAM-') && o.status === 'delivered',
        );
      expect(
        delivered,
        JSON.stringify(
          engine.world
            .getAllOrders()
            .filter(
              (o) => o.id.startsWith('UPSTREAM-') && o.status !== 'delivered',
            ),
        ),
      ).toHaveLength(500);
      const persisted = await engine.persistence.orders.getAllOrders({
        status: 'delivered',
      });
      expect(
        persisted.filter((o) => o.id.startsWith('UPSTREAM-')),
      ).toHaveLength(500);
      expect(
        engine.persistence.telemetry.getStatus().pingCount,
      ).toBeGreaterThan(0);
      await engine.persistence.relationships.executeCypher(
        'MATCH (n) DETACH DELETE n',
      );
      expect(reads).toContain('/api/orders');
      expect(reads).toContain('/api/products');
      expect(writes).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(JSON.stringify(upstream)).toBe(before);
      expect(engine.ecommerceClient.getStatus()).toMatchObject({
        accessMode: 'read-only',
        egressPolicy: 'DISABLED',
        telemetryPingsEmittedCount: 0,
      });
      expect(engine.persistence.relationships.getStatus()).toMatchObject({
        driver: 'in-memory relationship graph',
        healthy: true,
        url: '',
      });
    } finally {
      engine.stop();
    }
  }, 20_000);

  it('rejects every remote persistence setting and credential-bearing read URL', () => {
    for (const driver of ['cassandra', 'mongodb', 'polyglot', 'unknown']) {
      vi.stubEnv('PERSISTENCE_DRIVER', driver);
      expect(() => createPersistenceLayer()).toThrow('remote driver');
    }
    expect(
      () => new EcommerceReadClient('http://writer:secret@operational.test'),
    ).toThrow('without credentials');
  });

  it('keeps operator injection and single-order delivery local', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PERSISTENCE_DRIVER', 'in-memory');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const requests: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, method: init?.method ?? 'GET' });
        if (url.endsWith('/api/route')) {
          const route = JSON.parse(String(init?.body));
          return Response.json({
            path: [
              [route.start_lon, route.start_lat],
              [route.end_lon, route.end_lat],
            ],
            distance_m: 100,
            duration_s: 1,
            algorithm: 'test_fixture',
            nodes_visited: 2,
            query_time_ms: 1,
          });
        }
        if (url.endsWith('/api/orders')) return Response.json([]);
        if (url.endsWith('/api/products'))
          return Response.json(FALLBACK_CAMBODIA_CATALOG);
        return Response.json({ success: true });
      }),
    );
    const engine = new SimulationEngine({ ecommerceReadUrl: upstreamUrl });
    try {
      await engine.ecommerceClient.checkHealth();
      engine.start();
      // Drain the initial dispatch before injection (async queue ordering is P0-04).
      await vi.advanceTimersByTimeAsync(100);
      const result = await engine.injectCustomOrder({
        pickupLocation: defaultScenario.depots[0].position,
        deliveryLocation: defaultScenario.depots[1].position,
        customerName: 'Simulation only',
        totalWeight_kg: 1,
      });
      expect(result.ecommerceSynced).toBe(false);
      engine.setSpeed(60);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(engine.world.getOrder(result.order!.id)?.status).toBe('delivered');
      await engine.ecommerceClient.fetchWarehouseAnalytics();
      await engine.ecommerceClient.executeHiveQuery('D1');
      expect(
        requests
          .filter((r) => r.url.startsWith(upstreamUrl))
          .every((r) => r.method === 'GET'),
      ).toBe(true);
    } finally {
      engine.stop();
    }
  });

  it('blocks legacy inventory and remote graph write endpoints', async () => {
    vi.stubEnv('PERSISTENCE_DRIVER', 'in-memory');
    const fetchSpy = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({}, { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const engine = new SimulationEngine({ ecommerceReadUrl: upstreamUrl });
    const app = express();
    app.use(express.json());
    app.use('/api', setupRoutes(engine));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing test server address');
      // The local API uses HTTP while upstream fetch stays intercepted.
      for (const path of ['/api/inventory/adjust', '/api/graph/query']) {
        const result = await new Promise<{ status: number; body: string }>(
          (resolve, reject) => {
            const request = httpRequest(
              {
                host: '127.0.0.1',
                port: address.port,
                path,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              },
              (response) => {
                let body = '';
                response.on('data', (chunk) => (body += chunk));
                response.on('end', () =>
                  resolve({ status: response.statusCode!, body }),
                );
              },
            );
            request.on('error', reject);
            request.end(
              JSON.stringify({
                items: [{ product_id: 'P0874', quantity: 10 }],
              }),
            );
          },
        );
        expect(result.status).toBe(403);
        expect(JSON.parse(result.body)).toMatchObject({
          success: false,
          egressPolicy: 'DISABLED',
        });
      }
      expect(
        fetchSpy.mock.calls.every(([, init]) => !init || init.method === 'GET'),
      ).toBe(true);
    } finally {
      engine.stop();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
