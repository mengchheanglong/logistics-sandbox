/**
 * @fileoverview Express routes for controlling and inspecting the simulation.
 */

import { Router } from 'express';
import { SimulationEngine } from '../simulation/engine.js';
import { defaultScenario } from '../scenarios/default.js';
import { SCENARIO_PRESETS } from '../scenarios/presets.js';

export function setupRoutes(engine: SimulationEngine): Router {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/simulation/state', (req, res) => {
    res.json(engine.getState());
  });

  router.post('/simulation/start', (req, res) => {
    engine.start();
    res.json({ status: 'started' });
  });

  router.post('/simulation/stop', (req, res) => {
    engine.stop();
    res.json({ status: 'stopped' });
  });

  router.post('/simulation/speed', (req, res) => {
    const { speed } = req.body;
    if (typeof speed === 'number') {
      engine.setSpeed(speed);
      res.json({ status: 'speed_updated', speed });
    } else {
      res.status(400).json({ error: 'Invalid speed' });
    }
  });

  router.post('/simulation/pause', (req, res) => {
    engine.pause();
    res.json({ status: 'paused', simulationStatus: 'paused' });
  });

  router.post('/simulation/resume', (req, res) => {
    engine.resume();
    res.json({ status: 'resumed', simulationStatus: 'running' });
  });

  router.post('/simulation/step', (req, res) => {
    const { steps = 1, deltaSimMs, deltaMs } = req.body || {};
    const computedDeltaSimMs =
      typeof deltaSimMs === 'number'
        ? deltaSimMs
        : typeof deltaMs === 'number'
          ? deltaMs * (engine.clock.speed || 1) * 60
          : undefined;
    const result = engine.step(Number(steps) || 1, computedDeltaSimMs);
    res.json({
      success: true,
      ...result,
      status: engine.getStatus(),
      state: engine.getState(),
    });
  });

  router.post('/simulation/reset', (req, res) => {
    const { scenarioId, seedOrders = false } = req.body || {};
    const scenario = scenarioId ? SCENARIO_PRESETS[scenarioId] : undefined;
    const result = engine.reset(scenario, { seedOrders: Boolean(seedOrders) });
    res.json(result);
  });

  router.get('/simulation/events/hash', (req, res) => {
    res.json(engine.getEventSequenceHash());
  });

  router.post('/simulation/strict-routing', (req, res) => {
    const { strict = true, requireRealGraph = false } = req.body || {};
    engine.setStrictRouting(Boolean(strict), Boolean(requireRealGraph));
    res.json({
      success: true,
      strictRouting: engine.isStrictRouting(),
      requireRealGraph: Boolean(requireRealGraph),
      status: engine.getStatus(),
    });
  });

  router.get('/simulation/provenance', async (req, res) => {
    const prov = await engine.routingClient.getProvenance();
    res.json({
      ...prov,
      strictRouting: engine.isStrictRouting(),
      runStatus: engine.getStatus(),
    });
  });

  router.post('/simulation/algorithm', (req, res) => {
    const { routingAlgorithm, dispatchStrategy } = req.body;
    const updated = engine.setAlgorithms({ routingAlgorithm, dispatchStrategy });
    res.json({ status: 'algorithm_updated', ...updated });
  });

  router.get('/simulation/benchmark', (req, res) => {
    res.json(engine.getBenchmarkStats());
  });

  router.get('/vehicles', (req, res) => {
    res.json(engine.world.getAllVehicles());
  });

  router.get('/vehicles/:id', (req, res) => {
    const v = engine.world.getVehicle(req.params.id);
    if (v) res.json(v);
    else res.status(404).json({ error: 'Vehicle not found' });
  });

  router.get('/orders', (req, res) => {
    res.json(engine.world.getAllOrders());
  });

  router.get('/orders/presets', (req, res) => {
    res.json(engine.getDeliveryPresets());
  });

  router.post('/orders/inject', async (req, res) => {
    try {
      const result = await engine.injectCustomOrder(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to inject order' });
    }
  });

  router.get('/orders/:id', (req, res) => {
    const o = engine.world.getOrder(req.params.id);
    if (o) res.json(o);
    else res.status(404).json({ error: 'Order not found' });
  });

  router.post('/events/inject', async (req, res) => {
    try {
      const result = await engine.injectEventAsync(req.body || {});
      res.json({ status: 'event_injected', ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to inject event' });
    }
  });

  router.get('/scenarios', (req, res) => {
    res.json(engine.getScenarioPresets());
  });

  router.post('/scenarios/load', (req, res) => {
    const { scenarioId } = req.body || {};
    if (!scenarioId) {
      res.status(400).json({ error: 'scenarioId is required' });
      return;
    }
    const result = engine.loadScenario(scenarioId, { seedOrders: true });
    if (!result.success) {
      res.status(404).json(result);
    } else {
      res.json(result);
    }
  });

  router.post('/scenarios/:id/load', (req, res) => {
    const scenarioId = req.params.id;
    const result = engine.loadScenario(scenarioId, { seedOrders: true });
    if (!result.success) {
      res.status(404).json(result);
    } else {
      res.json(result);
    }
  });

  router.get('/stats', (req, res) => {
    res.json(engine.getState().stats);
  });

  // In-flight Dynamic Re-routing & Incident Management
  router.post('/vehicles/:id/reroute', async (req, res) => {
    const { reason, avoidIncidents } = req.body || {};
    const result = await engine.rerouteVehicle(req.params.id, { reason, avoidIncidents });
    if (!result.success) {
      res.status(400).json(result);
    } else {
      res.json(result);
    }
  });

  router.post('/fleet/reroute', async (req, res) => {
    const { reason, avoidIncidents } = req.body || {};
    const result = await engine.rerouteEnRouteFleet(reason, avoidIncidents);
    res.json(result);
  });

  router.get('/incidents', (req, res) => {
    res.json(engine.getActiveIncidents());
  });

  router.post('/incidents', (req, res) => {
    const { type, description, position, radiusM, severity, autoRerouteAffected } = req.body || {};
    if (!type || !description || !position || !radiusM) {
      res.status(400).json({ error: 'type, description, position, and radiusM are required' });
      return;
    }
    const incident = engine.createRoadIncident({
      type,
      description,
      position,
      radiusM,
      severity,
      autoRerouteAffected,
    });
    res.json({ status: 'incident_created', incident });
  });

  router.delete('/incidents/:id', (req, res) => {
    const cleared = engine.clearRoadIncident(req.params.id);
    if (cleared) {
      res.json({ status: 'incident_cleared', id: req.params.id });
    } else {
      res.status(404).json({ error: 'Incident not found or already inactive' });
    }
  });

  // Upstream ecommerce-hive-nosql integration endpoints
  router.get('/integrations/ecommerce/status', async (req, res) => {
    await engine.ecommerceClient.checkHealth();
    res.json(engine.ecommerceClient.getStatus());
  });

  router.post('/integrations/ecommerce/sync', async (req, res) => {
    const isUp = await engine.ecommerceClient.checkHealth();
    if (!isUp) {
      res.status(503).json({
        status: 'unavailable',
        message: 'ecommerce-hive-nosql is not responding on port 4000',
        bridge: engine.ecommerceClient.getStatus(),
      });
      return;
    }

    const pendingOrders = await engine.ecommerceClient.fetchPendingOrders();
    let count = 0;
    for (const eOrder of pendingOrders) {
      if (!engine.world.getOrder(eOrder.order_id)) {
        engine.ingestEcommerceOrder(eOrder);
        count++;
      }
    }

    res.json({
      status: 'synced',
      ordersIngested: count,
      bridge: engine.ecommerceClient.getStatus(),
    });
  });

  // Instant webhook push from upstream ecommerce-hive-nosql
  router.post('/integrations/ecommerce/order', (req, res) => {
    const eOrder = req.body;
    if (!eOrder || !eOrder.order_id) {
      res.status(400).json({ error: 'Valid order with order_id is required' });
      return;
    }
    const order = engine.ingestEcommerceOrder(eOrder);
    res.json({
      success: true,
      orderId: order.id,
      status: order.status,
      assignedVehicleId: order.assignedVehicleId,
    });
  });

  // Apache Hive 3.1 Big Data OLAP Warehouse Analytics (Cold Path)
  router.get('/integrations/ecommerce/warehouse', async (req, res) => {
    const analytics = await engine.ecommerceClient.fetchWarehouseAnalytics();
    if (!analytics) {
      res.status(503).json({
        error: 'Warehouse analytics unavailable from ecommerce-hive-nosql on port 4000',
      });
      return;
    }
    res.json(analytics);
  });

  router.get('/integrations/ecommerce/warehouse/query/:queryId', async (req, res) => {
    const { queryId } = req.params;
    const result = await engine.ecommerceClient.executeHiveQuery(queryId);
    res.json(result);
  });

  // Phase 3 Persistence Layer & Inventory Inspection Endpoints
  router.get('/persistence/status', (req, res) => {
    res.json(engine.persistence.getStatus());
  });

  router.get('/telemetry/rider/:riderId', async (req, res) => {
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      res.status(400).json({ error: 'limit must be an integer from 1 to 1000' });
      return;
    }
    const simulationId = engine.getSimulationId();
    const pings = await engine.persistence.telemetry.getRecentPings(req.params.riderId, limit, simulationId);
    res.json({
      schemaVersion: 1, source: 'simulated', sourceId: simulationId, simulationId, tenantId: 'demo',
      storage: 'in-memory', durable: false, sinkOwner: 'logistics-sandbox', status: 'available',
      units: { coordinates: 'degrees', speed: 'km/h', battery: 'percent', time: 'simulation-ms' },
      riderId: req.params.riderId,
      count: pings.length,
      pings,
    });
  });

  router.get('/orders/history', async (req, res) => {
    const status = req.query.status as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const orders = await engine.persistence.orders.getAllOrders({ status, customerId });
    const metrics = await engine.persistence.orders.getMetrics();
    res.json({
      metrics,
      count: orders.length,
      orders,
    });
  });

  router.get('/inventory/catalog', (req, res) => {
    const catalog = engine.world.getCatalog();
    res.json({
      count: catalog.length,
      connected: engine.ecommerceClient.getStatus().connected,
      products: catalog,
    });
  });

  router.post('/inventory/adjust', (_req, res) => {
    res.status(403).json({ success: false, egressPolicy: 'DISABLED', error: 'Operational inventory writes are disabled in the simulator' });
  });

  // Phase 3 Neo4j Relationship Graph & Impact Analysis Endpoints
  router.get('/graph/status', (req, res) => {
    res.json(engine.persistence.relationships.getStatus());
  });

  router.get('/graph/topology', async (req, res) => {
    const topology = await engine.persistence.relationships.getGraphTopology();
    res.json({
      status: 'ok',
      nodeCount: topology.nodes.length,
      relationshipCount: topology.relationships.length,
      ...topology,
    });
  });

  router.get('/graph/impact/:entityType/:entityId', async (req, res) => {
    const { entityType, entityId } = req.params;
    if (entityType !== 'depot' && entityType !== 'vehicle' && entityType !== 'warehouse') {
      res.status(400).json({ error: 'entityType must be depot, vehicle, or warehouse' });
      return;
    }
    const impact = await engine.persistence.relationships.getImpactAnalysis(entityType, entityId);
    res.json(impact);
  });

  router.post('/graph/query', (_req, res) => {
    res.status(403).json({ success: false, egressPolicy: 'DISABLED', error: 'Remote Cypher execution is disabled in the simulator' });
  });

  router.post('/graph/sync', async (req, res) => {
    await engine.persistence.relationships.syncTopology(
      engine.world.getAllWarehouses(),
      engine.world.getAllVehicles(),
      engine.world.getAllDrivers()
    );
    res.json({
      success: true,
      message: 'World topology synchronized to local simulation relationship graph',
      status: engine.persistence.relationships.getStatus(),
    });
  });

  // Volatile simulated telemetry, scoped to the current run.
  router.get('/telemetry/playback', async (req, res) => {
    const riderId = (req.query.riderId as string) || (req.query.vehicleId as string);
    if (!riderId) {
      res.status(400).json({ error: 'riderId or vehicleId query parameter is required' });
      return;
    }

    // Try finding vehicle driver ID if vehicle ID was passed
    const vehicle = engine.world.getVehicle(riderId);
    const targetRiderId = vehicle?.driverId || riderId;

    const limit = req.query.limit === undefined ? 250 : Number(req.query.limit);
    const startMs = req.query.startTime ? Number(req.query.startTime) : undefined;
    const endMs = req.query.endTime ? Number(req.query.endTime) : undefined;

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
        ((startMs === undefined) !== (endMs === undefined)) ||
        (startMs !== undefined && endMs !== undefined &&
          (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs))) {
      res.status(400).json({ error: 'Invalid limit or time range' });
      return;
    }
    const simulationId = engine.getSimulationId();

    let pings = [];
    if (startMs !== undefined && endMs !== undefined) {
      pings = (await engine.persistence.telemetry.getPingsByTimeRange(targetRiderId, startMs, endMs, simulationId)).slice(-limit);
    } else {
      pings = await engine.persistence.telemetry.getRecentPings(targetRiderId, limit, simulationId);
    }

    // Sort chronologically ascending (oldest to newest) for smooth playback progression
    pings.sort((a, b) => a.ping_timestamp - b.ping_timestamp);

    // Compute playback trip metadata
    const maxSpeedKmh = pings.reduce((max, p) => Math.max(max, p.speed_kmh || 0), 0);
    const avgSpeedKmh = pings.length > 0
      ? pings.reduce((sum, p) => sum + (p.speed_kmh || 0), 0) / pings.length
      : 0;

    const startPing = pings[0];
    const endPing = pings[pings.length - 1];
    const durationSeconds = startPing && endPing
      ? Math.max(0, Math.round((endPing.ping_timestamp - startPing.ping_timestamp) / 1000))
      : 0;

    res.json({
      schemaVersion: 1, source: 'simulated', sourceId: simulationId, simulationId, tenantId: 'demo',
      storage: 'in-memory', durable: false, sinkOwner: 'logistics-sandbox', status: 'available',
      units: { coordinates: 'degrees', speed: 'km/h', battery: 'percent', time: 'simulation-ms' },
      riderId: targetRiderId,
      vehicleId: vehicle?.id || null,
      vehicleName: vehicle?.name || targetRiderId,
      count: pings.length,
      pings,
      summary: {
        startTime: startPing?.ping_timestamp ?? null,
        endTime: endPing?.ping_timestamp ?? null,
        durationSeconds,
        maxSpeedKmh: Number(maxSpeedKmh.toFixed(1)),
        avgSpeedKmh: Number(avgSpeedKmh.toFixed(1)),
        startCoord: startPing ? { lat: startPing.lat, lon: startPing.lon } : null,
        endCoord: endPing ? { lat: endPing.lat, lon: endPing.lon } : null,
      },
    });
  });

  // Phase 4: AI Predictive Ops & District Forecasting Endpoints
  router.get('/ai/predictive/status', (req, res) => {
    res.json(engine.getPredictiveAiMetrics());
  });

  router.post('/ai/predictive/rebalance', async (req, res) => {
    const result = await engine.triggerPredictiveRebalance();
    res.json(result);
  });

  // Feature: Automated SLA Breach Risk Mitigation Directive
  router.post('/ai/predictive/mitigate', async (req, res) => {
    const { orderId } = req.body || {};
    if (!orderId) {
      res.status(400).json({ error: 'orderId is required' });
      return;
    }
    const result = await engine.mitigateSlaBreachRisk(orderId);
    res.json(result);
  });

  // Feature: Phnom Penh Urban Chaos Engine (Crisis Simulation & Self-Healing)
  router.get('/simulation/chaos', (req, res) => {
    res.json(engine.getChaosMetrics());
  });

  router.post('/simulation/chaos', (req, res) => {
    const { mode } = req.body || {};
    if (['off', 'low', 'medium', 'extreme'].includes(mode)) {
      engine.setChaosMode(mode);
      res.json({ success: true, mode, metrics: engine.getChaosMetrics() });
    } else {
      res.status(400).json({ error: 'Invalid mode. Must be: off, low, medium, or extreme.' });
    }
  });

  return router;
}

