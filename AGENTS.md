# Logistics Sandbox — Agent Guidelines

## Project Overview

**Logistics Sandbox** is a visual digital-twin sandbox for logistics systems. It simulates a functioning logistics network and provides a control-room interface for observing, testing, and comparing routing algorithms, dispatch strategies, and fleet operations over real road networks.

## Architecture Principles

1. **The visualization displays real simulation state.** The frontend is an observer and control surface — it must never own authoritative simulation state.
2. **Event-driven world model.** All state changes flow through domain events that can be consumed by visualization, replay, analytics, and testing.
3. **Deterministic simulation.** Same seed + same scenario + same configuration = same simulated world.
4. **Introduce complexity only when justified.** Don't add databases/services until the simulation creates a workload that demands them.
5. **Two distinct graph systems.** `osm-pathfinder` owns the physical road graph (routing). Neo4j (when introduced) owns the business/logistics relationship graph. Never confuse them.

## Repository Structure

```
logistics-sandbox/
├── backend/                 # Node.js/TypeScript simulation server
│   ├── src/
│   │   ├── simulation/      # Core simulation runtime & clock
│   │   ├── world/           # World model (entities, state)
│   │   ├── dispatch/        # Dispatch engine (vehicle assignment)
│   │   ├── routing/         # Integration with osm-pathfinder
│   │   ├── events/          # Domain event system
│   │   ├── persistence/     # Database adapters (start in-memory)
│   │   ├── api/             # REST + WebSocket API layer
│   │   └── scenarios/       # Scenario loading & configuration
│   └── tests/
├── frontend/                # React + MapLibre GL + deck.gl control room
│   ├── src/
│   │   ├── components/      # UI components
│   │   ├── map/             # Map visualization layer
│   │   ├── hooks/           # React hooks for simulation state
│   │   ├── stores/          # State management
│   │   └── types/           # TypeScript type definitions
│   └── public/
├── docs/                    # Architecture decisions & documentation
│   ├── ARCHITECTURE.md
│   ├── decisions/
│   └── integration/
├── scenarios/               # Scenario definition files (JSON/YAML)
└── scripts/                 # Utility & setup scripts
```

## Key Integration Points

### osm-pathfinder (External — do NOT modify)

- **Location:** `C:\Users\User\study-workspace\osm-pathfinder`
- **API:** `POST /api/route` with `start_lat`, `start_lon`, `end_lat`, `end_lon`, `algorithm`, `metric`
- **Returns:** `path` (array of `[lon, lat]`), `distance_m`, `duration_s`, `algorithm`, `metric`
- **Role:** Physical road-network routing. All vehicle movement must follow routes returned by this service.
- **Do NOT** create fake straight-line routes.

### ecommerce-hive-nosql (External — reference only)

- **Location:** `C:\Users\User\study-workspace\ecommerce-hive-nosql`
- **Role:** Reference architecture for database patterns (Cassandra telemetry, Neo4j graphs, Redis live state).
- **Do NOT** duplicate its functionality. Learn from its patterns.

## Coding Standards

- **Language:** TypeScript (strict mode) for both backend and frontend
- **Backend framework:** Express.js with WebSocket (ws) for V1 simplicity
- **Frontend framework:** React 18+ with Vite
- **Map library:** MapLibre GL JS + deck.gl for geospatial visualization
- **Testing:** Vitest for unit tests
- **Linting:** ESLint with TypeScript rules
- **Formatting:** Prettier

## Separation of Concerns

| Layer | Responsibility | Must NOT |
|-------|---------------|----------|
| **World Model** | What exists (entities, relationships) | Contain rendering logic |
| **Simulation Runtime** | What happens (tick loop, clock) | Depend on frontend |
| **Routing** | Physical travel paths | Own dispatch decisions |
| **Dispatch** | Task assignment to vehicles | Calculate routes directly |
| **Persistence** | State/history storage | Dictate world model |
| **Events** | What happened (domain events) | Be tightly coupled to DB |
| **Visualization** | What the operator sees | Own simulation state |
| **Analytics** | Performance measurement | Modify simulation |

## Event Model

All domain events must contain:
- `eventId`: UUID
- `simulationId`: string
- `simTimestamp`: number (simulation time in ms)
- `entityType`: string
- `entityId`: string
- `eventType`: string (e.g., `vehicle.position.updated`)
- `payload`: object

## Important Rules

1. **Never hardcode coordinates.** Use the scenario system for geographic configuration.
2. **Vehicle positions come from route geometry.** Vehicles interpolate along the polyline returned by `osm-pathfinder`, never move in straight lines.
3. **The simulation clock is authoritative.** All time-dependent logic uses simulation time, not wall-clock time.
4. **Events are the source of truth for history.** If something happened, there should be an event for it.
5. **Keep V1 simple.** Start with in-memory state. Add Redis/Cassandra/Neo4j only when the simulation creates real scaling problems.

## Browser Support

Allow Baseline Widely Available features. Use modern ES2022+ syntax. Target evergreen browsers only (Chrome, Firefox, Safari, Edge latest).
