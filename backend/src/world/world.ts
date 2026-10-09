/**
 * @fileoverview World class holds all entities and their states in the simulation.
 *
 * The world is initialized from a ScenarioConfig, generating vehicles, drivers,
 * and depots. Orders are generated dynamically during simulation ticks.
 */

import {
  Vehicle,
  Order,
  OrderItem,
  OrderPriority,
  Warehouse,
  Driver,
  Customer,
  ScenarioConfig,
  Coordinate,
} from './types.js';
import { SeededRandom } from '../utils/random.js';
import { randomPointInBounds } from '../utils/geo.js';
import { FALLBACK_CAMBODIA_CATALOG, EcommerceProduct } from '../integrations/ecommerce.js';

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
  private catalog: EcommerceProduct[] = [...FALLBACK_CAMBODIA_CATALOG];

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
        driverName,
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

    // Priority and SLA Delivery Time Windows (VRPTW)
    const priorityRoll = this.rng.next();
    let priority: OrderPriority = 'standard';
    let slaDurationMin = 120; // 2 hours standard

    if (priorityRoll < 0.15) {
      priority = 'urgent';
      slaDurationMin = 15; // 15-minute express blitz
    } else if (priorityRoll < 0.50) {
      priority = 'express';
      slaDurationMin = 35; // 35-minute express window
    }

    const slaDeadline = simTimestamp + slaDurationMin * 60 * 1000;

    // Pick 1-3 authentic items from the e-commerce catalog
    const itemCount = this.rng.nextInt(1, 3);
    const selectedItems: OrderItem[] = [];
    let calculatedWeight = 0;

    for (let i = 0; i < itemCount; i++) {
      const prod = this.rng.pick(this.catalog);
      const qty = this.rng.nextInt(1, prod.category === 'Food & Groceries' ? 3 : 1);
      selectedItems.push({
        product_id: prod.product_id,
        name: prod.name,
        quantity: qty,
        price: prod.price,
        category: prod.category,
        weight_kg: Math.round(prod.weight_kg * qty * 10) / 10,
      });
      calculatedWeight += prod.weight_kg * qty;
    }

    const order: Order = {
      id: orderId,
      customerId,
      status: 'pending',
      priority,
      slaDeadline,
      slaDurationMin,
      slaStatus: 'on_time',
      items: selectedItems,
      totalWeight_kg: Math.max(0.5, Math.round(calculatedWeight * 10) / 10),
      pickupLocation: depot.position,
      deliveryLocation,
      assignedVehicleId: null,
      createdAt: simTimestamp,
      creationSeq: this.orderCounter,
      assignedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: null,
    };

    this.orders.set(orderId, order);
    return order;
  }

  /**
   * Create an explicit custom or preset order injected by an operator.
   */
  public createCustomOrder(options: {
    pickupLocation: Coordinate;
    deliveryLocation: Coordinate;
    customerName?: string;
    priority?: OrderPriority;
    slaDurationMin?: number;
    items?: OrderItem[];
    totalWeight_kg?: number;
    simTimestamp: number;
  }): Order {
    this.orderCounter++;
    this.customerCounter++;

    const customerId = `CUST-${String(this.customerCounter).padStart(4, '0')}`;
    const orderId = `ORD-${String(this.orderCounter).padStart(5, '0')}`;

    const customerName = options.customerName || `Express Customer ${this.customerCounter}`;
    this.customers.set(customerId, {
      id: customerId,
      name: customerName,
      address: `${options.deliveryLocation.lat.toFixed(4)}, ${options.deliveryLocation.lon.toFixed(4)}`,
      position: options.deliveryLocation,
    });

    const priority: OrderPriority = options.priority || 'express';
    const defaultSlaMin = priority === 'urgent' ? 15 : priority === 'express' ? 35 : 120;
    const slaDurationMin = options.slaDurationMin || defaultSlaMin;
    const slaDeadline = options.simTimestamp + slaDurationMin * 60 * 1000;

    const items: OrderItem[] = options.items && options.items.length > 0
      ? options.items
      : [
          {
            name: 'Express Package Delivery',
            quantity: 1,
            price: 25.0,
            category: 'Express Parcels',
            weight_kg: options.totalWeight_kg || 2.5,
          },
        ];

    const totalWeight_kg = options.totalWeight_kg || items.reduce((sum, item) => sum + (item.weight_kg || 1) * item.quantity, 0);

    const order: Order = {
      id: orderId,
      customerId,
      status: 'pending',
      priority,
      slaDeadline,
      slaDurationMin,
      slaStatus: 'on_time',
      items,
      totalWeight_kg: Math.max(0.5, Math.round(totalWeight_kg * 10) / 10),
      pickupLocation: options.pickupLocation,
      deliveryLocation: options.deliveryLocation,
      assignedVehicleId: null,
      createdAt: options.simTimestamp,
      creationSeq: this.orderCounter,
      assignedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: null,
    };

    this.orders.set(orderId, order);
    return order;
  }

  public setCatalog(catalog: EcommerceProduct[]): void {
    if (catalog && catalog.length > 0) {
      this.catalog = catalog;
    }
  }

  public getCatalog(): EcommerceProduct[] {
    return this.catalog;
  }

  /**
   * Reset world state and re-initialize with a new scenario config.
   */
  public reset(config: ScenarioConfig = this.config): void {
    this.config = config;
    this.rng = new SeededRandom(config.seed);
    this.vehicles.clear();
    this.orders.clear();
    this.warehouses.clear();
    this.drivers.clear();
    this.customers.clear();
    this.orderCounter = 0;
    this.customerCounter = 0;
    this.initializeFromConfig(config);
  }

  public getRng(): SeededRandom {
    return this.rng;
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

  public getAllDrivers(): Driver[] {
    return Array.from(this.drivers.values());
  }

  public getCustomer(id: string): Customer | undefined {
    return this.customers.get(id);
  }

  public getAllCustomers(): Customer[] {
    return Array.from(this.customers.values());
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
