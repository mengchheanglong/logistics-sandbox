import { useState, useEffect, useRef } from 'react';
import type { SimulationState, SimulationEvent } from '../types';

/**
 * WebSocket hook for receiving real-time simulation state updates.
 * Automatically reconnects with exponential backoff on disconnect.
 */
export function useWebSocket(
  url: string,
  onStateUpdate: (state: SimulationState) => void,
  onEvent: (event: SimulationEvent) => void
) {
  const [connected, setConnected] = useState(false);
  const onStateUpdateRef = useRef(onStateUpdate);
  const onEventRef = useRef(onEvent);

  // Keep refs current to avoid re-triggering effect
  onStateUpdateRef.current = onStateUpdate;
  onEventRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: number;
    let reconnectAttempts = 0;
    let destroyed = false;

    const connect = () => {
      if (destroyed) return;
      ws = new WebSocket(url);

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts = 0;
        console.log('[WS] Connected');
      };

      ws.onclose = () => {
        setConnected(false);
        if (destroyed) return;
        console.log('[WS] Disconnected, reconnecting...');
        const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        reconnectTimer = window.setTimeout(() => {
          reconnectAttempts++;
          connect();
        }, timeout);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'state_update') {
            onStateUpdateRef.current(message.data);
          } else if (message.type === 'event') {
            onEventRef.current(message.data);
          }
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    };

    connect();

    return () => {
      destroyed = true;
      window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [url]);

  return { connected };
}
