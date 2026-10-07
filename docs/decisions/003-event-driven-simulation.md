# ADR-003: Event-Driven Simulation

## Status

Accepted

## Context

The simulation needs to communicate state changes to multiple consumers: the visual frontend, the persistence layer, the analytics system, and (eventually) the replay system. A request-response model would tightly couple these consumers to the simulation engine.

The `ecommerce-hive-nosql` project demonstrates effective use of event patterns for telemetry ingestion (Cassandra time-series) and state management.

## Decision

Adopt an **event-driven world model** where all simulation state changes are expressed as domain events:

```typescript
interface SimulationEvent {
  eventId: string;
  simulationId: string;
  simTimestamp: number;
  realTimestamp: number;
  entityType: string;
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
```

Events are emitted through an in-memory EventBus (V1) that can later be backed by Redis Pub/Sub, Kafka, or similar.

## Consequences

**Positive:**
- Decoupled consumers — add new consumers without modifying the simulation
- Natural fit for WebSocket broadcasting to the frontend
- Events form a complete audit trail for replay
- Same events feed visualization, persistence, and analytics
- Clean foundation for introducing message brokers later

**Negative:**
- Event ordering must be maintained within an entity
- In-memory event history grows unbounded without pruning
- Debugging event flows can be harder than direct state inspection

**Mitigation:**
- Events include monotonic simulation timestamps for ordering
- Event history is pruned periodically (configurable retention)
- Comprehensive event logging for debugging
