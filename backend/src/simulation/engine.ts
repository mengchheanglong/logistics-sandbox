/**
 * @fileoverview SimulationEngine drives the core simulation loop.
 *
 * Each tick:
 * 1. Advance the simulation clock
 * 2. Generate new scenario orders (or ingest from upstream ecommerce-hive-nosql)
 * 3. Dispatch pending orders to idle vehicles
 * 4. Move vehicles along their route geometry
 * 5. Stream telemetry pings back into ecommerce-hive-nosql (Cassandra)
 * 6. Check for delivery completion and update upstream order status
 * 7. Emit domain events
 *
 * The engine is the single source of truth for the simulation world.
 * The frontend observes this state — it never drives it.
 */

import { SimulationClock } from './clock.js';
import { World } from '../world/world.js';
import { EventBus } from '../events/event-bus.js';
import { Dispatcher, AssignmentResult } from '../dispatch/dispatcher.js';
import { VrpTourSolver } from '../dispatch/vrp.js';
import { RoutingClient } from '../routing/client.js';
import { EcommerceClient, EcommerceOrder } from '../integrations/ecommerce.js';
import { createPersistenceLayer, IPersistenceLayer, TelemetryPing } from '../persistence/index.js';
import { SCENARIO_PRESETS, defaultScenario } from '../scenarios/presets.js';
import {
  Coordinate,
  SimulationState,
  SimulationEvent,
  Vehicle,
  Order,
  OrderPriority,
  OrderItem,
  RoutingAlgorithm,
  DispatchStrategy,
  AlgorithmBenchmarkStats,
  RoadIncident,
  ScenarioConfig,
} from '../world/types.js';
import {
  interpolateAlongPath,
  randomPointInBounds,
  haversineDistance,
  calculateAvoidanceWaypoint,
} from '../utils/geo.js';
import { v4 as uuidv4 } from 'uuid';

export interface DeliveryCorridorPreset {
  id: string;
  name: string;
  description: string;
  pickup: { name: string; position: Coordinate };
  delivery: { name: string; position: Coordinate };
  suggestedPriority: OrderPriority;
}

export const DELIVERY_CORRIDOR_PRESETS: DeliveryCorridorPreset[] = [
  {
    id: 'pp-depot-a-to-st271',
    name: 'Depot A → St 271 (Meanchey)',
    description: 'Central Market Depot A to St 271 south artery (Boeung Tumpun) • ~6.8 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'St 271 (Boeung Tumpun)', position: { lat: 11.5305, lon: 104.9085 } },
    suggestedPriority: 'express',
  },
  {
    id: 'pp-depot-a-to-bkk1',
    name: 'Depot A → BKK1 (Pasteur)',
    description: 'Central Market Depot A to Pasteur / St 51 in BKK1 residential zone • ~2.1 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'BKK1 / Pasteur (St 51)', position: { lat: 11.5528, lon: 104.9282 } },
    suggestedPriority: 'urgent',
  },
  {
    id: 'pp-depot-b-to-tuolkork',
    name: 'Depot B → Tuol Kork (TK Ave)',
    description: 'Russian Market Depot B to Tuol Kork commercial center (St 289) • ~5.2 km',
    pickup: { name: 'Russian Market Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Tuol Kork (TK Ave St 289)', position: { lat: 11.5732, lon: 104.8984 } },
    suggestedPriority: 'express',
  },
  {
    id: 'pp-hub-to-riverside',
    name: 'Central Hub → Riverside Quay',
    description: 'Bak Touk Central Hub to Sisowath Quay riverfront promenade • ~2.4 km',
    pickup: { name: 'Bak Touk Central Hub', position: { lat: 11.5621, lon: 104.9160 } },
    delivery: { name: 'Riverside (Sisowath Quay)', position: { lat: 11.5695, lon: 104.9312 } },
    suggestedPriority: 'urgent',
  },
  {
    id: 'pp-depot-a-to-sensok',
    name: 'Depot A → Sen Sok (AEON 2)',
    description: 'Central Market Depot A along Russian Blvd to AEON Mall 2 in Sen Sok • ~6.4 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'Sen Sok (AEON Mall 2)', position: { lat: 11.5850, lon: 104.8820 } },
    suggestedPriority: 'standard',
  },
  {
    id: 'pp-depot-b-to-norodom',
    name: 'Depot B → Independence Monument',
    description: 'Russian Market Depot B north along Mao Tse Toung to Norodom Blvd • ~2.3 km',
    pickup: { name: 'Russian Market Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Independence Monument / Norodom', position: { lat: 11.5564, lon: 104.9282 } },
    suggestedPriority: 'express',
  },
];

export class SimulationEngine {
  public clock: SimulationClock;
  public world: World;
  public eventBus: EventBus;
  public dispatcher: Dispatcher;
  public vrpSolver: VrpTourSolver;
  public routingClient: RoutingClient;
  public ecommerceClient: EcommerceClient;
  public persistence: IPersistenceLayer;

  private simulationId: string;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly TICK_RATE_MS = 100;
  private lastTickTime: number = 0;

  /** Active road hazard incidents */
  private incidents: RoadIncident[] = [];
  /** Currently active scenario preset identifier */
  private activeScenarioId: string = 'morning_delivery';

  /** How many orders have been generated so far */
  private ordersGenerated: number = 0;
  /** Target total orders from scenario config */
  private targetOrderCount: number;
  /** Sim time interval between order generations (ms) */
  private orderGenerationIntervalMs: number;
  /** Last sim time an order was generated */
  private lastOrderGenTime: number = 0;
  /** Last tick count for periodic background tasks (e.g. ecommerce polling) */
  private tickCounter: number = 0;

  /** Pending dispatch queue — orders waiting for route calculation */
  private dispatchQueue: string[] = [];
  /** Whether a dispatch operation is currently in progress */
  private dispatching: boolean = false;
  /** Global traffic congestion factor (1.0 = normal, 2.0 = heavy traffic) */
  private trafficMultiplier: number = 1.0;

  /** Active routing algorithm for osm-pathfinder */
  private activeRoutingAlgorithm: RoutingAlgorithm = 'contraction_hierarchies';
  /** Active dispatch strategy for assigning orders to vehicles */
  private activeDispatchStrategy: DispatchStrategy = 'nearest_available';

  /** Aggregated benchmark performance metrics */
  private benchmarkMetrics = {
    totalQueries: 0,
    totalQueryTimeMs: 0,
    totalNodesVisited: 0,
    totalOrdersAssigned: 0,
  };

  /** Cumulative distance driven across all completed vehicle routes (km) */
  private cumulativeDistanceKm: number = 0;

  constructor() {
    this.simulationId = uuidv4();
    this.clock = new SimulationClock();
    this.eventBus = new EventBus();
    this.world = new World(defaultScenario);
    this.dispatcher = new Dispatcher();
    this.vrpSolver = new VrpTourSolver();
    this.routingClient = new RoutingClient();
    this.ecommerceClient = new EcommerceClient();
    this.persistence = createPersistenceLayer();

    this.targetOrderCount = defaultScenario.orderCount;
    // Spread order generation across the simulation duration
    const durationMs = defaultScenario.duration_hours * 60 * 60 * 1000;
    this.orderGenerationIntervalMs = durationMs / this.targetOrderCount;

    // Seed initial orders so vehicles immediately start active delivery on launch
    this.seedInitialOrders(20);

    console.log(
      `[SimulationEngine] Created simulation ${this.simulationId}`,
      `| ${defaultScenario.vehicleCount} vehicles`,
      `| ${defaultScenario.orderCount} target orders`,
      `| ${defaultScenario.duration_hours}h duration`,
      `| Persistence: ${this.persistence.driverType}`
    );
  }

  /**
   * Pre-seed initial orders into the dispatch queue.
   */
  public seedInitialOrders(count: number = 20): void {
    const simTime = this.clock.getSimulatedTime();
    const toGen = Math.min(count, Math.max(1, this.targetOrderCount - this.ordersGenerated));
    for (let i = 0; i < toGen; i++) {
      const order = this.world.generateOrder(simTime);
      this.ordersGenerated++;
      this.dispatchQueue.push(order.id);
      this.persistence.orders.saveOrder(order).catch(() => {});
    }
    this.sortDispatchQueueByEDF();
  }

  /**
   * Start the simulation loop.
   */
  public start(): void {
    if (this.intervalId) return;

    // Check routing service availability
    this.routingClient.healthCheck().then((ok) => {
      if (ok) {
        console.log('[SimulationEngine] osm-pathfinder is available ✓');
      } else {
        console.warn('[SimulationEngine] osm-pathfinder is NOT available — using fallback routing');
      }
    });

    // Check upstream ecommerce-hive-nosql bridge availability
    this.ecommerceClient.checkHealth().then((ok) => {
      if (ok) {
        console.log('[SimulationEngine] Upstream ecommerce-hive-nosql marketplace connected ✓');
        this.ecommerceClient.fetchCatalog().then((catalog) => {
          if (catalog && catalog.length > 0) {
            this.world.setCatalog(catalog);
            console.log(`[SimulationEngine] Synchronized ${catalog.length} live catalog products from ecommerce marketplace`);
          }
        });
      } else {
        console.log('[SimulationEngine] Upstream ecommerce-hive-nosql marketplace standby (not reachable on port 4000)');
      }
    });

    // Synchronize initial topology into Neo4j Relationship Graph
    this.persistence.relationships.syncTopology(
      this.world.getAllWarehouses(),
      this.world.getAllVehicles(),
      this.world.getAllDrivers()
    ).catch(() => {});

    // Ensure orders are seeded when starting
    if (this.world.getAllOrders().length === 0) {
      this.seedInitialOrders(20);
    }

    this.lastTickTime = Date.now();
    this.intervalId = setInterval(() => this.tick(), this.TICK_RATE_MS);

    this.emitEvent('simulation', this.simulationId, 'simulation.started', {
      scenario: defaultScenario.name,
      vehicleCount: defaultScenario.vehicleCount,
      orderCount: defaultScenario.orderCount,
    });

    console.log('[SimulationEngine] Simulation started');
  }

  /**
   * Stop the simulation loop.
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emitEvent('simulation', this.simulationId, 'simulation.stopped', {});
    console.log('[SimulationEngine] Simulation stopped');
  }

  public pause(): void {
    this.clock.pause();
    this.emitEvent('simulation', this.simulationId, 'simulation.paused', {});
  }

  public resume(): void {
    this.clock.resume();
    this.emitEvent('simulation', this.simulationId, 'simulation.resumed', {});
  }

  public setSpeed(speed: number): void {
    this.clock.setSpeed(speed);
    this.emitEvent('simulation', this.simulationId, 'simulation.speed_changed', { speed });
  }

  public isRunning(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Main simulation tick — called every TICK_RATE_MS real milliseconds.
   */
  private tick(): void {
    const now = Date.now();
    const deltaMs = now - this.lastTickTime;
    this.lastTickTime = now;
    this.tickCounter++;

    // 1. Advance simulation clock
    this.clock.tick(deltaMs);
    const simTime = this.clock.getSimulatedTime();

    // 2. Poll upstream ecommerce-hive-nosql periodically (every 50 ticks = 5 seconds)
    if (this.tickCounter % 50 === 0) {
      this.pollEcommerceOrders();
    }

    // 3. Generate scenario orders
    this.generateOrders(simTime);

    // 4. Dispatch pending orders (async, non-blocking)
    this.dispatchPendingOrders();

    // 5. Move vehicles along their routes
    this.updateVehicles(simTime, deltaMs);
  }

  /**
   * Ingest an order from the upstream ecommerce-hive-nosql marketplace into the sandbox.
   */
  public ingestEcommerceOrder(eOrder: EcommerceOrder): Order {
    const existing = this.world.getOrder(eOrder.order_id);
    if (existing) return existing;

    // Ensure simulation is running at normal 1x speed so customer deliveries can be observed
    if (!this.isRunning()) {
      this.start();
    }
    if (this.clock.speed > 1) {
      this.setSpeed(1);
    }

    const depots = this.world.getAllWarehouses();
    const depot = depots.length > 0 ? depots[0] : { position: { lat: 11.568, lon: 104.922 } };

    // Resolve realistic delivery coordinate based on destination address
    const deliveryLocation = this.resolveDeliveryLocation(eOrder.delivery_address);

    const totalWeight = (eOrder.items || []).reduce((acc, item) => acc + (item.quantity || 1) * 2, 5);

    const order: Order = {
      id: eOrder.order_id,
      customerId: eOrder.customer_id || 'C-ECOMMERCE',
      status: 'pending',
      priority: 'express',
      slaDurationMin: 35,
      slaDeadline: this.clock.getSimulatedTime() + 35 * 60 * 1000,
      slaStatus: 'on_time',
      items: eOrder.items || [{ name: 'Marketplace Item', quantity: 1 }],
      totalWeight_kg: totalWeight,
      pickupLocation: depot.position,
      deliveryLocation,
      assignedVehicleId: null,
      createdAt: this.clock.getSimulatedTime(),
      assignedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: null,
    };

    this.world.addOrder(order);
    this.persistence.orders.saveOrder(order).catch(() => {});
    this.dispatchQueue.unshift(order.id); // Place at top of queue for immediate dispatch
    this.ecommerceClient.recordOrderIngested();

    this.emitEvent('order', order.id, 'order.created', {
      source: 'ecommerce-hive-nosql',
      customerName: eOrder.customer_name,
      totalAmount: eOrder.total,
      deliveryAddress: eOrder.delivery_address,
      itemsCount: (eOrder.items || []).length,
      priority: order.priority,
      slaDeadline: order.slaDeadline,
    });

    console.log(`[SimulationEngine] Ingested marketplace order: ${order.id} for ${eOrder.customer_name} (Priority: ${order.priority})`);

    // Trigger immediate non-blocking dispatch so order is assigned right away
    this.dispatchPendingOrders();

    return order;
  }

  /**
   * Resolve realistic geographical coordinates in Phnom Penh from delivery address text.
   */
  private resolveDeliveryLocation(address?: string): Coordinate {
    const addr = (address || '').toLowerCase();
    if (addr.includes('boeung tumpun') || addr.includes('meanchey') || addr.includes('271')) {
      return { lat: 11.5305, lon: 104.9085 }; // South Phnom Penh / Street 271 area (~4.8 km)
    }
    if (addr.includes('pasteur') || addr.includes('bkk1') || addr.includes('keng kang')) {
      return { lat: 11.5520, lon: 104.9248 }; // BKK1 / Pasteur (~2.2 km)
    }
    if (addr.includes('tuol kork') || addr.includes('tk')) {
      return { lat: 11.5750, lon: 104.8970 }; // Tuol Kork (~3.6 km)
    }
    if (addr.includes('norodom') || addr.includes('tonle bassac') || addr.includes('bassac')) {
      return { lat: 11.5450, lon: 104.9350 }; // Tonle Bassac (~3.2 km)
    }
    if (addr.includes('teuk thla') || addr.includes('sen sok') || addr.includes('russian federation')) {
      return { lat: 11.5620, lon: 104.8780 }; // Sen Sok / Russian Blvd (~5.1 km)
    }
    if (addr.includes('chroy changvar') || addr.includes('ocic')) {
      return { lat: 11.5950, lon: 104.9380 }; // Chroy Changvar (~4.6 km)
    }
    if (addr.includes('riverside') || addr.includes('daun penh') || addr.includes('wat phnom')) {
      return { lat: 11.5750, lon: 104.9310 }; // Riverside (~1.8 km)
    }
    return randomPointInBounds(this.world.getConfig().bounds, {
      nextFloat: (min, max) => min + Math.random() * (max - min),
    });
  }

  /**
   * Return all available scenario presets.
   */
  public getScenarioPresets(): ScenarioConfig[] {
    return Object.values(SCENARIO_PRESETS);
  }

  /**
   * Reset world and load a scenario preset.
   */
  public loadScenario(
    scenarioId: string,
    options: { seedOrders?: boolean } = {}
  ): { success: boolean; message: string; scenario: ScenarioConfig } {
    const scenario = SCENARIO_PRESETS[scenarioId];
    if (!scenario) {
      return { success: false, message: `Scenario preset "${scenarioId}" not found.`, scenario: SCENARIO_PRESETS.morning_delivery };
    }

    this.stop();
    this.world.reset(scenario);
    this.activeScenarioId = scenario.id || scenarioId;
    this.targetOrderCount = scenario.orderCount;
    this.ordersGenerated = 0;
    this.lastOrderGenTime = 0;
    this.dispatchQueue = [];
    this.incidents = [];
    this.clock = new SimulationClock(0, 1);
    this.benchmarkMetrics = {
      totalQueries: 0,
      totalQueryTimeMs: 0,
      totalNodesVisited: 0,
      totalOrdersAssigned: 0,
    };
    this.cumulativeDistanceKm = 0;

    const durationMs = scenario.duration_hours * 60 * 60 * 1000;
    this.orderGenerationIntervalMs = durationMs / this.targetOrderCount;

    // Seed initial orders if requested (e.g. from UI)
    if (options.seedOrders) {
      this.seedInitialOrders(20);
    }

    // Load initial scenario incidents if defined
    if (scenario.incidents && scenario.incidents.length > 0) {
      for (const inc of scenario.incidents) {
        if (inc.position) {
          this.createRoadIncident({
            type: inc.type as any,
            description: inc.description || 'Scenario Road Hazard',
            position: inc.position,
            radiusM: inc.radiusM || 500,
            severity: inc.severity,
            autoRerouteAffected: false,
          });
        }
      }
    }

    this.emitEvent('simulation', this.simulationId, 'scenario.loaded', {
      scenarioId: this.activeScenarioId,
      name: scenario.name,
      vehicles: scenario.vehicleCount,
      orders: scenario.orderCount,
    });

    console.log(`[SimulationEngine] Scenario loaded: ${scenario.name} (${this.activeScenarioId})`);
    return { success: true, message: `Loaded scenario "${scenario.name}".`, scenario };
  }

  /**
   * Sort pending dispatch queue using Earliest Deadline First (EDF) priority.
   */
  private sortDispatchQueueByEDF(): void {
    this.dispatchQueue.sort((idA, idB) => {
      const orderA = this.world.getOrder(idA);
      const orderB = this.world.getOrder(idB);
      const deadlineA = orderA?.slaDeadline ?? Infinity;
      const deadlineB = orderB?.slaDeadline ?? Infinity;
      return deadlineA - deadlineB;
    });
  }

  /**
   * Poll upstream marketplace for pending orders.
   */
  private async pollEcommerceOrders(): Promise<void> {
    try {
      const isUp = await this.ecommerceClient.checkHealth();
      if (!isUp) return;

      const pendingOrders = await this.ecommerceClient.fetchPendingOrders();
      for (const eOrder of pendingOrders) {
        if (!this.world.getOrder(eOrder.order_id)) {
          this.ingestEcommerceOrder(eOrder);
        }
      }
    } catch (err) {
      // Non-blocking background sync error
    }
  }

  /**
   * Generate new scenario orders at a steady rate.
   */
  private generateOrders(simTime: number): void {
    if (this.ordersGenerated >= this.targetOrderCount) return;

    if (simTime - this.lastOrderGenTime >= this.orderGenerationIntervalMs) {
      const order = this.world.generateOrder(simTime);
      this.ordersGenerated++;
      this.lastOrderGenTime = simTime;
      this.dispatchQueue.push(order.id);
      this.sortDispatchQueueByEDF();
      this.persistence.orders.saveOrder(order).catch(() => {});

      if (this.ecommerceClient.getStatus().connected) {
        this.ecommerceClient.createMarketplaceOrder({
          order_id: order.id,
          customer_id: order.customerId,
          customer_name: `Customer (${order.customerId})`,
          items: order.items.map(it => ({
            product_id: it.product_id || 'P-ITEM',
            name: it.name,
            quantity: it.quantity,
            price: it.price || 10,
            category: it.category,
            weight_kg: it.weight_kg,
          })),
          total: order.items.reduce((acc, it) => acc + (it.price || 10) * it.quantity, 0),
          province: 'Phnom Penh',
          status: 'Pending',
        }).catch(() => {});
      }

      this.emitEvent('order', order.id, 'order.created', {
        customerId: order.customerId,
        totalWeight_kg: order.totalWeight_kg,
        pickupLocation: order.pickupLocation,
        deliveryLocation: order.deliveryLocation,
        priority: order.priority,
        slaDeadline: order.slaDeadline,
        slaDurationMin: order.slaDurationMin,
      });
    }
  }

  /**
   * Try to dispatch pending orders to idle vehicles.
   */
  private dispatchPendingOrders(): void {
    if (this.dispatching || this.dispatchQueue.length === 0) return;

    const idleVehicles = this.world.getIdleVehicles();
    if (idleVehicles.length === 0) return;

    this.dispatching = true;

    // Check if multi-stop tour strategy is selected
    if (this.activeDispatchStrategy === 'multi_stop_tour') {
      const vehicle = idleVehicles[0];
      const pendingOrders = this.dispatchQueue
        .map((id) => this.world.getOrder(id))
        .filter((o): o is Order => !!o && o.status === 'pending');

      const depot = this.world.getAllWarehouses().find((w) => w.id === vehicle.depotId) || {
        position: vehicle.position,
      };

      this.vrpSolver
        .planTour(
          vehicle,
          pendingOrders,
          depot.position,
          this.routingClient,
          this.activeRoutingAlgorithm
        )
        .then((tour) => {
          if (tour && tour.legs.length > 0) {
            // Apply multi-stop tour state to vehicle
            vehicle.status = 'en_route';
            vehicle.routeLegs = tour.legs;
            vehicle.currentLegIndex = 0;
            vehicle.totalLegsCount = tour.legs.length;
            vehicle.assignedOrderIds = tour.orderIds;
            vehicle.currentLoad_kg = tour.totalLoadKg;

            const firstLeg = tour.legs[0];
            vehicle.routeGeometry = firstLeg.path;
            vehicle.routeDistanceM = firstLeg.distanceM;
            vehicle.routeDurationS = firstLeg.durationS;
            vehicle.routeProgress = 0;
            vehicle.currentRouteId = `TOUR-${vehicle.id}-${tour.legs.length}LEGS`;
            vehicle.trailHistory = [[vehicle.position.lon, vehicle.position.lat, this.clock.getSimulatedTime()]];

            // Mark all tour orders as assigned
            for (const orderId of tour.orderIds) {
              const order = this.world.getOrder(orderId);
              if (order) {
                order.status = 'assigned';
                order.assignedVehicleId = vehicle.id;
                order.assignedAt = this.clock.getSimulatedTime();
                this.persistence.relationships.syncOrder(order, vehicle.id).catch(() => {});
                this.ecommerceClient.updateOrderStatus(order.id, 'Out for Delivery', vehicle.driverId);
              }
              // Remove from queue
              const qIndex = this.dispatchQueue.indexOf(orderId);
              if (qIndex !== -1) this.dispatchQueue.splice(qIndex, 1);
            }

            // Benchmark metrics
            this.benchmarkMetrics.totalQueries += tour.totalQueries;
            this.benchmarkMetrics.totalQueryTimeMs += tour.totalQueryTimeMs;
            this.benchmarkMetrics.totalNodesVisited += tour.totalNodesVisited;
            this.benchmarkMetrics.totalOrdersAssigned += tour.orderIds.length;

            this.emitEvent('vehicle', vehicle.id, 'vehicle.tour.dispatched', {
              orderCount: tour.orderIds.length,
              totalLegs: tour.legs.length,
              totalDistanceM: tour.totalDistanceM,
              totalDurationS: tour.totalDurationS,
            });
          }
          this.dispatching = false;
        })
        .catch((err) => {
          console.error('[SimulationEngine] VRP dispatch error:', err);
          this.dispatching = false;
        });
      return;
    }

    // Standard single-order dispatch
    const orderId = this.dispatchQueue[0];
    const order = this.world.getOrder(orderId);
    if (!order || order.status !== 'pending') {
      this.dispatchQueue.shift();
      this.dispatching = false;
      return;
    }

    this.dispatcher
      .assignOrder(order, idleVehicles, this.routingClient, {
        strategy: this.activeDispatchStrategy,
        routingAlgorithm: this.activeRoutingAlgorithm,
      })
      .then((result: AssignmentResult | null) => {
        if (result) {
          // Record benchmark metrics
          this.benchmarkMetrics.totalQueries++;
          this.benchmarkMetrics.totalQueryTimeMs += result.route.queryTimeMs || 0;
          this.benchmarkMetrics.totalNodesVisited += result.route.nodesVisited || 0;
          this.benchmarkMetrics.totalOrdersAssigned++;

          const vehicle = this.world.getVehicle(result.vehicleId);
          if (vehicle && order.status === 'pending') {
            // Update vehicle state
            vehicle.status = 'en_route';
            vehicle.assignedOrderIds = [order.id];
            vehicle.routeGeometry = result.route.path;
            vehicle.routeProgress = 0;
            vehicle.routeDistanceM = result.route.distanceM;
            // Guarantee minimum observable duration (60s real-time at 1x) so customer & operator can watch courier progression
            vehicle.routeDurationS = Math.max(result.route.durationS, 3600);
            vehicle.currentRouteId = `R-${order.id}`;
            vehicle.currentLoad_kg = order.totalWeight_kg;
            vehicle.trailHistory = [[vehicle.position.lon, vehicle.position.lat, this.clock.getSimulatedTime()]];

            // Update order state
            order.status = 'assigned';
            order.assignedVehicleId = vehicle.id;
            order.assignedAt = this.clock.getSimulatedTime();
            order.estimatedDeliveryTime =
              this.clock.getSimulatedTime() + result.route.durationS * 1000;

            // Synchronize into Neo4j Relationship Graph
            this.persistence.relationships.syncOrder(order, vehicle.id).catch(() => {});

            // Update upstream ecommerce-hive-nosql status (Out for Delivery)
            this.ecommerceClient.updateOrderStatus(order.id, 'Out for Delivery', vehicle.driverId);

            this.emitEvent('order', order.id, 'order.assigned', {
              vehicleId: vehicle.id,
              algorithm: result.route.algorithm,
              strategy: result.strategyUsed,
              distanceM: result.route.distanceM,
              durationS: result.route.durationS,
              nodesVisited: result.route.nodesVisited,
              queryTimeMs: result.route.queryTimeMs,
            });

            this.emitEvent('vehicle', vehicle.id, 'vehicle.dispatched', {
              orderId: order.id,
              routePoints: result.route.path.length,
              distanceM: result.route.distanceM,
            });
          }
          this.dispatchQueue.shift();
        }
        this.dispatching = false;
      })
      .catch((err) => {
        console.error('[SimulationEngine] Dispatch error:', err);
        this.dispatching = false;
      });
  }

  /**
   * Update all vehicle positions by advancing them along their route geometry.
   */
  private updateVehicles(simTime: number, deltaRealMs: number): void {
    // 1. SLA deadline monitoring across active orders
    for (const order of this.world.getAllOrders()) {
      if (order.status === 'delivered' || order.status === 'cancelled') continue;
      if (order.slaDeadline) {
        if (simTime > order.slaDeadline) {
          if (order.slaStatus !== 'breached') {
            order.slaStatus = 'breached';
            this.emitEvent('order', order.id, 'order.sla.breached', {
              orderId: order.id,
              priority: order.priority,
              deadline: order.slaDeadline,
              simTime,
            });
          }
        } else if (order.slaDeadline - simTime < 10 * 60 * 1000) {
          order.slaStatus = 'at_risk';
        } else {
          order.slaStatus = 'on_time';
        }
      }
    }

    // 2. Advance vehicle positions
    for (const vehicle of this.world.getAllVehicles()) {
      if (vehicle.status === 'en_route' || vehicle.status === 'returning') {
        this.advanceVehicle(vehicle, deltaRealMs);
      }
    }
  }

  /**
   * Advance a single vehicle along its route geometry.
   */
  private advanceVehicle(vehicle: Vehicle, deltaRealMs: number): void {
    if (vehicle.routeGeometry.length < 2 || vehicle.routeDurationS <= 0) {
      this.completeVehicleRoute(vehicle);
      return;
    }

    const deltaSimMs = deltaRealMs * this.clock.speed * 60;
    const deltaSimS = deltaSimMs / 1000;

    // Traffic congestion slows down effective vehicle progress
    const effectiveSpeedFactor = 1 / Math.max(0.2, this.trafficMultiplier);
    const progressIncrement = (deltaSimS / vehicle.routeDurationS) * effectiveSpeedFactor;
    vehicle.routeProgress = Math.min(1, vehicle.routeProgress + progressIncrement);

    // Interpolate position along the route polyline
    const newPosition = interpolateAlongPath(vehicle.routeGeometry, vehicle.routeProgress);
    vehicle.position = newPosition;
    vehicle.speed_kmh = (vehicle.routeDistanceM / vehicle.routeDurationS) * 3.6 * effectiveSpeedFactor;

    // Record rolling trail history for animated light trails
    if (!vehicle.trailHistory) vehicle.trailHistory = [];
    const simTime = this.clock.getSimulatedTime();
    const lastTrail = vehicle.trailHistory[vehicle.trailHistory.length - 1];
    if (
      !lastTrail ||
      haversineDistance(newPosition, { lat: lastTrail[1], lon: lastTrail[0] }) >= 15 ||
      simTime - lastTrail[2] >= 1000
    ) {
      vehicle.trailHistory.push([newPosition.lon, newPosition.lat, simTime]);
      if (vehicle.trailHistory.length > 35) {
        vehicle.trailHistory.shift();
      }
    }

    // Emit position update event & stream Cassandra ping to ecommerce-hive-nosql (every 5 ticks = 500ms)
    if (this.tickCounter % 5 === 0) {
      this.emitEvent('vehicle', vehicle.id, 'vehicle.position.updated', {
        lat: newPosition.lat,
        lon: newPosition.lon,
        progress: vehicle.routeProgress,
        speed_kmh: vehicle.speed_kmh,
      });

      // Stream GPS ping to Cassandra persistence
      const pingDate = new Date().toISOString().split('T')[0];
      const ping: TelemetryPing = {
        rider_id: vehicle.driverId,
        ping_timestamp: simTime,
        ping_date: pingDate,
        lat: newPosition.lat,
        lon: newPosition.lon,
        speed_kmh: vehicle.speed_kmh,
        battery_level: 92,
        status: vehicle.status,
        simulation_id: this.simulationId,
      };
      this.persistence.telemetry.savePing(ping).catch(() => {});
      this.persistence.vehicles.saveVehicleState(vehicle).catch(() => {});

      // Stream GPS ping to Cassandra via upstream ecommerce API
      const driver = this.world.getDriver(vehicle.driverId);
      this.ecommerceClient.sendRiderPing(
        vehicle.driverId,
        newPosition,
        vehicle.speed_kmh,
        92,
        vehicle.status,
        driver?.name || vehicle.driverName
      );
    }

    // Check if vehicle reached destination
    if (vehicle.routeProgress >= 1) {
      this.completeVehicleRoute(vehicle);
    }
  }

  /**
   * Handle vehicle arriving at its destination (single drop or tour leg).
   */
  private completeVehicleRoute(vehicle: Vehicle): void {
    const simTime = this.clock.getSimulatedTime();

    // 1. Multi-stop tour progressive execution
    if (vehicle.routeLegs && vehicle.routeLegs.length > 0) {
      const legIndex = vehicle.currentLegIndex ?? 0;
      const leg = vehicle.routeLegs[legIndex];

      // If this leg delivered an order, complete that order
      if (leg && leg.orderId) {
        const order = this.world.getOrder(leg.orderId);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = simTime;
          vehicle.currentLoad_kg = Math.max(0, vehicle.currentLoad_kg - order.totalWeight_kg);
          this.persistence.orders.updateOrderStatus(order.id, 'delivered', simTime).catch(() => {});
          this.persistence.relationships.updateOrderStatus(order.id, 'delivered').catch(() => {});
          this.ecommerceClient.updateOrderStatus(order.id, 'Delivered', vehicle.driverId);

          this.emitEvent('order', order.id, 'order.delivered', {
            vehicleId: vehicle.id,
            deliveredAt: simTime,
            legIndex: legIndex + 1,
            totalLegs: vehicle.routeLegs.length,
          });
        }
        vehicle.assignedOrderIds = vehicle.assignedOrderIds.filter((id) => id !== leg.orderId);
      }

      // Check if there are more legs in this tour
      if (leg) this.cumulativeDistanceKm += leg.distanceM / 1000;
      const nextIndex = legIndex + 1;
      if (nextIndex < vehicle.routeLegs.length) {
        vehicle.currentLegIndex = nextIndex;
        const nextLeg = vehicle.routeLegs[nextIndex];
        vehicle.routeGeometry = nextLeg.path;
        vehicle.routeDistanceM = nextLeg.distanceM;
        vehicle.routeDurationS = nextLeg.durationS;
        vehicle.routeProgress = 0;
        vehicle.status = nextLeg.orderId ? 'en_route' : 'returning';

        this.emitEvent('vehicle', vehicle.id, 'vehicle.leg.advanced', {
          currentLegIndex: nextIndex + 1,
          totalLegs: vehicle.routeLegs.length,
          isReturnLeg: !nextLeg.orderId,
        });
        return;
      } else {
        // Multi-stop tour fully finished and returned to depot
        this.resetVehicleToIdle(vehicle);
        this.emitEvent('vehicle', vehicle.id, 'vehicle.tour.completed', {
          depotId: vehicle.depotId,
        });
        return;
      }
    }

    // 2. Standard single-order delivery handling
    if (vehicle.status === 'en_route') {
      for (const orderId of vehicle.assignedOrderIds) {
        const order = this.world.getOrder(orderId);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = simTime;
          this.persistence.orders.updateOrderStatus(orderId, 'delivered', simTime).catch(() => {});
          this.persistence.relationships.updateOrderStatus(orderId, 'delivered').catch(() => {});

          // Notify upstream marketplace that order is Delivered
          this.ecommerceClient.updateOrderStatus(orderId, 'Delivered', vehicle.driverId);

          this.emitEvent('order', orderId, 'order.delivered', {
            vehicleId: vehicle.id,
            deliveredAt: simTime,
          });
        }
      }

      this.emitEvent('vehicle', vehicle.id, 'vehicle.arrived', {
        orderIds: vehicle.assignedOrderIds,
      });

      // Vehicle now returns to depot
      const depot = this.world.getAllWarehouses().find((w) => w.id === vehicle.depotId);
      if (depot) {
        this.routingClient
          .calculateRoute(vehicle.position, depot.position, {
            algorithm: this.activeRoutingAlgorithm,
            metric: 'time',
          })
          .then((returnRoute) => {
            this.benchmarkMetrics.totalQueries++;
            this.benchmarkMetrics.totalQueryTimeMs += returnRoute.queryTimeMs || 0;
            this.benchmarkMetrics.totalNodesVisited += returnRoute.nodesVisited || 0;

            vehicle.status = 'returning';
            vehicle.routeGeometry = returnRoute.path;
            vehicle.routeProgress = 0;
            vehicle.routeDistanceM = returnRoute.distanceM;
            vehicle.routeDurationS = returnRoute.durationS;
            vehicle.assignedOrderIds = [];
            vehicle.currentLoad_kg = 0;
            vehicle.currentRouteId = `RET-${vehicle.id}`;
            vehicle.trailHistory = [[vehicle.position.lon, vehicle.position.lat, this.clock.getSimulatedTime()]];
          })
          .catch(() => {
            this.resetVehicleToIdle(vehicle);
          });
      } else {
        this.resetVehicleToIdle(vehicle);
      }
    } else if (vehicle.status === 'returning') {
      this.resetVehicleToIdle(vehicle);
      this.emitEvent('vehicle', vehicle.id, 'vehicle.returned_to_depot', {
        depotId: vehicle.depotId,
      });
    }
  }

  private resetVehicleToIdle(vehicle: Vehicle): void {
    if (vehicle.routeDistanceM > 0 && vehicle.routeProgress >= 0.9) {
      this.cumulativeDistanceKm += vehicle.routeDistanceM / 1000;
    }
    vehicle.status = 'idle';
    vehicle.routeGeometry = [];
    vehicle.routeProgress = 0;
    vehicle.routeDistanceM = 0;
    vehicle.routeDurationS = 0;
    vehicle.currentRouteId = null;
    vehicle.assignedOrderIds = [];
    vehicle.currentLoad_kg = 0;
    vehicle.speed_kmh = 0;
    vehicle.routeLegs = [];
    vehicle.currentLegIndex = 0;
    vehicle.totalLegsCount = 0;
    vehicle.trailHistory = [];
  }

  private emitEvent(
    entityType: string,
    entityId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): void {
    const event: SimulationEvent = {
      eventId: uuidv4(),
      simulationId: this.simulationId,
      simTimestamp: this.clock.getSimulatedTime(),
      realTimestamp: Date.now(),
      entityType,
      entityId,
      eventType,
      payload,
    };
    this.eventBus.emit(event);
  }

  /**
   * Get current full simulation state.
   */
  public getState(): SimulationState {
    const vehicles = this.world.getAllVehicles();
    const orders = this.world.getAllOrders();

    const deliveredOrders = orders.filter((o) => o.status === 'delivered');
    const pendingOrders = orders.filter((o) => o.status === 'pending');
    const activeVehicles = vehicles.filter(
      (v) => v.status !== 'idle' && v.status !== 'broken_down'
    );

    let avgDeliveryTimeMin = 0;
    if (deliveredOrders.length > 0) {
      const totalDeliveryTime = deliveredOrders.reduce((sum, o) => {
        if (o.deliveredAt && o.createdAt) {
          return sum + (o.deliveredAt - o.createdAt);
        }
        return sum;
      }, 0);
      avgDeliveryTimeMin = totalDeliveryTime / deliveredOrders.length / 60000;
    }

    const activeDistanceKm = vehicles.reduce((sum, v) => {
      if (v.routeDistanceM > 0 && v.routeProgress > 0) {
        return sum + (v.routeDistanceM * v.routeProgress) / 1000;
      }
      return sum;
    }, 0);
    const totalDistanceKm = this.cumulativeDistanceKm + activeDistanceKm;

    // Calculate SLA compliance metrics
    const slaDelivered = deliveredOrders.filter((o) => !!o.slaDeadline);
    const slaBreachedDeliveries = slaDelivered.filter(
      (o) => (o.deliveredAt && o.slaDeadline && o.deliveredAt > o.slaDeadline) || o.slaStatus === 'breached'
    ).length;
    const slaOnTimeDeliveries = slaDelivered.length - slaBreachedDeliveries;
    const slaComplianceRate = slaDelivered.length > 0
      ? Math.round((slaOnTimeDeliveries / slaDelivered.length) * 1000) / 10
      : 100;

    const atRiskOrdersCount = orders.filter(
      (o) => o.status !== 'delivered' && o.status !== 'cancelled' && o.slaStatus === 'at_risk'
    ).length;

    const breachedActiveCount = orders.filter(
      (o) => o.status !== 'delivered' && o.status !== 'cancelled' && o.slaStatus === 'breached'
    ).length;
    const lateOrders = breachedActiveCount + slaBreachedDeliveries;

    return {
      simulationId: this.simulationId,
      simTime: this.clock.getSimulatedTime(),
      speed: this.clock.speed,
      status: this.intervalId
        ? this.clock.speed > 0
          ? 'running'
          : 'paused'
        : 'stopped',
      vehicles,
      orders,
      warehouses: this.world.getAllWarehouses(),
      ecommerceBridge: this.ecommerceClient.getStatus(),
      persistence: this.persistence.getStatus(),
      trafficMultiplier: this.trafficMultiplier,
      benchmarkStats: this.getBenchmarkStats(),
      incidents: this.incidents.filter((i) => i.active),
      activeScenarioId: this.activeScenarioId,
      stats: {
        activeVehicles: activeVehicles.length,
        totalOrders: orders.length,
        deliveredOrders: deliveredOrders.length,
        pendingOrders: pendingOrders.length,
        lateOrders,
        avgDeliveryTimeMin: Math.round(avgDeliveryTimeMin * 10) / 10,
        totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
        slaOnTimeDeliveries,
        slaBreachedDeliveries,
        slaComplianceRate,
        atRiskOrdersCount,
      },
    };
  }

  public setAlgorithms(options: {
    routingAlgorithm?: RoutingAlgorithm;
    dispatchStrategy?: DispatchStrategy;
  }): { routingAlgorithm: RoutingAlgorithm; dispatchStrategy: DispatchStrategy } {
    if (options.routingAlgorithm) this.activeRoutingAlgorithm = options.routingAlgorithm;
    if (options.dispatchStrategy) this.activeDispatchStrategy = options.dispatchStrategy;

    this.emitEvent('simulation', this.simulationId, 'algorithm.updated', {
      routingAlgorithm: this.activeRoutingAlgorithm,
      dispatchStrategy: this.activeDispatchStrategy,
    });

    console.log(
      `[SimulationEngine] Algorithms updated: routing=${this.activeRoutingAlgorithm}, dispatch=${this.activeDispatchStrategy}`
    );

    return {
      routingAlgorithm: this.activeRoutingAlgorithm,
      dispatchStrategy: this.activeDispatchStrategy,
    };
  }

  public getBenchmarkStats(): AlgorithmBenchmarkStats {
    const totalQueries = Math.max(1, this.benchmarkMetrics.totalQueries);
    const avgQueryTimeMs =
      Math.round((this.benchmarkMetrics.totalQueryTimeMs / totalQueries) * 1000) / 1000;
    const avgNodesVisited =
      Math.round((this.benchmarkMetrics.totalNodesVisited / totalQueries) * 10) / 10;
    const totalDistanceDrivenKm = this.world
      .getAllVehicles()
      .reduce((sum, v) => sum + (v.routeDistanceM * v.routeProgress) / 1000, 0);

    return {
      routingAlgorithm: this.activeRoutingAlgorithm,
      dispatchStrategy: this.activeDispatchStrategy,
      totalQueries: this.benchmarkMetrics.totalQueries,
      totalQueryTimeMs: Math.round(this.benchmarkMetrics.totalQueryTimeMs * 100) / 100,
      avgQueryTimeMs,
      totalNodesVisited: this.benchmarkMetrics.totalNodesVisited,
      avgNodesVisited,
      totalDistanceDrivenKm: Math.round(totalDistanceDrivenKm * 10) / 10,
      totalOrdersAssigned: this.benchmarkMetrics.totalOrdersAssigned,
    };
  }

  /**
   * Check if a route's remaining polyline intersects an incident circle.
   */
  public isRouteIntersectingIncident(
    path: [number, number][],
    progress: number,
    incident: RoadIncident
  ): boolean {
    if (!path || path.length === 0) return false;
    const startIndex = Math.min(path.length - 1, Math.ceil(progress * (path.length - 1)));
    for (let i = startIndex; i < path.length; i++) {
      const pt = { lon: path[i][0], lat: path[i][1] };
      if (haversineDistance(pt, incident.position) <= incident.radiusM) {
        return true;
      }
    }
    return false;
  }

  /**
   * Create an active road hazard incident (e.g. accident, flooding, road closure).
   * Automatically re-routes affected en-route vehicles around the incident hazard.
   */
  public createRoadIncident(incidentData: {
    type: 'accident' | 'road_work' | 'flooding' | 'congestion';
    description: string;
    position: Coordinate;
    radiusM: number;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    autoRerouteAffected?: boolean;
  }): RoadIncident {
    const id = `INC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const incident: RoadIncident = {
      id,
      type: incidentData.type,
      description: incidentData.description,
      position: incidentData.position,
      radiusM: incidentData.radiusM,
      severity: incidentData.severity || 'high',
      createdAt: this.clock.getSimulatedTime(),
      active: true,
    };

    this.incidents.push(incident);

    this.emitEvent('incident', incident.id, 'incident.created', {
      type: incident.type,
      description: incident.description,
      position: incident.position,
      radiusM: incident.radiusM,
      severity: incident.severity,
    });

    console.log(`[SimulationEngine] Road incident created: ${incident.description} (${incident.id})`);

    // Check for en-route vehicles whose remaining route passes through the hazard zone
    const affectedVehicles = this.world.getAllVehicles().filter((v) => {
      if (v.status !== 'en_route' && v.status !== 'returning') return false;
      return this.isRouteIntersectingIncident(v.routeGeometry, v.routeProgress, incident);
    });

    if (incidentData.autoRerouteAffected !== false && affectedVehicles.length > 0) {
      console.log(`[SimulationEngine] Hazard intersects ${affectedVehicles.length} vehicles. Auto-rerouting fleet...`);
      for (const vehicle of affectedVehicles) {
        this.rerouteVehicle(vehicle.id, {
          reason: `hazard_avoidance_${incident.type}`,
          avoidIncidents: true,
        }).catch((err) => {
          console.warn(`[SimulationEngine] Auto-reroute failed for ${vehicle.id}:`, (err as Error).message);
        });
      }
    }

    return incident;
  }

  /**
   * Clear an active road hazard incident.
   */
  public clearRoadIncident(incidentId: string): boolean {
    const incident = this.incidents.find((i) => i.id === incidentId);
    if (!incident || !incident.active) return false;

    incident.active = false;
    this.emitEvent('incident', incident.id, 'incident.cleared', {
      incidentId: incident.id,
      description: incident.description,
    });

    console.log(`[SimulationEngine] Road incident cleared: ${incident.id}`);
    return true;
  }

  /**
   * Get all active road incidents.
   */
  public getActiveIncidents(): RoadIncident[] {
    return this.incidents.filter((i) => i.active);
  }

  /**
   * Re-route a specific vehicle currently en-route from its live GPS position to its destination.
   * If an active hazard blocks the path, routes around the hazard via an avoidance detour.
   */
  public async rerouteVehicle(
    vehicleId: string,
    options?: { reason?: string; avoidIncidents?: boolean }
  ): Promise<{
    success: boolean;
    message: string;
    vehicleId: string;
    oldRemainingDistanceM?: number;
    newDistanceM?: number;
    newDurationS?: number;
    rerouteCount?: number;
  }> {
    const vehicle = this.world.getVehicle(vehicleId);
    if (!vehicle) {
      return { success: false, message: 'Vehicle not found', vehicleId };
    }

    if (vehicle.status !== 'en_route' && vehicle.status !== 'returning') {
      return {
        success: false,
        message: `Vehicle ${vehicle.id} is ${vehicle.status}. In-flight re-routing only applies to en_route or returning vehicles.`,
        vehicleId,
      };
    }

    // Determine destination target
    let targetDestination: Coordinate | null = null;
    if (vehicle.routeLegs && vehicle.routeLegs.length > 0) {
      const leg = vehicle.routeLegs[vehicle.currentLegIndex ?? 0];
      if (leg) targetDestination = leg.destination;
    } else if (vehicle.status === 'en_route' && vehicle.assignedOrderIds.length > 0) {
      const order = this.world.getOrder(vehicle.assignedOrderIds[0]);
      if (order) targetDestination = order.deliveryLocation;
    } else if (vehicle.status === 'returning') {
      const depot = this.world.getAllWarehouses().find((w) => w.id === vehicle.depotId);
      if (depot) targetDestination = depot.position;
    }

    if (!targetDestination && vehicle.routeGeometry.length > 0) {
      const last = vehicle.routeGeometry[vehicle.routeGeometry.length - 1];
      targetDestination = { lon: last[0], lat: last[1] };
    }

    if (!targetDestination) {
      return { success: false, message: `Could not resolve destination for vehicle ${vehicle.id}`, vehicleId };
    }

    const avoid = options?.avoidIncidents ?? true;
    const activeIncidents = this.incidents.filter((i) => i.active);
    let blockingIncident: RoadIncident | undefined;

    if (avoid) {
      blockingIncident = activeIncidents.find((inc) =>
        this.isRouteIntersectingIncident(vehicle.routeGeometry, vehicle.routeProgress, inc)
      );
    }

    const departureTime = this.clock.getFormattedTime().slice(0, 5);
    let newPath: [number, number][];
    let newDistanceM: number;
    let newDurationS: number;
    let queries = 0;
    let queryTimeMs = 0;
    let nodesVisited = 0;

    if (blockingIncident) {
      // Calculate road detour around hazard
      const detourPoint = calculateAvoidanceWaypoint(
        vehicle.position,
        targetDestination,
        blockingIncident.position,
        blockingIncident.radiusM
      );

      try {
        const leg1 = await this.routingClient.calculateRoute(vehicle.position, detourPoint, {
          algorithm: this.activeRoutingAlgorithm,
          metric: 'time',
          departureTime,
        });
        const leg2 = await this.routingClient.calculateRoute(detourPoint, targetDestination, {
          algorithm: this.activeRoutingAlgorithm,
          metric: 'time',
          departureTime,
        });

        newPath = [...leg1.path, ...leg2.path.slice(1)];
        newDistanceM = leg1.distanceM + leg2.distanceM;
        newDurationS = leg1.durationS + leg2.durationS;
        queries = 2;
        queryTimeMs = (leg1.queryTimeMs || 0) + (leg2.queryTimeMs || 0);
        nodesVisited = (leg1.nodesVisited || 0) + (leg2.nodesVisited || 0);
      } catch {
        // Fallback to direct routing if detour calculation encounters an error
        const direct = await this.routingClient.calculateRoute(vehicle.position, targetDestination, {
          algorithm: this.activeRoutingAlgorithm,
          metric: 'time',
          departureTime,
        });
        newPath = direct.path;
        newDistanceM = direct.distanceM;
        newDurationS = direct.durationS;
        queries = 1;
        queryTimeMs = direct.queryTimeMs || 0;
        nodesVisited = direct.nodesVisited || 0;
      }
    } else {
      const direct = await this.routingClient.calculateRoute(vehicle.position, targetDestination, {
        algorithm: this.activeRoutingAlgorithm,
        metric: 'time',
        departureTime,
      });
      newPath = direct.path;
      newDistanceM = direct.distanceM;
      newDurationS = direct.durationS;
      queries = 1;
      queryTimeMs = direct.queryTimeMs || 0;
      nodesVisited = direct.nodesVisited || 0;
    }

    const oldRemainingM = Math.round(vehicle.routeDistanceM * (1 - vehicle.routeProgress));
    vehicle.routeGeometry = newPath;
    vehicle.routeDistanceM = newDistanceM;
    vehicle.routeDurationS = newDurationS;
    vehicle.routeProgress = 0;
    vehicle.rerouteCount = (vehicle.rerouteCount || 0) + 1;
    vehicle.lastReroutedAt = this.clock.getSimulatedTime();
    vehicle.rerouteReason = options?.reason || (blockingIncident ? `avoid_${blockingIncident.type}` : 'in_flight_optimization');

    if (vehicle.routeLegs && vehicle.routeLegs[vehicle.currentLegIndex ?? 0]) {
      const leg = vehicle.routeLegs[vehicle.currentLegIndex ?? 0];
      leg.path = newPath;
      leg.distanceM = newDistanceM;
      leg.durationS = newDurationS;
    }

    this.benchmarkMetrics.totalQueries += queries;
    this.benchmarkMetrics.totalQueryTimeMs += queryTimeMs;
    this.benchmarkMetrics.totalNodesVisited += nodesVisited;

    this.emitEvent('vehicle', vehicle.id, 'vehicle.rerouted', {
      vehicleId: vehicle.id,
      reason: vehicle.rerouteReason,
      oldRemainingDistanceM: oldRemainingM,
      newDistanceM,
      newDurationS,
      rerouteCount: vehicle.rerouteCount,
      avoidedIncident: blockingIncident ? blockingIncident.id : null,
    });

    console.log(
      `[SimulationEngine] In-flight re-routed ${vehicle.id} (${vehicle.rerouteReason}): oldRem=${(oldRemainingM / 1000).toFixed(2)}km -> new=${(newDistanceM / 1000).toFixed(2)}km`
    );

    return {
      success: true,
      message: `Vehicle ${vehicle.id} dynamically re-routed. New path: ${(newDistanceM / 1000).toFixed(2)}km, ${(newDurationS / 60).toFixed(1)}min.`,
      vehicleId,
      oldRemainingDistanceM: oldRemainingM,
      newDistanceM,
      newDurationS,
      rerouteCount: vehicle.rerouteCount,
    };
  }

  /**
   * Re-route all active en-route and returning vehicles across the fleet.
   */
  public async rerouteEnRouteFleet(
    reason: string = 'fleet_traffic_optimization',
    avoidIncidents: boolean = true
  ): Promise<{ reroutedCount: number; vehicles: string[] }> {
    const enRouteVehicles = this.world
      .getAllVehicles()
      .filter((v) => v.status === 'en_route' || v.status === 'returning');

    if (enRouteVehicles.length === 0) {
      return { reroutedCount: 0, vehicles: [] };
    }

    const results = await Promise.allSettled(
      enRouteVehicles.map((v) => this.rerouteVehicle(v.id, { reason, avoidIncidents }))
    );

    const successfulIds: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (res.status === 'fulfilled' && res.value.success) {
        successfulIds.push(enRouteVehicles[i].id);
      }
    }

    this.emitEvent('simulation', this.simulationId, 'fleet.rerouted', {
      reason,
      totalEnRoute: enRouteVehicles.length,
      reroutedCount: successfulIds.length,
      vehicles: successfulIds,
    });

    console.log(`[SimulationEngine] Fleet in-flight re-routing completed: ${successfulIds.length}/${enRouteVehicles.length} vehicles re-routed.`);
    return { reroutedCount: successfulIds.length, vehicles: successfulIds };
  }

  public injectEvent(event: { type: string; targetId?: string; payload?: Record<string, unknown> }): { success: boolean; message: string } {
    switch (event.type) {
      case 'vehicle_breakdown': {
        const vehicle = event.targetId ? this.world.getVehicle(event.targetId) : undefined;
        if (!vehicle) return { success: false, message: 'Vehicle not found' };

        vehicle.status = 'broken_down';
        vehicle.speed_kmh = 0;

        // Update Neo4j Graph & compute impact cascade
        this.persistence.relationships.updateVehicleStatus(vehicle.id, 'broken_down', vehicle.position).catch(() => {});
        this.persistence.relationships.getImpactAnalysis('vehicle', vehicle.id).then((impact) => {
          this.emitEvent('incident', vehicle.id, 'incident.impact_analyzed', {
            impact,
            source: 'neo4j_relationship_graph',
          });
        }).catch(() => {});

        // Reassign in-transit orders back to pending
        let reallocated = 0;
        if (vehicle.assignedOrderIds.length > 0) {
          for (const orderId of vehicle.assignedOrderIds) {
            const order = this.world.getOrder(orderId);
            if (order && order.status !== 'delivered') {
              order.status = 'pending';
              order.assignedVehicleId = null;
              this.dispatchQueue.unshift(order.id);
              reallocated++;
            }
          }
          vehicle.assignedOrderIds = [];
        }

        this.emitEvent('vehicle', vehicle.id, 'vehicle.failed', {
          reason: 'operator_intervention',
          reallocatedOrders: reallocated,
        });
        return { success: true, message: `Vehicle ${vehicle.id} broke down. ${reallocated} orders returned to queue.` };
      }

      case 'vehicle_recover': {
        const vehicle = event.targetId ? this.world.getVehicle(event.targetId) : undefined;
        if (!vehicle) return { success: false, message: 'Vehicle not found' };

        this.resetVehicleToIdle(vehicle);
        this.persistence.relationships.updateVehicleStatus(vehicle.id, 'idle', vehicle.position).catch(() => {});
        this.emitEvent('vehicle', vehicle.id, 'vehicle.recovered', {
          reason: 'operator_intervention',
        });
        return { success: true, message: `Vehicle ${vehicle.id} repaired and back in service.` };
      }

      case 'depot_closure': {
        const depotId = event.targetId;
        const depot = this.world.getAllWarehouses().find((w) => w.id === depotId);
        if (!depot) return { success: false, message: 'Depot not found' };

        depot.status = 'closed';

        // Run Neo4j cascade impact analysis before rehoming
        this.persistence.relationships.getImpactAnalysis('depot', depot.id).then((impact) => {
          this.emitEvent('incident', depot.id, 'incident.impact_analyzed', {
            impact,
            source: 'neo4j_relationship_graph',
          });
        }).catch(() => {});

        // Re-home stationed idle vehicles to another open depot
        const openDepot = this.world.getAllWarehouses().find((w) => w.id !== depotId && w.status !== 'closed');
        let rehomed = 0;
        if (openDepot) {
          for (const v of this.world.getAllVehicles()) {
            if (v.depotId === depotId && v.status === 'idle') {
              v.depotId = openDepot.id;
              rehomed++;
            }
          }
        }

        this.emitEvent('depot', depot.id, 'depot.closed', {
          reason: event.payload?.reason || 'emergency_flooding',
          rehomedVehicles: rehomed,
        });
        return { success: true, message: `Depot ${depot.name} (${depot.id}) closed. ${rehomed} vehicles transferred.` };
      }

      case 'depot_reopen': {
        const depotId = event.targetId;
        const depot = this.world.getAllWarehouses().find((w) => w.id === depotId);
        if (!depot) return { success: false, message: 'Depot not found' };

        depot.status = 'open';
        this.emitEvent('depot', depot.id, 'depot.reopened', {});
        return { success: true, message: `Depot ${depot.name} reopened.` };
      }

      case 'demand_spike': {
        const count = Number(event.payload?.count) || 20;
        const simTime = this.clock.getSimulatedTime();
        for (let i = 0; i < count; i++) {
          const order = this.world.generateOrder(simTime);
          this.ordersGenerated++;
          this.dispatchQueue.push(order.id);
          this.persistence.orders.saveOrder(order).catch(() => {});
        }
        this.sortDispatchQueueByEDF();
        this.emitEvent('simulation', this.simulationId, 'demand.spike', {
          ordersInjected: count,
        });
        return { success: true, message: `Demand spike: injected ${count} urgent orders.` };
      }

      case 'traffic_congestion': {
        const factor = Number(event.payload?.multiplier) || 2.0;
        this.trafficMultiplier = factor;
        this.emitEvent('traffic', 'city_network', 'traffic.changed', {
          multiplier: factor,
        });
        if (event.payload?.autoReroute) {
          this.rerouteEnRouteFleet(`traffic_congestion_${factor}x`, true).catch(console.error);
        }
        return { success: true, message: `Traffic congestion set to ${factor.toFixed(1)}x slowdown.` };
      }

      case 'road_incident': {
        const payload = event.payload || {};
        const incident = this.createRoadIncident({
          type: (payload.incidentType as any) || 'accident',
          description: (payload.description as string) || 'Road Incident Blockade',
          position: (payload.position as Coordinate) || { lat: 11.5564, lon: 104.9282 },
          radiusM: Number(payload.radiusM) || 500,
          severity: (payload.severity as any) || 'high',
          autoRerouteAffected: payload.autoReroute !== false,
        });
        return { success: true, message: `Road incident created: "${incident.description}" (Radius: ${incident.radiusM}m).` };
      }

      case 'clear_incident': {
        const incidentId = event.targetId || (event.payload?.incidentId as string);
        if (!incidentId) return { success: false, message: 'Incident ID required.' };
        const cleared = this.clearRoadIncident(incidentId);
        return { success: cleared, message: cleared ? `Incident ${incidentId} cleared.` : 'Incident not found or already inactive.' };
      }

      case 'reroute_vehicle': {
        if (!event.targetId) return { success: false, message: 'Target vehicle ID required.' };
        const reason = (event.payload?.reason as string) || 'operator_command';
        this.rerouteVehicle(event.targetId, { reason, avoidIncidents: true }).catch(console.error);
        return { success: true, message: `In-flight re-route requested for vehicle ${event.targetId}.` };
      }

      case 'reroute_fleet': {
        const reason = (event.payload?.reason as string) || 'operator_fleet_command';
        this.rerouteEnRouteFleet(reason, true).catch(console.error);
        return { success: true, message: 'Fleet-wide in-flight re-route triggered.' };
      }

      case 'inject_order': {
        const payload = (event.payload || {}) as any;
        this.injectCustomOrder(payload).then((res) => {
          this.emitEvent('order', res.order?.id || 'manual', 'order.injected', res);
        }).catch(console.error);
        return { success: true, message: 'Express delivery order injected.' };
      }

      default:
        console.log(`[SimulationEngine] Unknown injection event type: ${event.type}`);
        return { success: false, message: `Unknown event type: ${event.type}` };
    }
  }

  /**
   * Get available delivery corridor presets for operator injection.
   */
  public getDeliveryPresets(): DeliveryCorridorPreset[] {
    return DELIVERY_CORRIDOR_PRESETS;
  }

  /**
   * Inject a custom or preset order into the simulation and immediately dispatch.
   */
  public async injectCustomOrder(options: {
    presetId?: string;
    pickupLocation?: Coordinate;
    deliveryLocation?: Coordinate;
    customerName?: string;
    priority?: OrderPriority;
    slaDurationMin?: number;
    items?: OrderItem[];
    totalWeight_kg?: number;
  }): Promise<{ success: boolean; order?: Order; assignedVehicleId?: string | null; message: string }> {
    const simTime = this.clock.getSimulatedTime();
    let pickupLocation = options.pickupLocation;
    let deliveryLocation = options.deliveryLocation;
    let customerName = options.customerName;
    let priority = options.priority;

    if (options.presetId) {
      const preset = DELIVERY_CORRIDOR_PRESETS.find(p => p.id === options.presetId);
      if (preset) {
        pickupLocation = pickupLocation || preset.pickup.position;
        deliveryLocation = deliveryLocation || preset.delivery.position;
        customerName = customerName || `${preset.name} Customer`;
        priority = priority || preset.suggestedPriority;
      }
    }

    if (!pickupLocation) {
      const defaultDepot = this.world.getAllWarehouses()[0];
      pickupLocation = defaultDepot?.position || { lat: 11.5680, lon: 104.9223 };
    }

    if (!deliveryLocation) {
      deliveryLocation = { lat: 11.5528, lon: 104.9282 }; // BKK1 fallback
    }

    const order = this.world.createCustomOrder({
      pickupLocation,
      deliveryLocation,
      customerName,
      priority: priority || 'express',
      slaDurationMin: options.slaDurationMin,
      items: options.items,
      totalWeight_kg: options.totalWeight_kg,
      simTimestamp: simTime,
    });

    this.ordersGenerated++;

    // Urgent and Express orders jump to front of queue
    if (order.priority === 'urgent' || order.priority === 'express') {
      this.dispatchQueue.unshift(order.id);
    } else {
      this.dispatchQueue.push(order.id);
    }

    this.sortDispatchQueueByEDF();

    // Persist
    this.persistence.orders.saveOrder(order).catch(() => {});

    // Emit domain event
    this.emitEvent('order', order.id, 'order.created', {
      orderId: order.id,
      customerId: order.customerId,
      customerName: this.world.getCustomer(order.customerId)?.name,
      pickupLocation: order.pickupLocation,
      deliveryLocation: order.deliveryLocation,
      priority: order.priority,
      slaDeadline: order.slaDeadline,
      slaDurationMin: order.slaDurationMin,
      itemsCount: order.items.length,
      source: 'operator_injection',
    });

    // Run an immediate dispatch pass
    await this.dispatchPendingOrders();

    const assignedVehicle = order.assignedVehicleId ? this.world.getVehicle(order.assignedVehicleId) : null;
    const msg = assignedVehicle
      ? `Order ${order.id} (${(order.priority || 'standard').toUpperCase()}) dispatched to ${assignedVehicle.name} (${assignedVehicle.driverName})!`
      : `Order ${order.id} (${(order.priority || 'standard').toUpperCase()}) queued for next available courier.`;

    return {
      success: true,
      order,
      assignedVehicleId: order.assignedVehicleId,
      message: msg,
    };
  }
}
