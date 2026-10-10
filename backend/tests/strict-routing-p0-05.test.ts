import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { RoutingClient, StrictRoutingError } from '../src/routing/client.js';
import { SimulationEngine } from '../src/simulation/engine.js';
import { setupRoutes } from '../src/api/routes.js';

describe('Milestone M1: P0-05 Strict Routing & Graph Provenance Gate', () => {
  let engine: SimulationEngine;

  beforeEach(() => {
    engine = new SimulationEngine();
  });

  afterEach(() => {
    engine.stop();
    vi.restoreAllMocks();
  });

  describe('1. RoutingClient Strict Mode & Fallback Prevention', () => {
    it('returns marked fallback route in non-strict mode when router is unavailable', async () => {
      const client = new RoutingClient('http://127.0.0.1:9999'); // non-existent port
      client.setStrictMode(false);

      const route = await client.calculateRoute(
        { lat: 11.5564, lon: 104.9282 },
        { lat: 11.5720, lon: 104.8980 }
      );

      expect(route).toBeDefined();
      expect(route.algorithm).toBe('fallback_direct');
      expect(route.isFallback).toBe(true);
      expect(route.path.length).toBe(2);
      expect(route.distanceM).toBeGreaterThan(0);
    });

    it('strictly throws StrictRoutingError when router is unavailable in strict mode', async () => {
      const client = new RoutingClient('http://127.0.0.1:9999');
      client.setStrictMode(true);

      await expect(
        client.calculateRoute(
          { lat: 11.5564, lon: 104.9282 },
          { lat: 11.5720, lon: 104.8980 }
        )
      ).rejects.toThrow(StrictRoutingError);
    });

    it('rejects demo graphs when requireRealGraph is specified', async () => {
      const client = new RoutingClient('http://127.0.0.1:8000');
      // Mock fetch returning a demo response
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: [[104.9282, 11.5564], [104.8980, 11.5720]],
          distance_m: 3500.0,
          duration_s: 420.0,
          algorithm: 'astar',
          nodes_visited: 15,
          query_time_ms: 1.2,
          is_demo: true,
          graph_version: 'demo-cambodia-v1.0',
          cost_model_version: 'tdsp-profiles-v1.0',
        }),
      } as Response);

      await expect(
        client.calculateRoute(
          { lat: 11.5564, lon: 104.9282 },
          { lat: 11.5720, lon: 104.8980 },
          { requireRealGraph: true }
        )
      ).rejects.toThrow(/Real road graph required/);
    });

    it('populates provenance metadata correctly on successful real route query', async () => {
      const client = new RoutingClient('http://127.0.0.1:8000');
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          path: [[104.9282, 11.5564], [104.8980, 11.5720]],
          distance_m: 3500.0,
          duration_s: 420.0,
          algorithm: 'astar',
          nodes_visited: 15,
          query_time_ms: 1.2,
          is_demo: false,
          graph_version: 'cambodia-latest-2026',
          cost_model_version: 'tdsp-profiles-v1.0',
        }),
      } as Response);

      const route = await client.calculateRoute(
        { lat: 11.5564, lon: 104.9282 },
        { lat: 11.5720, lon: 104.8980 },
        { requireRealGraph: true }
      );

      expect(route.isFallback).toBe(false);
      expect(route.isDemo).toBe(false);
      expect(route.graphVersion).toBe('cambodia-latest-2026');
      expect(route.costModelVersion).toBe('tdsp-profiles-v1.0');
    });
  });

  describe('2. Simulation Engine Run Invalidation on Routing Failure', () => {
    it('invalidates simulation run and halts movement on strict routing failure', () => {
      engine.setStrictRouting(true);
      expect(engine.isStrictRouting()).toBe(true);

      engine.invalidateRun('Routing service offline during scored evaluation');

      expect(engine.getStatus()).toBe('invalidated');
      const state = engine.getState();
      expect(state.status).toBe('invalidated');
      expect(state.invalidationReason).toBe('Routing service offline during scored evaluation');
    });

    it('clears invalidation status and reason upon clean reset', () => {
      engine.setStrictRouting(true);
      engine.invalidateRun('Test invalidation');
      expect(engine.getStatus()).toBe('invalidated');

      engine.reset();
      expect(engine.getStatus()).toBe('stopped');
      expect(engine.getState().invalidationReason).toBeUndefined();
    });
  });

  describe('3. REST API Endpoints for Strict Routing & Provenance', () => {
    it('configures strict routing and queries provenance via HTTP', async () => {
      const app = express();
      app.use(express.json());
      app.use('/api', setupRoutes(engine));
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address() as AddressInfo;

      try {
        // 1. POST /api/simulation/strict-routing
        const postRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/api/simulation/strict-routing',
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
          req.end(JSON.stringify({ strict: true, requireRealGraph: true }));
        });

        expect(postRes.status).toBe(200);
        expect(postRes.body.success).toBe(true);
        expect(postRes.body.strictRouting).toBe(true);
        expect(postRes.body.requireRealGraph).toBe(true);

        // 2. GET /api/simulation/provenance
        const getRes = await new Promise<{ status: number; body: any }>((resolve, reject) => {
          const req = httpRequest(
            {
              host: '127.0.0.1',
              port: address.port,
              path: '/api/simulation/provenance',
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

        expect(getRes.status).toBe(200);
        expect(getRes.body).toHaveProperty('isDemo');
        expect(getRes.body).toHaveProperty('graphVersion');
        expect(getRes.body).toHaveProperty('costModelVersion');
        expect(getRes.body.strictRouting).toBe(true);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    });
  });
});
