/**
 * @fileoverview EventBus provides an in-memory pub/sub mechanism for simulation events.
 */

import { EventEmitter } from 'events';
import { SimulationEvent } from '../world/types.js';

export class EventBus {
  private emitter = new EventEmitter();
  private history: SimulationEvent[] = [];

  public emit(event: SimulationEvent): void {
    this.history.push(event);
    this.emitter.emit(event.eventType, event);
    this.emitter.emit('*', event);
  }

  public on(eventType: string, handler: (event: SimulationEvent) => void): void {
    this.emitter.on(eventType, handler);
  }

  public off(eventType: string, handler: (event: SimulationEvent) => void): void {
    this.emitter.off(eventType, handler);
  }

  public getHistory(): SimulationEvent[] {
    return [...this.history];
  }
}
