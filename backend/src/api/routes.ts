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
    engine.injectEvent(req.body);
    res.json({ status: 'event_injected' });
  });

  router.get('/scenarios', (req, res) => {
    res.json([defaultScenario]);
  });

  router.get('/stats', (req, res) => {
    res.json(engine.getState().stats);
  });

  return router;
}
