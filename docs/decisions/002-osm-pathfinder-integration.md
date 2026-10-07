# ADR-002: osm-pathfinder Integration

## Status

Accepted

## Context

The simulation requires realistic vehicle routing over actual road networks. We have an existing `osm-pathfinder` service — a Rust/Axum HTTP API that provides multiple pathfinding algorithms (Dijkstra, A*, Bidirectional Dijkstra, Bidirectional A*, Contraction Hierarchies) over an in-memory OSM road graph of Cambodia.

Building a separate routing engine would duplicate significant work and produce inferior results.

## Decision

Integrate with `osm-pathfinder` as an **external routing service** via its HTTP API:

```
POST /api/route
{
  start_lat, start_lon, end_lat, end_lon,
  algorithm: "contraction_hierarchies",
  metric: "time",
  departure_time: "08:30"
}
```

Response provides the actual route polyline (`path: [[lon, lat], ...]`), `distance_m`, and `duration_s`.

The simulation advances vehicles along this returned polyline geometry — no straight-line shortcuts.

## Consequences

**Positive:**
- Vehicles follow real road geometry, not fake straight lines
- Multiple routing algorithms available for A/B comparison
- Traffic-aware routing using time-dependent shortest paths
- Route geometry enables realistic ETA calculations
- No duplication of the complex graph/pathfinding codebase

**Negative:**
- External service dependency — osm-pathfinder must be running
- Network latency for each routing request
- Need to handle service unavailability gracefully

**Mitigation:**
- Route caching in the simulation (same O-D pair within time window)
- Batch route requests where possible
- Clear error handling and fallback logging when the service is unavailable
- Health check endpoint (`GET /api/health`) for monitoring
