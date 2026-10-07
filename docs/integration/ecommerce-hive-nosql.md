# Integration: ecommerce-hive-nosql (Reference)

## Overview

The [ecommerce-hive-nosql](../../ecommerce-hive-nosql) project is a **reference architecture**, not a direct integration dependency. It demonstrates polyglot persistence patterns that the Logistics Sandbox will adopt when scaling demands justify additional databases.

> **Important:** Do not duplicate functionality. Learn from patterns and adapt them.

## Patterns to Adopt

### 1. Cassandra — Time-Series Telemetry

**Source pattern:** `rider_gps_pings` table

```cql
CREATE TABLE telemetry_ks.rider_gps_pings (
    rider_id TEXT,
    ping_date DATE,
    ping_timestamp TIMESTAMP,
    latitude DOUBLE,
    longitude DOUBLE,
    speed_kmh DOUBLE,
    battery_level INT,
    status TEXT,
    PRIMARY KEY ((rider_id, ping_date), ping_timestamp)
) WITH CLUSTERING ORDER BY (ping_timestamp DESC)
  AND default_time_to_live = 2592000
  AND compaction = { 'class': 'TimeWindowCompactionStrategy', 'compaction_window_size': 1, 'compaction_window_unit': 'DAYS' };
```

**Adaptation for Logistics Sandbox (Phase 2):**

```cql
CREATE TABLE logistics_ks.vehicle_telemetry (
    vehicle_id TEXT,
    event_date DATE,
    event_timestamp TIMESTAMP,
    latitude DOUBLE,
    longitude DOUBLE,
    speed_kmh DOUBLE,
    heading DOUBLE,
    current_order_id TEXT,
    route_id TEXT,
    route_progress DOUBLE,
    status TEXT,
    PRIMARY KEY ((vehicle_id, event_date), event_timestamp)
) WITH CLUSTERING ORDER BY (event_timestamp DESC)
  AND default_time_to_live = 2592000;
```

**Why Cassandra for telemetry:**
- Write-optimized: handles 160+ writes/sec per node (from ecommerce-hive reference)
- Time-partitioned: efficient range queries by vehicle + date
- TTL: automatic data expiration for old telemetry
- Masterless: no single point of failure

### 2. Neo4j — Relationship Graph

**Source pattern:** Customer referral network

```cypher
MATCH path = (origin:Customer)-[:REFERRED*1..3]->(ref:Customer)
WHERE origin.id = $customerId
RETURN path
```

**Adaptation for Logistics Sandbox (Phase 3):**

```cypher
// Logistics relationship graph
CREATE (w:Warehouse {id: 'WH-001', name: 'Central Warehouse', lat: 11.57, lon: 104.92})
CREATE (d:Depot {id: 'DEP-A', name: 'Depot A', lat: 11.568, lon: 104.922})
CREATE (v:Vehicle {id: 'TRUCK-017', type: 'truck', capacity_kg: 800})
CREATE (dr:Driver {id: 'DRV-042', name: 'Sokha'})
CREATE (r:Route {id: 'R-00172', algorithm: 'astar'})
CREATE (o:Order {id: 'O-82712', status: 'in_transit'})

CREATE (w)-[:SUPPLIES]->(d)
CREATE (d)-[:DISPATCHES]->(v)
CREATE (dr)-[:DRIVES]->(v)
CREATE (v)-[:FOLLOWS]->(r)
CREATE (r)-[:DELIVERS]->(o)
CREATE (o)-[:DESTINED_FOR]->(c:Customer {id: 'C-2991'})
```

**Use cases:**
- Impact analysis: "If Depot B closes, which orders are affected?"
- Supply chain traversal: "Trace all orders from Warehouse W through Depot D"
- Driver-vehicle-route relationships for fleet management
- Dependency reasoning for incident response

### 3. Redis — Live State Cache

**Source pattern:** Shopping cart with TTL

**Adaptation for Logistics Sandbox (Phase 2):**

```
vehicle:{vehicleId}:state → JSON { position, speed, status, currentOrder, routeProgress }
vehicle:{vehicleId}:route → JSON { routeGeometry, destination, eta }
simulation:{simId}:stats → JSON { activeVehicles, deliveredOrders, ... }
```

**Why Redis for live state:**
- Sub-millisecond reads for frontend polling
- TTL for automatic cleanup of stale vehicle states
- Pub/Sub for real-time event broadcasting (alternative to WebSocket)
- Atomic operations for concurrent state updates

### 4. Hive/HDFS — Analytics

**Source pattern:** Monthly order analytics with ORC columnar storage

**Adaptation for Logistics Sandbox (Phase 4):**

```sql
-- Simulation run analytics
CREATE TABLE simulation_metrics (
    simulation_id STRING,
    run_date DATE,
    scenario_name STRING,
    algorithm STRING,
    total_orders INT,
    delivered_orders INT,
    late_orders INT,
    total_distance_km DOUBLE,
    avg_delivery_time_min DOUBLE,
    avg_eta_deviation_min DOUBLE,
    driver_utilization_pct DOUBLE
)
PARTITIONED BY (run_month STRING)
STORED AS ORC;
```

### 5. Order State Machine

**Source pattern:** `Pending → Preparing → Out for Delivery → Delivered`

**Adaptation:**

```
pending → assigned → picked_up → in_transit → delivered
                                             → cancelled
                  → unroutable (no valid route)
```

## When to Introduce Each Technology

| Technology | Trigger Condition | Phase |
|------------|------------------|-------|
| Redis | Frontend polling creates load; need sub-ms vehicle state reads | Phase 2 |
| Cassandra | Telemetry history exceeds available memory; need persistent time-series | Phase 2 |
| Neo4j | Impact analysis queries become complex; need graph traversal | Phase 3 |
| Hive/HDFS | Need to compare metrics across dozens of simulation runs | Phase 4 |

## What NOT to Copy

- MongoDB catalog/product schemas (not relevant to logistics)
- Shopping cart logic (Redis TTL pattern is useful, cart logic is not)
- Referral payout calculations (graph pattern is useful, payout logic is not)
- Next.js frontend patterns (we use a different architecture)
