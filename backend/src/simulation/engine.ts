/**
 * @fileoverview SimulationEngine drives the core simulation loop.
 *
 * The engine orchestrates discrete simulation ticks:
 * 1. Advance the simulation clock
 * 2. Generate paced scenario orders & ingest upstream marketplace orders
 * 3. Dispatch pending orders via heuristic assignment or multi-stop VRP tour solving
 * 4. Move vehicles along routing geometry with incident & congestion awareness
 * 5. Record simulated telemetry pings
 * 6. Monitor SLA deadlines, execute anticipatory rebalancing, and handle chaos events
 * 7. Emit domain events to the EventBus
 *
 * Built as a highly modular, scalable coordinator delegating to cohesive subsystems:
 * - OrderPipeline: order pacing, geocoding resolution, EDF queue sorting
 * - IncidentManager: road hazard tracking and route collision detection
 * - FleetAdvancer: vehicle progression, route completion, and telemetry
 * - RerouteCoordinator: dynamic avoidance detours and fleet-wide rerouting
 * - DispatchCoordinator: VRP tour solving and nearest-available order dispatch
 * - EventInjector: operator scenario event and custom order injections
 * - SimulationStateBuilder: metrics aggregation and state snapshot generation
 */

import { SimulationClock } from './clock.js';
import { World } from '../world/world.js';
import { EventBus } from '../events/event-bus.js';
import { Dispatcher } from '../dispatch/dispatcher.js';
import { VrpTourSolver } from '../dispatch/vrp.js';
import { PredictiveAiEngine } from '../dispatch/predictive-ai.js';
import { ChaosEngine } from './chaos-engine.js';
import { RoutingClient, GraphProvenance } from '../routing/client.js';
import { EcommerceReadClient, EcommerceOrder, MarketplaceReadAdapter } from '../integrations/ecommerce.js';
import { OperationalPlatformReadClient } from '../integrations/operational-platform.js';
import { createPersistenceLayer, IPersistenceLayer } from '../persistence/index.js';
import { SCENARIO_PRESETS, defaultScenario } from '../scenarios/presets.js';
import {
  SimulationState,
  SimulationEvent,
  Vehicle,
  Order,
  RoutingAlgorithm,
  DispatchStrategy,
  AlgorithmBenchmarkStats,
  RoadIncident,
  ScenarioConfig,
  ChaosMode,
  PredictiveAiMetrics,
} from '../world/types.js';
import { computeCanonicalEventSequenceHash } from '../events/canonical-hash.js';
import { type DeliveryCorridorPreset, DELIVERY_CORRIDOR_PRESETS } from './corridors.js';
import { IncidentManager, type CreateIncidentOptions } from './incident-manager.js';
import { OrderPipeline } from './order-pipeline.js';
import { FleetAdvancer } from './fleet-advancer.js';
import { RerouteCoordinator, type RerouteOptions, type RerouteResult } from './reroute-coordinator.js';
import { DispatchCoordinator } from './dispatch-coordinator.js';
import { EventInjector, type CustomOrderOptions } from './event-injector.js';
import { SimulationStateBuilder, type BenchmarkMetricsRaw } from './state-builder.js';

export { type DeliveryCorridorPreset, DELIVERY_CORRIDOR_PRESETS };

export class SimulationEngine {
  public clock: SimulationClock;
  public world: World;
  public eventBus: EventBus;
  public dispatcher: Dispatcher;
  public vrpSolver: VrpTourSolver;
  public routingClient: RoutingClient;
  public ecommerceClient: MarketplaceReadAdapter;
  public operationalPlatformClient: OperationalPlatformReadClient;
  public persistence: IPersistenceLayer;
  public predictiveAiEngine: PredictiveAiEngine;
  public chaosEngine: ChaosEngine = new ChaosEngine();

  // Modular subsystems
  private incidentManager: IncidentManager;
  private orderPipeline: OrderPipeline;
  private fleetAdvancer: FleetAdvancer;
  private rerouteCoordinator: RerouteCoordinator;
  private dispatchCoordinator: DispatchCoordinator;
  private eventInjector: EventInjector;

  private simulationId: string;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly TICK_RATE_MS = 100;
  private lastTickTime: number = 0;
  private activeScenarioId: string = 'morning_delivery';
  private tickCounter: number = 0;

  /** Pending dispatch queue — order IDs waiting for vehicle assignment */
  private dispatchQueue: string[] = [];
  /** Global traffic congestion factor (1.0 = normal, 2.0 = heavy traffic) */
  private trafficMultiplier: number = 1.0;

  /** Active routing algorithm for osm-pathfinder */
  private activeRoutingAlgorithm: RoutingAlgorithm = 'contraction_hierarchies';
  /** Active dispatch strategy for assigning orders to vehicles */
  private activeDispatchStrategy: DispatchStrategy = 'nearest_available';

  /** Aggregated benchmark performance metrics */
  private benchmarkMetrics: BenchmarkMetricsRaw = {
    totalQueries: 0,
    totalQueryTimeMs: 0,
    totalNodesVisited: 0,
    totalOrdersAssigned: 0,
  };

  private eventSequenceNumber: number = 0;
  private strictRouting: boolean = false;
  private requireRealGraph: boolean = false;
  private runInvalidated: boolean = false;
  private invalidationReason?: string;
  private cachedProvenance?: GraphProvenance;
  private operationalPlatformUrlConfigured: boolean = false;

  constructor(options: {
    scenarioId?: string;
    scenario?: ScenarioConfig;
    ecommerceReadUrl?: string;
    operationalPlatformUrl?: string;
    routingUrl?: string;
    strictRouting?: boolean;
    requireRealGraph?: boolean;
  } = {}) {
    const scenario = options.scenario || (options.scenarioId ? SCENARIO_PRESETS[options.scenarioId] : undefined) || defaultScenario;
    this.activeScenarioId = scenario.id || 'morning_delivery';
    this.simulationId = `sim-${this.activeScenarioId}-${scenario.seed}`;
    this.clock = new SimulationClock();
    this.eventBus = new EventBus();
    this.world = new World(scenario);
    this.dispatcher = new Dispatcher();
    this.vrpSolver = new VrpTourSolver();
    this.routingClient = new RoutingClient(options.routingUrl ?? process.env.ROUTING_SERVICE_URL ?? 'http://localhost:8000');

    if (options.strictRouting) {
      this.strictRouting = true;
      this.routingClient.setStrictMode(true);
    }
    if (options.requireRealGraph) {
      this.requireRealGraph = true;
    }

    this.ecommerceClient = new EcommerceReadClient(options.ecommerceReadUrl ?? process.env.ECOMMERCE_READ_URL);
    const opUrl = options.operationalPlatformUrl ?? process.env.OPERATIONAL_PLATFORM_URL;
    this.operationalPlatformClient = new OperationalPlatformReadClient(opUrl ?? 'http://127.0.0.1:8100');
    this.operationalPlatformUrlConfigured = Boolean(opUrl);
    this.persistence = createPersistenceLayer();
    this.predictiveAiEngine = new PredictiveAiEngine();

    // Initialize subsystems
    this.incidentManager = new IncidentManager();
    this.orderPipeline = new OrderPipeline(scenario.orderCount, scenario.duration_hours);
    this.fleetAdvancer = new FleetAdvancer({
      routingClient: this.routingClient,
      persistence: this.persistence,
      predictiveAiEngine: this.predictiveAiEngine,
      emitEvent: (entityType, entityId, eventType, payload) =>
        this.emitEvent(entityType, entityId, eventType, payload),
    });
    this.rerouteCoordinator = new RerouteCoordinator(this.routingClient, this.incidentManager);
    this.dispatchCoordinator = new DispatchCoordinator({
      world: this.world,
      clock: this.clock,
      dispatcher: this.dispatcher,
      vrpSolver: this.vrpSolver,
      routingClient: this.routingClient,
      predictiveAiEngine: this.predictiveAiEngine,
      persistence: this.persistence,
      orderPipeline: this.orderPipeline,
      dispatchQueue: this.dispatchQueue,
      emitEvent: (entityType, entityId, eventType, payload) =>
        this.emitEvent(entityType, entityId, eventType, payload),
      invalidateRun: (reason) => this.invalidateRun(reason),
      isStrictRouting: () => this.strictRouting,
      onBenchmarkUpdate: (queries, queryTimeMs, nodesVisited, ordersAssigned) => {
        this.benchmarkMetrics.totalQueries += queries;
        this.benchmarkMetrics.totalQueryTimeMs += queryTimeMs;
        this.benchmarkMetrics.totalNodesVisited += nodesVisited;
        this.benchmarkMetrics.totalOrdersAssigned += ordersAssigned;
      },
    });

    this.eventInjector = new EventInjector({
      world: this.world,
      clock: this.clock,
      persistence: this.persistence,
      incidentManager: this.incidentManager,
      rerouteCoordinator: this.rerouteCoordinator,
      fleetAdvancer: this.fleetAdvancer,
      orderPipeline: this.orderPipeline,
      dispatchQueue: this.dispatchQueue,
      simulationId: this.simulationId,
      activeRoutingAlgorithm: this.activeRoutingAlgorithm,
      emitEvent: (entityType, entityId, eventType, payload) =>
        this.emitEvent(entityType, entityId, eventType, payload),
      dispatchPendingOrders: () => this.dispatchPendingOrders(),
      setTrafficMultiplier: (factor) => {
        this.trafficMultiplier = factor;
      },
      onBenchmarkQueries: (queries, queryTimeMs, nodesVisited) => {
        this.benchmarkMetrics.totalQueries += queries;
        this.benchmarkMetrics.totalQueryTimeMs += queryTimeMs;
        this.benchmarkMetrics.totalNodesVisited += nodesVisited;
      },
    });

    this.seedInitialOrders(20);

    this.ecommerceClient.checkHealth().then((ok) => {
      if (ok) {
        console.log('[SimulationEngine] Upstream ecommerce-hive-nosql connected on port 8400 ✓');
        this.ecommerceClient.fetchCatalog().then((cat) => {
          if (cat && cat.length > 0) this.world.setCatalog(cat);
        });
      }
    });

    console.log(
      `[SimulationEngine] Created simulation ${this.simulationId}`,
      `| ${defaultScenario.vehicleCount} vehicles`,
      `| ${defaultScenario.orderCount} target orders`,
      `| ${defaultScenario.duration_hours}h duration`,
      `| Persistence: ${this.persistence.driverType}`
    );
  }

  public seedInitialOrders(count: number = 20): void {
    const simTime = this.clock.getSimulatedTime();
    this.orderPipeline.seedInitialOrders(count, simTime, this.world, this.dispatchQueue, this.persistence);
  }

  public start(): void {
    if (this.intervalId) return;

    this.routingClient.healthCheck().then((ok) => {
      if (ok) {
        console.log('[SimulationEngine] osm-pathfinder is available ✓');
      } else {
        console.warn('[SimulationEngine] osm-pathfinder is NOT available — using fallback routing');
      }
    });

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
        console.log('[SimulationEngine] Upstream ecommerce-hive-nosql marketplace standby (not reachable on port 8400)');
      }
    });

    this.persistence.relationships
      .syncTopology(
        this.world.getAllWarehouses(),
        this.world.getAllVehicles(),
        this.world.getAllDrivers()
      )
      .catch(() => {});

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

  public stop(): void {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
    this.emitEvent('simulation', this.simulationId, 'simulation.stopped', {});
    console.log('[SimulationEngine] Simulation stopped');
  }

  public pause(): void {
    this.clock.pause();
    this.emitEvent('simulation', this.simulationId, 'simulation.paused', {});
  }

  public resume(): void {
    this.clock.resume();
    this.lastTickTime = Date.now();
    this.emitEvent('simulation', this.simulationId, 'simulation.resumed', {});
  }

  public setSpeed(speed: number): void {
    this.clock.setSpeed(speed);
    this.emitEvent('simulation', this.simulationId, 'simulation.speed_changed', { speed });
  }

  public isRunning(): boolean {
    return this.intervalId !== null;
  }

  private tick(): void {
    if (this.clock.isPaused || this.clock.speed === 0) {
      this.lastTickTime = Date.now();
      return;
    }
    const now = Date.now();
    const deltaMs = now - this.lastTickTime;
    this.lastTickTime = now;
    this.tickCounter++;

    this.clock.tick(deltaMs);
    const simTime = this.clock.getSimulatedTime();
    const deltaSimMs = deltaMs * this.clock.speed * 60;

    this.chaosEngine.tick(simTime, this);

    this.orderPipeline.generatePacedOrders(
      simTime,
      this.world,
      this.dispatchQueue,
      this.persistence,
      (order) => {
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
    );

    if (this.tickCounter % 50 === 0) {
      this.pollEcommerceOrders();
    }

    this.dispatchPendingOrders();

    this.fleetAdvancer.updateVehicles(
      this.world,
      this.clock,
      deltaSimMs,
      this.trafficMultiplier,
      this.tickCounter,
      this.simulationId,
      this.activeRoutingAlgorithm,
      (queries, queryTimeMs, nodesVisited) => {
        this.benchmarkMetrics.totalQueries += queries;
        this.benchmarkMetrics.totalQueryTimeMs += queryTimeMs;
        this.benchmarkMetrics.totalNodesVisited += nodesVisited;
      }
    );

    if (this.activeDispatchStrategy === 'predictive_ai' && this.tickCounter % 30 === 0) {
      this.evaluatePredictiveRebalancing(simTime);
    }
  }

  public ingestEcommerceOrder(eOrder: EcommerceOrder): Order {
    if (!this.isRunning()) {
      this.start();
    }
    if (this.clock.speed > 1) {
      this.setSpeed(1);
    }

    const order = this.orderPipeline.ingestEcommerceOrder(
      eOrder,
      this.clock.getSimulatedTime(),
      this.world,
      this.dispatchQueue,
      this.persistence,
      this.ecommerceClient
    );

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
    this.dispatchPendingOrders();
    return order;
  }

  public getScenarioPresets(): ScenarioConfig[] {
    return Object.values(SCENARIO_PRESETS);
  }

  public loadScenario(
    scenarioId: string,
    options: { seedOrders?: boolean } = {}
  ): { success: boolean; message: string; scenario: ScenarioConfig; state?: SimulationState } {
    const scenario = SCENARIO_PRESETS[scenarioId];
    if (!scenario) {
      return { success: false, message: `Scenario preset "${scenarioId}" not found.`, scenario: SCENARIO_PRESETS.morning_delivery };
    }

    this.stop();
    this.world.reset(scenario);
    this.activeScenarioId = scenario.id || scenarioId;
    this.orderPipeline.resetPacing(scenario.orderCount, scenario.duration_hours);
    this.dispatchQueue = [];
    this.incidentManager.reset();
    this.clock = new SimulationClock(0, 1);
    this.benchmarkMetrics = {
      totalQueries: 0,
      totalQueryTimeMs: 0,
      totalNodesVisited: 0,
      totalOrdersAssigned: 0,
    };
    this.fleetAdvancer.resetCumulativeDistance();

    if (options.seedOrders) {
      this.seedInitialOrders(20);
    }

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
    return { success: true, message: `Loaded scenario "${scenario.name}".`, scenario, state: this.getState() };
  }

  public reset(
    scenarioConfig?: ScenarioConfig,
    options: { seedOrders?: boolean } = {}
  ): { success: boolean; message: string; state: SimulationState } {
    this.stop();

    const config = scenarioConfig ?? (SCENARIO_PRESETS[this.activeScenarioId] || defaultScenario);
    this.activeScenarioId = config.id || this.activeScenarioId || 'morning_delivery';
    this.simulationId = `sim-${this.activeScenarioId}-${config.seed}`;

    this.clock.reset(0, 1);
    this.world.reset(config);
    this.eventBus.clear();
    this.eventSequenceNumber = 0;

    this.tickCounter = 0;
    this.lastTickTime = 0;
    this.dispatchQueue = [];
    this.incidentManager.reset();
    this.runInvalidated = false;
    this.invalidationReason = undefined;

    this.persistence = createPersistenceLayer();
    this.chaosEngine.reset(config.seed);
    this.predictiveAiEngine.reset();
    this.orderPipeline.resetPacing(config.orderCount, config.duration_hours);
    this.fleetAdvancer.resetCumulativeDistance();

    this.benchmarkMetrics = {
      totalQueries: 0,
      totalQueryTimeMs: 0,
      totalNodesVisited: 0,
      totalOrdersAssigned: 0,
    };

    if (options.seedOrders) {
      this.seedInitialOrders(20);
    }

    this.emitEvent('simulation', this.simulationId, 'simulation.reset', {
      scenarioId: this.activeScenarioId,
      seed: config.seed,
    });

    console.log(`[SimulationEngine] Reset simulation ${this.simulationId} to clean zero-state.`);
    return {
      success: true,
      message: `Reset simulation ${this.simulationId} to clean zero-state.`,
      state: this.getState(),
    };
  }

  public step(
    steps: number = 1,
    deltaSimMs?: number
  ): { stepsExecuted: number; simTime: number; deltaSimMs: number } {
    const effectiveSteps = Math.max(1, Math.floor(steps));
    const stepDeltaSim = deltaSimMs ?? (this.TICK_RATE_MS * (this.clock.speed || 1) * 60);

    const wasPaused = this.clock.isPaused;
    this.clock.resume();

    try {
      for (let i = 0; i < effectiveSteps; i++) {
        this.tickCounter++;
        this.clock.step(stepDeltaSim);
        const simTime = this.clock.getSimulatedTime();

        if (this.tickCounter % 50 === 0) {
          this.pollEcommerceOrders();
        }

        this.orderPipeline.generatePacedOrders(
          simTime,
          this.world,
          this.dispatchQueue,
          this.persistence,
          (order) => {
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
        );

        this.dispatchPendingOrders();

        this.fleetAdvancer.updateVehicles(
          this.world,
          this.clock,
          stepDeltaSim,
          this.trafficMultiplier,
          this.tickCounter,
          this.simulationId,
          this.activeRoutingAlgorithm,
          (queries, queryTimeMs, nodesVisited) => {
            this.benchmarkMetrics.totalQueries += queries;
            this.benchmarkMetrics.totalQueryTimeMs += queryTimeMs;
            this.benchmarkMetrics.totalNodesVisited += nodesVisited;
          }
        );

        if (this.activeDispatchStrategy === 'predictive_ai' && this.tickCounter % 30 === 0) {
          this.evaluatePredictiveRebalancing(simTime);
        }

        this.chaosEngine.tick(simTime, this);
      }
    } finally {
      if (wasPaused) {
        this.clock.pause();
      }
    }

    this.emitEvent('simulation', this.simulationId, 'simulation.stepped', {
      stepsExecuted: effectiveSteps,
      deltaSimMs: stepDeltaSim,
      simTime: this.clock.getSimulatedTime(),
    });

    return {
      stepsExecuted: effectiveSteps,
      simTime: this.clock.getSimulatedTime(),
      deltaSimMs: stepDeltaSim,
    };
  }

  public getEventSequenceHash(): { hash: string; eventCount: number; simulationId: string } {
    const events = this.eventBus.getHistory();
    const hash = computeCanonicalEventSequenceHash(events);
    return {
      hash,
      eventCount: events.length,
      simulationId: this.simulationId,
    };
  }

  private async pollEcommerceOrders(): Promise<void> {
    try {
      const isUp = await this.ecommerceClient.checkHealth();
      if (isUp) {
        const pendingOrders = await this.ecommerceClient.fetchPendingOrders();
        for (const eOrder of pendingOrders) {
          if (!this.world.getOrder(eOrder.order_id)) {
            this.ingestEcommerceOrder(eOrder);
          }
        }
      }
    } catch {
      // Non-blocking background sync error
    }

    if (this.operationalPlatformUrlConfigured) {
      try {
        const isPlatformUp = await this.operationalPlatformClient.checkHealth();
        if (isPlatformUp) {
          const opOrders = await this.operationalPlatformClient.fetchPendingOrders();
          for (const opOrder of opOrders) {
            if (!this.world.getOrder(opOrder.order_id)) {
              this.ingestEcommerceOrder(opOrder);
            }
          }
        }
      } catch {
        // Non-blocking background sync error
      }
    }
  }

  private dispatchPendingOrders(): void {
    this.dispatchCoordinator.dispatchPendingOrders(
      this.activeDispatchStrategy,
      this.activeRoutingAlgorithm
    );
  }

  public async evaluatePredictiveRebalancing(simTime: number): Promise<{ success: boolean; action?: any }> {
    try {
      const plan = await this.predictiveAiEngine.planAnticipatoryRebalancing(
        this.world,
        this.routingClient,
        this.activeRoutingAlgorithm,
        simTime,
        this.dispatchQueue
      );

      if (!plan) return { success: false };

      const { vehicle, action, path, distanceM, durationS } = plan;
      vehicle.status = 'en_route';
      vehicle.routeGeometry = path;
      vehicle.routeProgress = 0;
      vehicle.routeDistanceM = distanceM;
      vehicle.routeDurationS = durationS;
      vehicle.currentRouteId = action.id;
      vehicle.assignedOrderIds = [];
      vehicle.currentLoad_kg = 0;
      vehicle.trailHistory = [[vehicle.position.lon, vehicle.position.lat, simTime]];

      this.emitEvent('vehicle', vehicle.id, 'vehicle.repositioned', {
        actionId: action.id,
        vehicleId: vehicle.id,
        fromDistrict: action.fromDistrict,
        toDistrict: action.toDistrict,
        reason: action.reason,
        targetPosition: action.targetPosition,
      });

      console.log(`[SimulationEngine] 🤖 AI Rebalanced ${vehicle.id}: ${action.reason}`);
      return { success: true, action };
    } catch (err) {
      console.warn('[SimulationEngine] Predictive rebalancing evaluation error:', err);
      return { success: false };
    }
  }

  public emitEvent(
    entityType: string,
    entityId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): void {
    this.eventSequenceNumber++;
    const event: SimulationEvent = {
      sequenceNumber: this.eventSequenceNumber,
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      simulationId: this.simulationId,
      simTimestamp: this.clock.getSimulatedTime(),
      entityType: entityType as any,
      entityId,
      eventType: eventType as any,
      payload,
    };
    this.eventBus.emit(event);
  }

  private dequeueOrder(orderId: string): boolean {
    return this.orderPipeline.dequeueOrder(this.dispatchQueue, orderId);
  }

  private sortDispatchQueueByEDF(): void {
    this.orderPipeline.sortDispatchQueueByEDF(this.dispatchQueue, this.world);
  }

  private updateVehicles(simTime: number, deltaSimMs: number): void {
    this.fleetAdvancer.updateVehicles(
      this.world,
      this.clock,
      deltaSimMs,
      this.trafficMultiplier,
      this.tickCounter,
      this.simulationId,
      this.activeRoutingAlgorithm,
      (queries, queryTimeMs, nodesVisited) => {
        this.benchmarkMetrics.totalQueries += queries;
        this.benchmarkMetrics.totalQueryTimeMs += queryTimeMs;
        this.benchmarkMetrics.totalNodesVisited += nodesVisited;
      }
    );
  }

  public getStatus(): 'running' | 'paused' | 'stopped' | 'invalidated' {
    if (this.runInvalidated) {
      return 'invalidated';
    }
    if (!this.intervalId && !this.clock.isPaused) {
      return 'stopped';
    }
    if (this.clock.isPaused || this.clock.speed === 0) {
      return 'paused';
    }
    return 'running';
  }

  public setStrictRouting(strict: boolean, requireRealGraph: boolean = false): void {
    this.strictRouting = strict;
    this.requireRealGraph = requireRealGraph;
    this.routingClient.setStrictMode(strict);
  }

  public isStrictRouting(): boolean {
    return this.strictRouting;
  }

  public invalidateRun(reason: string): void {
    this.runInvalidated = true;
    this.invalidationReason = reason;
    this.pause();
    this.emitEvent('simulation', this.simulationId, 'simulation.invalidated', {
      reason,
      strictRouting: this.strictRouting,
      requireRealGraph: this.requireRealGraph,
    });
  }

  public getState(): SimulationState {
    return SimulationStateBuilder.buildState({
      simulationId: this.simulationId,
      clock: this.clock,
      world: this.world,
      ecommerceClient: this.ecommerceClient,
      persistence: this.persistence,
      incidentManager: this.incidentManager,
      predictiveAiEngine: this.predictiveAiEngine,
      chaosEngine: this.chaosEngine,
      dispatchQueue: this.dispatchQueue,
      trafficMultiplier: this.trafficMultiplier,
      activeScenarioId: this.activeScenarioId,
      activeRoutingAlgorithm: this.activeRoutingAlgorithm,
      activeDispatchStrategy: this.activeDispatchStrategy,
      strictRouting: this.strictRouting,
      requireRealGraph: this.requireRealGraph,
      cachedProvenance: this.cachedProvenance,
      invalidationReason: this.invalidationReason,
      cumulativeDistanceKm: this.fleetAdvancer.getCumulativeDistanceKm(),
      benchmarkMetrics: this.benchmarkMetrics,
      getStatus: () => this.getStatus(),
    });
  }

  public getSimulationId(): string {
    return this.simulationId;
  }

  public getChaosMetrics() {
    return this.chaosEngine.getMetrics();
  }

  public setChaosMode(mode: ChaosMode) {
    this.chaosEngine.setMode(mode);
    this.emitEvent('simulation', this.simulationId, 'chaos.mode_changed', { mode });
  }

  public async mitigateSlaBreachRisk(orderId: string): Promise<{ success: boolean; message: string; actionTaken: string }> {
    const order = this.world.getOrder(orderId);
    if (!order) return { success: false, message: 'Order not found', actionTaken: 'none' };

    order.priority = 'urgent';
    order.slaDeadline = (order.slaDeadline ?? this.clock.getSimulatedTime()) + 15 * 60 * 1000;

    if (order.assignedVehicleId) {
      const v = this.world.getVehicle(order.assignedVehicleId);
      if (v && (v.status === 'en_route' || v.status === 'delivering')) {
        await this.rerouteVehicle(v.id, { reason: 'sla_breach_mitigation_fast_corridor', avoidIncidents: true });
        this.predictiveAiEngine.recordBreachAverted();
        this.emitEvent('order', order.id, 'order.sla_mitigated', {
          orderId: order.id,
          vehicleId: v.id,
          action: 'corridor_fast_path_reroute',
        });
        return {
          success: true,
          message: `Order ${orderId} elevated to URGENT priority. Courier ${v.name} dynamically re-routed via expedited corridor.`,
          actionTaken: 'expedited_reroute',
        };
      }
    }

    const qIdx = this.dispatchQueue.indexOf(order.id);
    if (qIdx > -1) {
      this.dispatchQueue.splice(qIdx, 1);
    }
    this.dispatchQueue.unshift(order.id);
    this.dispatchPendingOrders();

    this.predictiveAiEngine.recordBreachAverted();
    return {
      success: true,
      message: `Order ${orderId} elevated to URGENT priority and bumped to head of dispatch queue.`,
      actionTaken: 'priority_reassignment',
    };
  }

  public getPredictiveAiMetrics(): PredictiveAiMetrics {
    return this.predictiveAiEngine.getMetrics(
      this.world,
      this.clock.getSimulatedTime(),
      this.trafficMultiplier,
      this.dispatchQueue
    );
  }

  public async triggerPredictiveRebalance(): Promise<{ success: boolean; action?: any }> {
    return this.evaluatePredictiveRebalancing(this.clock.getSimulatedTime());
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
    return SimulationStateBuilder.buildBenchmarkStats(
      this.benchmarkMetrics,
      this.world.getAllVehicles(),
      this.activeRoutingAlgorithm,
      this.activeDispatchStrategy
    );
  }

  public isRouteIntersectingIncident(
    path: [number, number][],
    progress: number,
    incident: RoadIncident
  ): boolean {
    return this.incidentManager.isRouteIntersectingIncident(path, progress, incident);
  }

  public createRoadIncident(incidentData: CreateIncidentOptions): RoadIncident {
    const incident = this.incidentManager.createIncident(incidentData, this.clock.getSimulatedTime());
    this.emitEvent('incident', incident.id, 'incident.created', {
      type: incident.type,
      description: incident.description,
      position: incident.position,
      radiusM: incident.radiusM,
      severity: incident.severity,
    });

    console.log(`[SimulationEngine] Road incident created: ${incident.description} (${incident.id})`);

    const affected = this.incidentManager.getAffectedVehicles(this.world.getAllVehicles(), incident);
    if (incidentData.autoRerouteAffected !== false && affected.length > 0) {
      console.log(`[SimulationEngine] Hazard intersects ${affected.length} vehicles. Auto-rerouting fleet...`);
      for (const vehicle of affected) {
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

  public clearRoadIncident(incidentId: string): boolean {
    const cleared = this.incidentManager.clearIncident(incidentId);
    if (!cleared) return false;
    this.emitEvent('incident', cleared.id, 'incident.cleared', {
      incidentId: cleared.id,
      description: cleared.description,
    });
    console.log(`[SimulationEngine] Road incident cleared: ${cleared.id}`);
    return true;
  }

  public getActiveIncidents(): RoadIncident[] {
    return this.incidentManager.getActiveIncidents();
  }

  public async rerouteVehicle(vehicleId: string, options?: RerouteOptions): Promise<RerouteResult> {
    const vehicle = this.world.getVehicle(vehicleId);
    if (!vehicle) {
      return { success: false, message: 'Vehicle not found', vehicleId };
    }

    const departureTime = this.clock.getFormattedTime().slice(0, 5);
    const res = await this.rerouteCoordinator.rerouteVehicle(
      vehicle,
      this.world,
      this.clock.getSimulatedTime(),
      departureTime,
      this.activeRoutingAlgorithm,
      options
    );

    if (res.success) {
      this.benchmarkMetrics.totalQueries += res.queries || 0;
      this.benchmarkMetrics.totalQueryTimeMs += res.queryTimeMs || 0;
      this.benchmarkMetrics.totalNodesVisited += res.nodesVisited || 0;

      this.emitEvent('vehicle', vehicle.id, 'vehicle.rerouted', {
        vehicleId: vehicle.id,
        reason: vehicle.rerouteReason,
        oldRemainingDistanceM: res.oldRemainingDistanceM,
        newDistanceM: res.newDistanceM,
        newDurationS: res.newDurationS,
        rerouteCount: vehicle.rerouteCount,
        avoidedIncident: res.avoidedIncidentId,
      });

      console.log(
        `[SimulationEngine] In-flight re-routed ${vehicle.id} (${vehicle.rerouteReason}): oldRem=${((res.oldRemainingDistanceM || 0) / 1000).toFixed(2)}km -> new=${((res.newDistanceM || 0) / 1000).toFixed(2)}km`
      );
    }

    return res;
  }

  public async rerouteEnRouteFleet(
    reason: string = 'fleet_traffic_optimization',
    avoidIncidents: boolean = true
  ): Promise<{ reroutedCount: number; vehicles: string[] }> {
    const enRoute = this.world
      .getAllVehicles()
      .filter((v) => v.status === 'en_route' || v.status === 'returning');

    if (enRoute.length === 0) {
      return { reroutedCount: 0, vehicles: [] };
    }

    const res = await this.rerouteCoordinator.rerouteFleet(
      enRoute,
      this.world,
      this.clock.getSimulatedTime(),
      this.clock.getFormattedTime().slice(0, 5),
      this.activeRoutingAlgorithm,
      { reason, avoidIncidents }
    );

    this.benchmarkMetrics.totalQueries += res.totalQueries;
    this.benchmarkMetrics.totalQueryTimeMs += res.totalQueryTimeMs;
    this.benchmarkMetrics.totalNodesVisited += res.totalNodesVisited;

    this.emitEvent('simulation', this.simulationId, 'fleet.rerouted', {
      reason,
      totalEnRoute: enRoute.length,
      reroutedCount: res.reroutedCount,
      vehicles: res.vehicles,
    });

    console.log(`[SimulationEngine] Fleet in-flight re-routing completed: ${res.reroutedCount}/${enRoute.length} vehicles re-routed.`);
    return { reroutedCount: res.reroutedCount, vehicles: res.vehicles };
  }

  public injectEvent(event: {
    type: string;
    targetId?: string;
    payload?: Record<string, unknown>;
  }): {
    success: boolean;
    message: string;
    incident?: RoadIncident;
    order?: Order;
    vehicle?: Vehicle;
    affectedVehiclesCount?: number;
  } {
    return this.eventInjector.injectEvent(event);
  }

  public async injectEventAsync(event: {
    type: string;
    targetId?: string;
    payload?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    message: string;
    incident?: RoadIncident;
    order?: Order;
    vehicle?: Vehicle;
    affectedVehiclesCount?: number;
  }> {
    if (event.type === 'inject_order' || event.type === 'order.injected' || event.type === 'order.create') {
      const payload = (event.payload || {}) as any;
      const res = await this.injectCustomOrder(payload);
      this.emitEvent('order', res.order?.id || 'manual', 'order.injected', res);
      return { success: res.success, order: res.order, message: res.message || 'Express delivery order injected.' };
    }
    return this.injectEvent(event);
  }

  public getDeliveryPresets(): DeliveryCorridorPreset[] {
    return DELIVERY_CORRIDOR_PRESETS;
  }

  public async injectCustomOrder(options: CustomOrderOptions): Promise<{
    success: boolean;
    order?: Order;
    assignedVehicleId?: string | null;
    message: string;
    ecommerceSynced?: boolean;
  }> {
    return this.eventInjector.injectCustomOrder(options);
  }
}
