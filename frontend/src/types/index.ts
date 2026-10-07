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
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
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
}

export interface SimulationStats {
  activeVehicles: number;
  totalOrders: number;
  deliveredOrders: number;
  pendingOrders: number;
  lateOrders: number;
  avgDeliveryTimeMin: number;
  totalDistanceKm: number;
}

export interface EcommerceBridgeStatus {
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  lastSyncTimestamp: number | null;
  ordersIngestedCount: number;
  telemetryPingsEmittedCount: number;
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
