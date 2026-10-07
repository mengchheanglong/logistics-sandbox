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
import { defaultScenario } from '../scenarios/default.js';
import {
  SimulationState,
  SimulationEvent,
  Vehicle,
  Order,
  RoutingAlgorithm,
  DispatchStrategy,
  AlgorithmBenchmarkStats,
} from '../world/types.js';
import { interpolateAlongPath, randomPointInBounds } from '../utils/geo.js';
import { v4 as uuidv4 } from 'uuid';

export class SimulationEngine {
  public clock: SimulationClock;
  public world: World;
  public eventBus: EventBus;
  public dispatcher: Dispatcher;
  public vrpSolver: VrpTourSolver;
  public routingClient: RoutingClient;
  public ecommerceClient: EcommerceClient;

  private simulationId: string;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly TICK_RATE_MS = 100;
  private lastTickTime: number = 0;

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

  constructor() {
    this.simulationId = uuidv4();
    this.clock = new SimulationClock();
    this.eventBus = new EventBus();
    this.world = new World(defaultScenario);
    this.dispatcher = new Dispatcher();
    this.vrpSolver = new VrpTourSolver();
    this.routingClient = new RoutingClient();
    this.ecommerceClient = new EcommerceClient();

    this.targetOrderCount = defaultScenario.orderCount;
    // Spread order generation across the simulation duration
    const durationMs = defaultScenario.duration_hours * 60 * 60 * 1000;
    this.orderGenerationIntervalMs = durationMs / this.targetOrderCount;

    console.log(
      `[SimulationEngine] Created simulation ${this.simulationId}`,
      `| ${defaultScenario.vehicleCount} vehicles`,
      `| ${defaultScenario.orderCount} target orders`,
      `| ${defaultScenario.duration_hours}h duration`
    );
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
      } else {
        console.log('[SimulationEngine] Upstream ecommerce-hive-nosql marketplace standby (not reachable on port 4000)');
      }
    });

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
    const depots = this.world.getAllWarehouses();
    const depot = depots.length > 0 ? depots[0] : { position: { lat: 11.568, lon: 104.922 } };

    // Calculate delivery coordinate inside scenario bounds
    const deliveryLocation = randomPointInBounds(this.world.getConfig().bounds, {
      nextFloat: (min, max) => min + Math.random() * (max - min),
    });

    const totalWeight = (eOrder.items || []).reduce((acc, item) => acc + (item.quantity || 1) * 2, 5);

    const order: Order = {
      id: eOrder.order_id,
      customerId: eOrder.customer_id || 'C-ECOMMERCE',
      status: 'pending',
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
    this.dispatchQueue.push(order.id);
    this.ecommerceClient.recordOrderIngested();

    this.emitEvent('order', order.id, 'order.created', {
      source: 'ecommerce-hive-nosql',
      customerName: eOrder.customer_name,
      totalAmount: eOrder.total,
      deliveryAddress: eOrder.delivery_address,
      itemsCount: (eOrder.items || []).length,
    });

    console.log(`[SimulationEngine] Ingested marketplace order: ${order.id} for ${eOrder.customer_name}`);
    return order;
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

      this.emitEvent('order', order.id, 'order.created', {
        customerId: order.customerId,
        totalWeight_kg: order.totalWeight_kg,
        pickupLocation: order.pickupLocation,
        deliveryLocation: order.deliveryLocation,
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

            // Mark all tour orders as assigned
            for (const orderId of tour.orderIds) {
              const order = this.world.getOrder(orderId);
              if (order) {
                order.status = 'assigned';
                order.assignedVehicleId = vehicle.id;
                order.assignedAt = this.clock.getSimulatedTime();
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
            vehicle.routeDurationS = result.route.durationS;
            vehicle.currentRouteId = `R-${order.id}`;
            vehicle.currentLoad_kg = order.totalWeight_kg;

            // Update order state
            order.status = 'assigned';
            order.assignedVehicleId = vehicle.id;
            order.assignedAt = this.clock.getSimulatedTime();
            order.estimatedDeliveryTime =
              this.clock.getSimulatedTime() + result.route.durationS * 1000;

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

    // Emit position update event & stream Cassandra ping to ecommerce-hive-nosql (throttled)
    if (Math.random() < 0.1) {
      this.emitEvent('vehicle', vehicle.id, 'vehicle.position.updated', {
        lat: newPosition.lat,
        lon: newPosition.lon,
        progress: vehicle.routeProgress,
        speed_kmh: vehicle.speed_kmh,
      });

      // Stream GPS ping to Cassandra via upstream ecommerce API
      this.ecommerceClient.sendRiderPing(vehicle.driverId, newPosition, vehicle.speed_kmh);
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

    const totalDistanceKm = vehicles.reduce((sum, v) => {
      if (v.routeDistanceM > 0 && v.routeProgress > 0) {
        return sum + (v.routeDistanceM * v.routeProgress) / 1000;
      }
      return sum;
    }, 0);

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
      trafficMultiplier: this.trafficMultiplier,
      benchmarkStats: this.getBenchmarkStats(),
      stats: {
        activeVehicles: activeVehicles.length,
        totalOrders: orders.length,
        deliveredOrders: deliveredOrders.length,
        pendingOrders: pendingOrders.length,
        lateOrders: 0,
        avgDeliveryTimeMin: Math.round(avgDeliveryTimeMin * 10) / 10,
        totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
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

  public injectEvent(event: { type: string; targetId?: string; payload?: Record<string, unknown> }): { success: boolean; message: string } {
    switch (event.type) {
      case 'vehicle_breakdown': {
        const vehicle = event.targetId ? this.world.getVehicle(event.targetId) : undefined;
        if (!vehicle) return { success: false, message: 'Vehicle not found' };

        vehicle.status = 'broken_down';
        vehicle.speed_kmh = 0;

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
        }
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
        return { success: true, message: `Traffic congestion set to ${factor.toFixed(1)}x slowdown.` };
      }

      default:
        console.log(`[SimulationEngine] Unknown injection event type: ${event.type}`);
        return { success: false, message: `Unknown event type: ${event.type}` };
    }
  }
}
