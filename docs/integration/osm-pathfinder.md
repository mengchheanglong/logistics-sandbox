# Integration: osm-pathfinder

## Overview

The Logistics Sandbox integrates with [osm-pathfinder](../../osm-pathfinder) as its routing engine. All vehicle routing computations are delegated to this external Rust service, which provides real road-network pathfinding over OpenStreetMap data.

## Service Details

| Property | Value |
|----------|-------|
| Language | Rust |
| Framework | Axum |
| Default Port | 3000 |
| Data Source | Cambodia OSM PBF |
| Graph Type | In-memory adjacency list |
| Spatial Index | R-tree (rstar) |

## API Contract

### Health Check

```http
GET /api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

### Graph Statistics

```http
GET /api/graph/stats
```

```json
{
  "nodes": 245891,
  "edges": 512437
}
```

### Route Calculation

```http
POST /api/route
Content-Type: application/json

{
  "start_lat": 11.5564,
  "start_lon": 104.9282,
  "end_lat": 11.5725,
  "end_lon": 104.9160,
  "algorithm": "contraction_hierarchies",
  "metric": "time",
  "departure_time": "08:30"
}
```

**Response:**

```json
{
  "path": [[104.9282, 11.5564], [104.9275, 11.5570], ...],
  "explored": [[104.93, 11.55], ...],
  "distance_m": 3842.5,
  "duration_s": 612.3,
  "nodes_visited": 17,
  "query_time_ms": 0.008,
  "algorithm": "contraction_hierarchies",
  "metric": "time",
  "departure_time": "08:30",
  "start_snapped": [104.9282, 11.5564],
  "end_snapped": [104.9160, 11.5725]
}
```

### Available Algorithms

| Algorithm | Key | Typical Speed | Best For |
|-----------|-----|--------------|----------|
| Dijkstra | `dijkstra` | ~50ms | Baseline, correctness verification |
| A* | `astar` | ~20ms | General purpose |
| Bidirectional Dijkstra | `bidirectional_dijkstra` | ~25ms | Reducing search space |
| Bidirectional A* | `bidirectional_astar` | ~10ms | Fast, good heuristic |
| Contraction Hierarchies | `contraction_hierarchies` | <1ms | Production throughput |

### Cost Metrics

| Metric | Description |
|--------|-------------|
| `distance` | Shortest path by physical distance (meters) |
| `time` | Fastest path by estimated travel time (seconds) |

### Traffic Model

When `departure_time` is provided with `metric: "time"`, the routing engine applies time-dependent edge weights:

- **Morning peak** (07:30–09:00): Up to 4x travel time multiplier
- **Evening peak** (17:00–19:00): Similar congestion modeling
- **Spatial factors**: Higher congestion near major Cambodian cities (Phnom Penh, Siem Reap, etc.)

### Isochrone (Future Use)

```http
POST /api/isochrone
Content-Type: application/json

{
  "lat": 11.5564,
  "lon": 104.9282,
  "buckets": [300, 600, 900, 1200]
}
```

Returns GeoJSON FeatureCollection with travel-time contour polygons.

## Integration Pattern

```
Simulation Engine
    │
    ├── Order needs delivery
    │
    ├── Dispatcher selects vehicle
    │
    ├── RoutingClient.calculateRoute(
    │       depot.position,
    │       customer.position,
    │       { algorithm: 'contraction_hierarchies', metric: 'time' }
    │   )
    │
    ├── osm-pathfinder returns polyline + distance + duration
    │
    ├── Vehicle.routeGeometry = response.path
    │   Vehicle.routeDistanceM = response.distance_m
    │   Vehicle.routeDurationS = response.duration_s
    │
    └── Simulation tick interpolates vehicle position along polyline
```

## Prerequisites

1. Download Cambodia OSM data:
   ```bash
   # Use the script from osm-pathfinder
   cd ../osm-pathfinder
   ./scripts/download_cambodia_osm.sh
   ```

2. Start the routing engine:
   ```bash
   cd ../osm-pathfinder
   cargo run -- --data data/cambodia-latest.osm.pbf
   ```

3. Verify it's running:
   ```bash
   curl http://localhost:3000/api/health
   ```

## Error Handling

The `RoutingClient` in the sandbox handles these failure modes:

| Scenario | Handling |
|----------|----------|
| Service unavailable | Log warning, skip route assignment, retry on next tick |
| Route not found | Mark order as unroutable, emit event |
| Timeout (>5s) | Cancel request, retry with simpler algorithm |
| Invalid coordinates | Snap to nearest valid node via spatial index |
