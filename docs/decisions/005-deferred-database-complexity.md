# ADR-005: Deferred Database Complexity

## Status

Accepted

## Context

The full architecture envisions multiple specialized databases:

| Database | Role |
|----------|------|
| PostgreSQL | Transactional data (orders, customers, drivers) |
| Redis | Live vehicle state, active routes |
| Cassandra | Historical GPS telemetry (high-volume append-only) |
| Neo4j | Logistics relationship graph (warehouse/depot/driver/vehicle dependencies) |
| Hive/HDFS | Long-term simulation analytics |

The `ecommerce-hive-nosql` project demonstrates successful polyglot persistence with all of these technologies. However, introducing them all at V1 would:
1. Massively increase setup complexity
2. Obscure the core simulation logic
3. Violate the architectural principle: "introduce complexity only when the simulation creates a workload that justifies it"

## Decision

**V1 uses in-memory state only.** All entities, events, and telemetry live in TypeScript Maps and arrays within the simulation process.

Database interfaces are designed upfront so persistence providers can be swapped in without changing the simulation core:

```typescript
interface VehicleStateStore {
  get(vehicleId: string): Promise<VehicleState | null>;
  set(vehicleId: string, state: VehicleState): Promise<void>;
  getAll(): Promise<VehicleState[]>;
}

// V1: InMemoryVehicleStateStore
// V2: RedisVehicleStateStore
```

Each technology is introduced only when the simulation creates its specific scaling pressure.

## Consequences

**Positive:**
- V1 runs with zero external dependencies (besides osm-pathfinder)
- Fast iteration on simulation logic without database overhead
- Clean interfaces make database integration straightforward later
- Each database introduction becomes a learning moment: "we need Cassandra because..."

**Negative:**
- State is lost when the process restarts
- Memory usage grows with simulation size
- No persistence for long-running simulations

**Mitigation:**
- Scenario configs enable quick re-creation of simulation state
- Deterministic replay from seed means state can be reconstructed
- Memory monitoring alerts when approaching limits
