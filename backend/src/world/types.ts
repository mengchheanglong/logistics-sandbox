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
}

export interface Driver {
  id: string;
  name: string;
  status: 'on_shift' | 'off_shift' | 'offline';
  vehicleId: string | null;
  shifStart: number;
  shiftEnd: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: 'pending' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
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
}

export interface DepotConfig {
  id: string;
  name: string;
  position: Coordinate;
}

export interface IncidentConfig {
  type: string;
  // TODO: Expand
}

export interface ScenarioConfig {
  name: string;
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
