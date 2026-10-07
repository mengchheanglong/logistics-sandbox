# ADR-001: TypeScript Monorepo

## Status

Accepted

## Context

The Logistics Sandbox requires both a simulation backend and a visual frontend. We need a shared type system between the two to ensure the simulation state types, event types, and API contracts remain consistent. The team has strong TypeScript experience, and the project benefits from a unified development experience.

## Decision

Use a **TypeScript monorepo** with pnpm workspaces containing two packages:

- `@logistics-sandbox/backend` — Express.js + WebSocket simulation server
- `@logistics-sandbox/frontend` — React + Vite visual control room

Both packages share TypeScript interfaces through a common types module.

## Consequences

**Positive:**
- Single language across the entire stack reduces context switching
- Shared type definitions eliminate API contract drift
- pnpm workspaces provide efficient dependency management
- TypeScript strict mode catches errors at compile time

**Negative:**
- The simulation engine runs in Node.js, which is single-threaded; CPU-intensive simulation ticks may need to be offloaded to worker threads
- A compiled language (Rust, Go) could provide better simulation performance for very large fleet sizes (10,000+ vehicles)

**Mitigation:**
- The simulation tick rate is configurable; we can reduce tick frequency for large scenarios
- Worker threads can be introduced for CPU-intensive computations
- The routing computation is already delegated to the Rust-based osm-pathfinder
