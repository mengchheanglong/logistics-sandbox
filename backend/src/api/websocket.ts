/**
 * @fileoverview WebSocket handler for broadcasting simulation state and events.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { SimulationEngine } from '../simulation/engine.js';
import { SimulationEvent } from '../world/types.js';

export function setupWebSocket(wss: WebSocketServer, engine: SimulationEngine): void {
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    
    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('message', (msg) => {
      if (msg.toString() === 'ping') {
        ws.send('pong');
      }
    });
  });

  // Broadcast state periodically
  setInterval(() => {
    if (clients.size > 0 && engine.getState().status === 'running') {
      const stateMsg = JSON.stringify({
        type: 'state_update',
        data: engine.getState()
      });
      clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
          c.send(stateMsg);
        }
      });
    }
  }, 1000); // 1s state updates

  // Broadcast events as they happen
  engine.eventBus.on('*', (event: SimulationEvent) => {
    const eventMsg = JSON.stringify({
      type: 'event',
      data: event
    });
    clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(eventMsg);
      }
    });
  });
}
