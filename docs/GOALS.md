# Project Goals

## Ultimate Vision

> **A visual experimental environment where routing algorithms, dispatch strategies, databases, distributed systems, and logistics models can all be tested against the same simulated world.**

The goal is not merely to build a logistics application. The goal is to build the **world in which logistics systems can be built, observed, broken, measured, compared, and improved.**

---

## Core Principles

### 1. Reality Over Aesthetics

The visualization displays what the real simulated system is doing. If a truck moves on the map, that movement comes from actual simulation state. If a route changes, the routing engine recalculated it. If a vehicle stops, there is an underlying event.

### 2. Complexity When Justified

Technologies are introduced only when the simulation creates a workload that demands them. The project is a learning environment for understanding **why technologies exist**, not merely demonstrating that we can run them.

### 3. Determinism Enables Science

Same seed + same scenario + same configuration = same simulated world. This makes the sandbox an engineering test bench where algorithms can be fairly compared.

### 4. Separation of Concerns

The frontend is an observer. The simulation is authoritative. The routing engine computes paths. The dispatch engine assigns work. Events connect everything. Each responsibility has a clear owner.

---

## What We Want to Be Able to Do

### Algorithm Comparison

```
Scenario: 1000 deliveries in Phnom Penh, morning traffic

Run A: Dijkstra routing + nearest-driver dispatch
Run B: A* routing + nearest-driver dispatch
Run C: Contraction Hierarchies + route-aware dispatch
Run D: Contraction Hierarchies + VRP optimizer

Compare: on-time %, total distance, driver utilization, avg delivery time
```

### Infrastructure Experiments

```
Same scenario, measure:
- Telemetry ingestion throughput
- Redis live-state latency
- Cassandra write throughput
- Neo4j dependency traversal latency
- Routing service response time
- Event stream throughput
```

### Stress Testing

```
Scale from 50 → 500 → 5,000 vehicles
Observe: where does the system break?
Answer: why? And what solves it?
```

### Incident Response

```
At 10:30, close Depot B
Watch: the system detects affected deliveries,
       the dispatcher reassigns work,
       vehicles reroute,
       the network adapts.
```

### Fleet Optimization

```
What happens if we add 10 motorcycles instead of 5 trucks?
What if we open a third depot at location X?
What if driver shifts overlap by 2 hours?
```

---

## Phased Delivery

### Phase 1 — Vertical Slice (Current)

A single working loop: generate order → dispatch vehicle → calculate real route → move vehicle → deliver → observe on map.

- 20-50 vehicles, 2 depots, 100-500 orders
- In-memory state
- osm-pathfinder integration
- WebSocket live updates
- Interactive MapLibre + deck.gl map
- Simulation clock with speed controls
- Basic vehicle inspection

### Phase 2 — Persistence & Scale

- Redis for live vehicle state
- Cassandra for GPS telemetry history
- Multiple dispatch algorithms
- Operator event injection
- Demand heatmaps
- Performance metrics dashboard

### Phase 3 — Relationships & Intelligence

- Neo4j logistics relationship graph
- Impact analysis for incidents
- Advanced dispatch (VRP, VRPTW)
- Scenario comparison (side-by-side runs)
- Dynamic rerouting on incidents
- Multiple routing algorithm support in same run

### Phase 4 — Analytics & Experimentation

- Hive/HDFS for long-term simulation analytics
- A/B experiment framework
- Fleet performance reports
- Deterministic replay with diff
- Benchmark suite

---

## Success Criteria

The project succeeds when:

1. ✅ A simulation runs and vehicles move along real road geometry
2. ✅ Clicking a vehicle shows its actual simulation state, not fake data
3. ✅ Pausing the simulation freezes all vehicles
4. ✅ The same seed produces the same simulation
5. ✅ Changing the routing algorithm produces measurably different outcomes
6. ✅ An operator can inject an incident and watch the system adapt
7. ✅ Two dispatch strategies can be compared on the same scenario
8. ✅ The system scales beyond toy examples to meaningful fleet sizes
9. ✅ Each database serves a genuine architectural need, not decoration
10. ✅ An engineer can read the codebase and understand every technology choice
