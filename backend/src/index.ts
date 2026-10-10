/**
 * @fileoverview Main entry point for the Logistics Sandbox Backend.
 * Sets up Express app, WebSocket server, and simulation engine.
 */

import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { SimulationEngine } from './simulation/engine.js';
import { setupRoutes } from './api/routes.js';
import { setupWebSocket } from './api/websocket.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// Initialize core components
const simulationEngine = new SimulationEngine();

// Mount API routes
app.use('/api', setupRoutes(simulationEngine));

// Setup WebSocket server
setupWebSocket(wss, simulationEngine);

const PORT = process.env.PORT || 3007;

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});
