# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for the Logistics Sandbox project.

ADRs document significant architectural decisions, their context, the decision made, and the consequences.

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| 001 | [TypeScript Monorepo](001-typescript-monorepo.md) | Accepted | 2026-10-07 |
| 002 | [osm-pathfinder Integration](002-osm-pathfinder-integration.md) | Accepted | 2026-10-07 |
| 003 | [Event-Driven Simulation](003-event-driven-simulation.md) | Accepted | 2026-10-07 |
| 004 | [MapLibre and deck.gl](004-maplibre-deckgl.md) | Accepted | 2026-10-07 |
| 005 | [Deferred Database Complexity](005-deferred-database-complexity.md) | Accepted | 2026-10-07 |
| 006 | [Deterministic Simulation](006-deterministic-simulation.md) | Accepted | 2026-10-07 |

## Format

Each ADR follows this structure:

```markdown
# ADR-NNN: Title

## Status
Accepted / Proposed / Deprecated / Superseded

## Context
What is the issue that we're seeing that motivates this decision?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this decision?
```
