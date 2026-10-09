/**
 * @fileoverview Type definitions and repository interfaces for the Persistence Layer.
 *
 * Implements polyglot persistence patterns inspired by ecommerce-hive-nosql:
 * - Apache Cassandra wide-column schema for high-throughput vehicle GPS telemetry
 * - MongoDB flexible document store schema for customer orders & product items
 * - In-Memory fast key-value caches for real-time fleet snapshots
 */

import { Coordinate, Customer, Driver, Order, OrderStatus, Vehicle, Warehouse } from '../world/types.js';

/**
 * Cassandra-compatible telemetry ping record matching the rider_gps_pings table schema.
 * Table: rider_gps_pings (
 *   rider_id text,
 *   ping_date text,
 *   ping_timestamp timestamp,
 *   lat double,
 *   lng double,
 *   speed text,
 *   battery int,
 *   PRIMARY KEY ((rider_id, ping_date), ping_timestamp)
 * ) WITH CLUSTERING ORDER BY (ping_timestamp DESC);
 */
export interface TelemetryPing {
  rider_id: string;
  ping_timestamp: number; // sim or epoch timestamp in ms
  ping_date: string;      // YYYY-MM-DD
  lat: number;
  lon: number;
  speed_kmh: number;
  battery_level: number;
  status: string;
  simulation_id: string;
}

export interface TelemetryAcknowledgement {
  schemaVersion: 1;
  stored: true;
  replayed: boolean;
  durable: false;
  source: 'simulated';
  sinkOwner: 'logistics-sandbox';
  storage: 'in-memory';
  simulationId: string;
  sourceId: string;
  tenantId: 'demo';
  units: { coordinates: 'degrees'; speed: 'km/h'; battery: 'percent'; time: 'simulation-ms' };
}

export interface TelemetryRepositoryStatus {
  driver: string;
  healthy: boolean;
  pingCount: number;
  schemaVersion: 1;
  source: 'simulated';
  tenantId: 'demo';
  sinkOwner: 'logistics-sandbox';
  storage: 'in-memory';
  durable: false;
  capacity: number;
  retryScope: 'retained-history';
  retention: 'capacity-or-process-exit';
}

export interface ITelemetryRepository {
  /**
   * Append a single telemetry ping to the time-series store.
   */
  savePing(ping: TelemetryPing): Promise<TelemetryAcknowledgement>;

  /**
   * Batch append telemetry pings.
   */
  saveBatch(pings: TelemetryPing[]): Promise<void>;

  /**
   * Retrieve recent GPS breadcrumb trail for a rider/vehicle (most recent first).
   */
  getRecentPings(riderId: string, limit?: number, simulationId?: string): Promise<TelemetryPing[]>;

  /**
   * Retrieve GPS points within a time window for trip playback.
   */
  getPingsByTimeRange(riderId: string, startMs: number, endMs: number, simulationId?: string): Promise<TelemetryPing[]>;

  /**
   * Total recorded pings in the repository.
   */
  getTotalPingCount(): number;

  /**
   * Driver name and health status.
   */
  getStatus(): TelemetryRepositoryStatus;
}

export interface IOrderRepository {
  /**
   * Insert or update an order document.
   */
  saveOrder(order: Order): Promise<void>;

  /**
   * Fetch order by ID.
   */
  getOrder(orderId: string): Promise<Order | null>;

  /**
   * List all orders with optional status or customer filter.
   */
  getAllOrders(filter?: { status?: string; customerId?: string }): Promise<Order[]>;

  /**
   * Update lifecycle status of an order.
   */
  updateOrderStatus(orderId: string, status: OrderStatus, deliveredAt?: number): Promise<void>;

  /**
   * Compute historical fulfillment KPIs.
   */
  getMetrics(): Promise<{
    total: number;
    delivered: number;
    pending: number;
    onTimeRate: number;
  }>;

  getStatus(): { driver: string; healthy: boolean; orderCount: number };
}

export interface IVehicleRepository {
  saveVehicleState(vehicle: Vehicle): Promise<void>;
  getVehicleState(id: string): Promise<Vehicle | null>;
  getAllVehicleStates(): Promise<Vehicle[]>;
  getStatus(): { driver: string; healthy: boolean; vehicleCount: number };
}

export interface ScenarioRunRecord {
  simulationId: string;
  scenarioName: string;
  seed: number;
  startedAt: number;
  completedAt?: number;
  ordersDelivered: number;
  totalDistanceKm: number;
  slaCompliancePercent: number;
}

export interface IScenarioRepository {
  saveScenarioRun(run: ScenarioRunRecord): Promise<void>;
  getScenarioRuns(): Promise<ScenarioRunRecord[]>;
  getStatus(): { driver: string; healthy: boolean; count: number };
}

export interface GraphNode {
  id: string;
  label: 'Warehouse' | 'Depot' | 'Vehicle' | 'Driver' | 'Order' | 'Customer';
  properties: Record<string, any>;
}

export interface GraphRelationship {
  id: string;
  type: 'FEEDS' | 'DISPATCHES' | 'ASSIGNED_TO' | 'CARRIES' | 'DELIVERS_TO' | 'REFERRED';
  from: string;
  to: string;
  properties?: Record<string, any>;
}

export interface ImpactAnalysisResult {
  targetEntity: { type: string; id: string; name?: string; status?: string };
  impactedVehicles: Array<{ id: string; name: string; type: string; status: string; driverName?: string; currentLoad_kg: number }>;
  impactedOrders: Array<{ id: string; status: string; priority?: string; customerId: string; customerName?: string; totalWeight_kg: number }>;
  impactedCustomers: Array<{ id: string; name: string; address?: string }>;
  totalOrdersAtRisk: number;
  totalPayloadKg: number;
  estimatedRevenueAtRiskUSD: number;
  traversalTimeMs: number;
  cypherQuery: string;
}

export interface IRelationshipRepository {
  syncTopology(warehouses: Warehouse[], vehicles: Vehicle[], drivers: Driver[]): Promise<void>;
  syncOrder(order: Order, vehicleId?: string | null, customer?: Customer): Promise<void>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>;
  updateVehicleStatus(vehicleId: string, status: string, pos?: Coordinate): Promise<void>;
  getImpactAnalysis(entityType: 'depot' | 'vehicle' | 'warehouse', entityId: string): Promise<ImpactAnalysisResult>;
  getGraphTopology(): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }>;
  executeCypher(cypher: string, params?: Record<string, any>): Promise<any>;
  getStatus(): { driver: string; healthy: boolean; nodeCount: number; relationshipCount: number; url: string };
}

export interface IPersistenceLayer {
  telemetry: ITelemetryRepository;
  orders: IOrderRepository;
  vehicles: IVehicleRepository;
  scenarios: IScenarioRepository;
  relationships: IRelationshipRepository;
  driverType: 'in-memory' | 'cassandra' | 'mongodb' | 'polyglot';
  getStatus(): {
    driverType: string;
    telemetry: TelemetryRepositoryStatus;
    orders: { driver: string; healthy: boolean; orderCount: number };
    vehicles: { driver: string; healthy: boolean; vehicleCount: number };
    scenarios: { driver: string; healthy: boolean; count: number };
    relationships: { driver: string; healthy: boolean; nodeCount: number; relationshipCount: number; url: string };
  };
}
