/**
 * @fileoverview Type definitions and repository interfaces for the Persistence Layer.
 *
 * Implements polyglot persistence patterns inspired by ecommerce-hive-nosql:
 * - Apache Cassandra wide-column schema for high-throughput vehicle GPS telemetry
 * - MongoDB flexible document store schema for customer orders & product items
 * - In-Memory fast key-value caches for real-time fleet snapshots
 */

import { Coordinate, Order, OrderStatus, Vehicle } from '../world/types.js';

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

export interface ITelemetryRepository {
  /**
   * Append a single telemetry ping to the time-series store.
   */
  savePing(ping: TelemetryPing): Promise<void>;

  /**
   * Batch append telemetry pings.
   */
  saveBatch(pings: TelemetryPing[]): Promise<void>;

  /**
   * Retrieve recent GPS breadcrumb trail for a rider/vehicle (most recent first).
   */
  getRecentPings(riderId: string, limit?: number): Promise<TelemetryPing[]>;

  /**
   * Retrieve GPS points within a time window for trip playback.
   */
  getPingsByTimeRange(riderId: string, startMs: number, endMs: number): Promise<TelemetryPing[]>;

  /**
   * Total recorded pings in the repository.
   */
  getTotalPingCount(): number;

  /**
   * Driver name and health status.
   */
  getStatus(): { driver: string; healthy: boolean; pingCount: number };
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

export interface IPersistenceLayer {
  telemetry: ITelemetryRepository;
  orders: IOrderRepository;
  vehicles: IVehicleRepository;
  scenarios: IScenarioRepository;
  driverType: 'in-memory' | 'cassandra' | 'mongodb' | 'polyglot';
  getStatus(): {
    driverType: string;
    telemetry: { driver: string; healthy: boolean; pingCount: number };
    orders: { driver: string; healthy: boolean; orderCount: number };
    vehicles: { driver: string; healthy: boolean; vehicleCount: number };
    scenarios: { driver: string; healthy: boolean; count: number };
  };
}
