/**
 * Frontend TypeScript types — must match the backend SimulationState shape exactly.
 */

export interface Coordinate {
  lat: number;
  lon: number;
}

export type VehicleStatus = 'idle' | 'en_route' | 'delivering' | 'returning' | 'broken_down';
export type OrderStatus = 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
export type SpeedSetting = 0 | 1 | 10 | 60 | 600;

export interface Vehicle {
  id: string;
  name: string;
  type: 'truck' | 'van' | 'motorcycle';
  status: VehicleStatus;
  driverId: string;
  position: Coordinate;
  speed_kmh: number;
  capacity_kg: number;
  currentLoad_kg: number;
  currentRouteId: string | null;
  assignedOrderIds: string[];
  routeGeometry: [number, number][]; // [lon, lat]
  routeProgress: number;
  routeDistanceM: number;
  routeDurationS: number;
  depotId: string;
  routeLegs?: RouteLeg[];
  currentLegIndex?: number;
  totalLegsCount?: number;
  rerouteCount?: number;
  lastReroutedAt?: number;
  rerouteReason?: string;
  trailHistory?: [number, number, number][]; // [lon, lat, timestamp]
}

export interface RouteLeg {
  orderId?: string;
  destination: Coordinate;
  path: [number, number][]; // [lon, lat]
  distanceM: number;
  durationS: number;
}

export type OrderPriority = 'standard' | 'express' | 'urgent';
export type SlaStatus = 'on_time' | 'at_risk' | 'breached';

export interface OrderItem {
  product_id?: string;
  name: string;
  quantity: number;
  price?: number;
  category?: string;
  weight_kg?: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  priority?: OrderPriority;
  slaDeadline?: number;
  slaDurationMin?: number;
  slaStatus?: SlaStatus;
  items?: OrderItem[];
  totalWeight_kg: number;
  pickupLocation: Coordinate;
  deliveryLocation: Coordinate;
  assignedVehicleId: string | null;
  createdAt: number;
  assignedAt: number | null;
  deliveredAt: number | null;
  estimatedDeliveryTime: number | null;
}

export interface Warehouse {
  id: string;
  name: string;
  position: Coordinate;
  capacity: number;
  currentStock: number;
  type: 'warehouse' | 'depot';
  status?: 'open' | 'closed';
}

export interface SimulationStats {
  activeVehicles: number;
  totalOrders: number;
  deliveredOrders: number;
  pendingOrders: number;
  lateOrders: number;
  avgDeliveryTimeMin: number;
  totalDistanceKm: number;
  slaOnTimeDeliveries?: number;
  slaBreachedDeliveries?: number;
  slaComplianceRate?: number;
  atRiskOrdersCount?: number;
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  vehicleCount: number;
  orderCount: number;
  city: string;
}

export interface EcommerceBridgeStatus {
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  lastSyncTimestamp: number | null;
  ordersIngestedCount: number;
  telemetryPingsEmittedCount: number;
  catalogItemsCount?: number;
}

export type RoutingAlgorithm =
  | 'contraction_hierarchies'
  | 'astar'
  | 'dijkstra'
  | 'bidirectional_astar';

export type DispatchStrategy =
  | 'nearest_available'
  | 'route_aware'
  | 'cluster_zone'
  | 'multi_stop_tour';

export interface AlgorithmBenchmarkStats {
  routingAlgorithm: RoutingAlgorithm;
  dispatchStrategy: DispatchStrategy;
  totalQueries: number;
  totalQueryTimeMs: number;
  avgQueryTimeMs: number;
  totalNodesVisited: number;
  avgNodesVisited: number;
  totalDistanceDrivenKm: number;
  totalOrdersAssigned: number;
}

export interface RoadIncident {
  id: string;
  type: 'accident' | 'road_work' | 'flooding' | 'congestion';
  description: string;
  position: Coordinate;
  radiusM: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
  active: boolean;
}

export interface SimulationState {
  simulationId: string;
  simTime: number;
  speed: number;
  status: 'running' | 'paused' | 'stopped';
  vehicles: Vehicle[];
  orders: Order[];
  warehouses: Warehouse[];
  stats: SimulationStats;
  ecommerceBridge?: EcommerceBridgeStatus;
  trafficMultiplier?: number;
  benchmarkStats?: AlgorithmBenchmarkStats;
  incidents?: RoadIncident[];
  activeScenarioId?: string;
  persistence?: any;
}

export interface SimulationEvent {
  eventId: string;
  simulationId: string;
  simTimestamp: number;
  realTimestamp: number;
  entityType: string;
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface GraphStatus {
  driver: string;
  healthy: boolean;
  nodeCount: number;
  relationshipCount: number;
  url: string;
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

export interface HiveProvinceRevenue {
  province: string;
  revenue: number;
  share: string;
}

export interface HiveTopCustomer {
  rank: number;
  name: string;
  city: string;
  spend: number;
  tier: string;
}

export interface HiveWarehouseAnalytics {
  success: boolean;
  warehouseEngine: string;
  storageLayer: string;
  stagingDir: string;
  format: string;
  metrics: {
    totalMonthlyOrders: number;
    activeCustomers: number;
    customerBuckets: number;
    septemberRevenue: number;
    queryLatencyMs: number;
    csvLatencyMs: number;
    speedupMultiplier: number;
    compressionRatio: number;
  };
  revenueByProvince: HiveProvinceRevenue[];
  topCustomers: HiveTopCustomer[];
  orderTiers: {
    highTier: { label: string; count: number; percentage: string };
    normalTier: { label: string; count: number; percentage: string };
  };
  pipelineStages: Array<{ stage: number; name: string; desc: string }>;
}

export interface HiveQueryResult {
  success: boolean;
  queryId: string;
  executionEngine: string;
  status: string;
  latencyMs: number;
  recordsScanned: number;
  partitionsPruned: number;
  error?: string;
}
