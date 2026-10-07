/**
 * @fileoverview World class holds all entities and their states in the simulation.
 *
 * The world is initialized from a ScenarioConfig, generating vehicles, drivers,
 * and depots. Orders are generated dynamically during simulation ticks.
 */

import {
  Vehicle,
  Order,
  Warehouse,
  Driver,
  Customer,
  ScenarioConfig,
  Coordinate,
} from './types.js';
import { SeededRandom } from '../utils/random.js';
import { randomPointInBounds } from '../utils/geo.js';

/** Cambodian first names for driver generation */
const DRIVER_NAMES = [
  'Sokha', 'Dara', 'Chantha', 'Visal', 'Kunthea',
  'Rith', 'Samnang', 'Pisey', 'Vanna', 'Bopha',
  'Kosal', 'Narith', 'Sophea', 'Thy', 'Chanra',
  'Mony', 'Pheakdei', 'Reaksmey', 'Sovann', 'Thida',
  'Bora', 'Channary', 'Davuth', 'Heng', 'Kanha',
  'Leap', 'Makara', 'Narin', 'Oudom', 'Phalla',
  'Ratanak', 'Sambath', 'Theary', 'Vannak', 'Wutthy',
  'Yuthea', 'Chea', 'Kimheng', 'Lina', 'Nimol',
];

export class World {
  private vehicles: Map<string, Vehicle> = new Map();
  private orders: Map<string, Order> = new Map();
  private warehouses: Map<string, Warehouse> = new Map();
  private drivers: Map<string, Driver> = new Map();
  private customers: Map<string, Customer> = new Map();

  private config: ScenarioConfig;
  private rng: SeededRandom;
  private orderCounter: number = 0;
  private customerCounter: number = 0;

  constructor(config: ScenarioConfig) {
    this.config = config;
    this.rng = new SeededRandom(config.seed);
    this.initializeFromConfig(config);
  }

  /**
   * Generates all initial entities from the scenario configuration.
   */
  private initializeFromConfig(config: ScenarioConfig): void {
    // Create depots/warehouses
    for (const depot of config.depots) {
      this.warehouses.set(depot.id, {
        id: depot.id,
        name: depot.name,
        position: depot.position,
        capacity: 10000,
        currentStock: 5000,
        type: 'depot',
        status: 'open',
      });
    }

    // Create vehicles and drivers distributed across depots
    let vehicleIndex = 0;
    const depotCount = config.depots.length;

    for (let i = 0; i < config.vehicleCount; i++) {
      const depot = config.depots[i % depotCount];
      const driverId = `DRV-${String(i + 1).padStart(3, '0')}`;
      const vehicleId = `VEH-${String(i + 1).padStart(3, '0')}`;
      const driverName = DRIVER_NAMES[i % DRIVER_NAMES.length];

      // Determine vehicle type based on distribution
      let vehicleType: 'truck' | 'van' | 'motorcycle';
      let capacity_kg: number;
      let speed_factor: number;

      if (i < config.vehicleCount * 0.33) {
        vehicleType = 'truck';
        capacity_kg = 800;
        speed_factor = 0.9;
      } else if (i < config.vehicleCount * 0.73) {
        vehicleType = 'van';
        capacity_kg = 400;
        speed_factor = 1.0;
      } else {
        vehicleType = 'motorcycle';
        capacity_kg = 50;
        speed_factor = 1.2;
      }

      // Slight random offset from depot position so vehicles don't stack
      const offsetLat = (this.rng.next() - 0.5) * 0.005;
      const offsetLon = (this.rng.next() - 0.5) * 0.005;

      const vehiclePrefix =
        vehicleType === 'truck' ? 'TRUCK' :
        vehicleType === 'van' ? 'VAN' :
        'MOTO';

      const vehicle: Vehicle = {
        id: `${vehiclePrefix}-${String(i + 1).padStart(3, '0')}`,
        name: `${vehiclePrefix}-${String(i + 1).padStart(3, '0')}`,
        type: vehicleType,
        status: 'idle',
        driverId,
        position: {
          lat: depot.position.lat + offsetLat,
          lon: depot.position.lon + offsetLon,
        },
        speed_kmh: 0,
        capacity_kg,
        currentLoad_kg: 0,
        currentRouteId: null,
        assignedOrderIds: [],
        routeGeometry: [],
        routeProgress: 0,
        routeDistanceM: 0,
        routeDurationS: 0,
        depotId: depot.id,
      };

      const driver: Driver = {
        id: driverId,
        name: driverName,
        status: 'on_shift',
        vehicleId: vehicle.id,
        shifStart: 0,
        shiftEnd: 8 * 60 * 60 * 1000, // 8 hour shift in ms
      };

      this.vehicles.set(vehicle.id, vehicle);
      this.drivers.set(driverId, driver);
      vehicleIndex++;
    }

    console.log(
      `[World] Initialized: ${this.vehicles.size} vehicles, ` +
      `${this.warehouses.size} depots, ` +
      `${this.drivers.size} drivers`
    );
  }

  /**
   * Generate a new order with random customer and delivery location.
   */
  public generateOrder(simTimestamp: number): Order {
    this.orderCounter++;
    this.customerCounter++;

    const customerId = `CUST-${String(this.customerCounter).padStart(4, '0')}`;
    const orderId = `ORD-${String(this.orderCounter).padStart(5, '0')}`;

    // Random delivery location within bounds
    const deliveryLocation = randomPointInBounds(this.config.bounds, this.rng);

    // Pickup from an open depot
    const openDepots = Array.from(this.warehouses.values()).filter(w => w.status !== 'closed');
    const depotList = openDepots.length > 0 ? openDepots : Array.from(this.warehouses.values());
    const depot = this.rng.pick(depotList);

    // Create customer if not exists
    if (!this.customers.has(customerId)) {
      this.customers.set(customerId, {
        id: customerId,
        name: `Customer ${this.customerCounter}`,
        address: `${deliveryLocation.lat.toFixed(4)}, ${deliveryLocation.lon.toFixed(4)}`,
        position: deliveryLocation,
      });
    }

    const order: Order = {
      id: orderId,
      customerId,
      status: 'pending',
      items: [{ name: 'Package', quantity: 1 }],
      totalWeight_kg: this.rng.nextFloat(1, 50),
      pickupLocation: depot.position,
      deliveryLocation,
      assignedVehicleId: null,
      createdAt: simTimestamp,
      assignedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: null,
    };

    this.orders.set(orderId, order);
    return order;
  }

  public addVehicle(vehicle: Vehicle): void {
    this.vehicles.set(vehicle.id, vehicle);
  }

  public getVehicle(id: string): Vehicle | undefined {
    return this.vehicles.get(id);
  }

  public getAllVehicles(): Vehicle[] {
    return Array.from(this.vehicles.values());
  }

  public addOrder(order: Order): void {
    this.orders.set(order.id, order);
  }

  public getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  public getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  public getAllWarehouses(): Warehouse[] {
    return Array.from(this.warehouses.values());
  }

  public getDriver(id: string): Driver | undefined {
    return this.drivers.get(id);
  }

  public getCustomer(id: string): Customer | undefined {
    return this.customers.get(id);
  }

  public getPendingOrders(): Order[] {
    return this.getAllOrders().filter(o => o.status === 'pending');
  }

  public getIdleVehicles(): Vehicle[] {
    return this.getAllVehicles().filter(v => v.status === 'idle');
  }

  public getConfig(): ScenarioConfig {
    return this.config;
  }

  public getOrderCount(): number {
    return this.orderCounter;
  }
}
