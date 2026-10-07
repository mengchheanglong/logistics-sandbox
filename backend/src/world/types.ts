/**
 * @fileoverview Defines all core TypeScript interfaces and types for the simulation.
 */

export interface Coordinate {
  lat: number;
  lon: number;
}

export interface Vehicle {
  id: string;
  name: string;
  type: 'truck' | 'van' | 'motorcycle';
  status: 'idle' | 'en_route' | 'delivering' | 'returning' | 'broken_down';
  driverId: string;
  position: Coordinate;
  speed_kmh: number;
  capacity_kg: number;
  currentLoad_kg: number;
  currentRouteId: string | null;
  assignedOrderIds: string[];
  routeGeometry: [number, number][]; // [lon, lat]
  routeProgress: number; // 0 to 1
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

export interface Driver {
  id: string;
  name: string;
  status: 'on_shift' | 'off_shift' | 'offline';
  vehicleId: string | null;
  shifStart: number;
  shiftEnd: number;
}

export type OrderPriority = 'standard' | 'express' | 'urgent';
export type SlaStatus = 'on_time' | 'at_risk' | 'breached';

export interface Order {
  id: string;
  customerId: string;
  status: 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
  priority?: OrderPriority;
  slaDeadline?: number;
  slaDurationMin?: number;
  slaStatus?: SlaStatus;
  items: any[];
  totalWeight_kg: number;
  pickupLocation: Coordinate;
  deliveryLocation: Coordinate;
  assignedVehicleId: string | null;
  createdAt: number;
  assignedAt: number | null;
  pickedUpAt: number | null;
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

export interface Customer {
  id: string;
  name: string;
  address: string;
  position: Coordinate;
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

export interface EcommerceBridgeStatus {
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  lastSyncTimestamp: number | null;
  ordersIngestedCount: number;
  telemetryPingsEmittedCount: number;
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
  status: string;
  vehicles: Vehicle[];
  orders: Order[];
  warehouses: Warehouse[];
  stats: SimulationStats;
  ecommerceBridge?: EcommerceBridgeStatus;
  trafficMultiplier?: number;
  benchmarkStats?: AlgorithmBenchmarkStats;
  incidents?: RoadIncident[];
  activeScenarioId?: string;
}

export interface DepotConfig {
  id: string;
  name: string;
  position: Coordinate;
}

export interface IncidentConfig {
  type: string;
  description?: string;
  position?: Coordinate;
  radiusM?: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ScenarioConfig {
  id?: string;
  name: string;
  description?: string;
  seed: number;
  city: string;
  bounds: { north: number, south: number, east: number, west: number };
  vehicleCount: number;
  orderCount: number;
  depots: DepotConfig[];
  duration_hours: number;
  trafficEnabled: boolean;
  incidents: IncidentConfig[];
}
