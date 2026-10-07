/**
 * @fileoverview Express routes for controlling and inspecting the simulation.
 */

import { Router } from 'express';
import { SimulationEngine } from '../simulation/engine.js';
import { defaultScenario } from '../scenarios/default.js';

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
    res.json({ status: 'paused' });
  });

  router.post('/simulation/resume', (req, res) => {
    engine.resume();
    res.json({ status: 'resumed' });
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

  router.get('/orders/:id', (req, res) => {
    const o = engine.world.getOrder(req.params.id);
    if (o) res.json(o);
    else res.status(404).json({ error: 'Order not found' });
  });

  router.post('/events/inject', (req, res) => {
    const result = engine.injectEvent(req.body);
    res.json({ status: 'event_injected', ...result });
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
    const result = engine.loadScenario(scenarioId);
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
  router.get('/integrations/ecommerce/status', (req, res) => {
    res.json(engine.ecommerceClient.getStatus());
  });

  router.post('/integrations/ecommerce/order', (req, res) => {
    const eOrder = req.body;
    if (!eOrder || !eOrder.order_id) {
      res.status(400).json({ error: 'order_id is required' });
      return;
    }
    const order = engine.ingestEcommerceOrder(eOrder);
    res.json({ status: 'order_ingested', order });
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

  return router;
}
