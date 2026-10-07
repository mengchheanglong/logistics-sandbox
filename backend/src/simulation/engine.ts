/**
 * @fileoverview SimulationEngine drives the core simulation loop.
 *
 * Each tick:
 * 1. Advance the simulation clock
 * 2. Generate new orders (if below target count)
 * 3. Dispatch pending orders to idle vehicles
 * 4. Move vehicles along their route geometry
 * 5. Check for delivery completion
 * 6. Emit domain events
 *
 * The engine is the single source of truth for the simulation world.
 * The frontend observes this state — it never drives it.
 */

import { SimulationClock } from './clock.js';
import { World } from '../world/world.js';
import { EventBus } from '../events/event-bus.js';
import { Dispatcher, AssignmentResult } from '../dispatch/dispatcher.js';
import { RoutingClient } from '../routing/client.js';
import { defaultScenario } from '../scenarios/default.js';
import { SimulationState, SimulationEvent, Vehicle } from '../world/types.js';
import { interpolateAlongPath } from '../utils/geo.js';
import { v4 as uuidv4 } from 'uuid';

export class SimulationEngine {
  public clock: SimulationClock;
  public world: World;
  public eventBus: EventBus;
  public dispatcher: Dispatcher;
  public routingClient: RoutingClient;

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

  /** Pending dispatch queue — orders waiting for route calculation */
  private dispatchQueue: string[] = [];
  /** Whether a dispatch operation is currently in progress */
  private dispatching: boolean = false;

  constructor() {
    this.simulationId = uuidv4();
    this.clock = new SimulationClock();
    this.eventBus = new EventBus();
    this.world = new World(defaultScenario);
    this.dispatcher = new Dispatcher();
    this.routingClient = new RoutingClient();

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

    // 1. Advance simulation clock
    this.clock.tick(deltaMs);
    const simTime = this.clock.getSimulatedTime();

    // 2. Generate orders
    this.generateOrders(simTime);

    // 3. Dispatch pending orders (async, non-blocking)
    this.dispatchPendingOrders();

    // 4. Move vehicles along their routes
    this.updateVehicles(simTime, deltaMs);
  }

  /**
   * Generate new orders at a steady rate based on the scenario config.
   */
  private generateOrders(simTime: number): void {
    if (this.ordersGenerated >= this.targetOrderCount) return;

    // Generate orders at the configured rate
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
   * Routing calls are async, so we process one at a time.
   */
  private dispatchPendingOrders(): void {
    if (this.dispatching || this.dispatchQueue.length === 0) return;

    const orderId = this.dispatchQueue[0];
    const order = this.world.getOrder(orderId);
    if (!order || order.status !== 'pending') {
      this.dispatchQueue.shift();
      return;
    }

    const idleVehicles = this.world.getIdleVehicles();
    if (idleVehicles.length === 0) return;

    this.dispatching = true;

    this.dispatcher
      .assignOrder(order, idleVehicles, this.routingClient)
      .then((result: AssignmentResult | null) => {
        if (result) {
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

            this.emitEvent('order', order.id, 'order.assigned', {
              vehicleId: vehicle.id,
              algorithm: result.route.algorithm,
              distanceM: result.route.distanceM,
              durationS: result.route.durationS,
            });

            this.emitEvent('vehicle', vehicle.id, 'vehicle.dispatched', {
              orderId: order.id,
              routePoints: result.route.path.length,
              distanceM: result.route.distanceM,
            });
          }
          this.dispatchQueue.shift();
        }
        // If no assignment possible, leave in queue for next tick
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
   *
   * The vehicle's routeProgress (0–1) is incremented based on the elapsed
   * simulation time relative to the route's estimated duration.
   */
  private advanceVehicle(vehicle: Vehicle, deltaRealMs: number): void {
    if (vehicle.routeGeometry.length < 2 || vehicle.routeDurationS <= 0) {
      // No valid route — complete immediately
      this.completeVehicleRoute(vehicle);
      return;
    }

    // Calculate how much sim time elapsed this tick
    const deltaSimMs = deltaRealMs * this.clock.speed * 60; // SIM_TIME_RATIO = 60
    const deltaSimS = deltaSimMs / 1000;

    // Progress increment = elapsed sim seconds / total route duration
    const progressIncrement = deltaSimS / vehicle.routeDurationS;
    vehicle.routeProgress = Math.min(1, vehicle.routeProgress + progressIncrement);

    // Interpolate position along the route polyline
    const newPosition = interpolateAlongPath(vehicle.routeGeometry, vehicle.routeProgress);
    vehicle.position = newPosition;

    // Estimate current speed from route distance and duration
    vehicle.speed_kmh = (vehicle.routeDistanceM / vehicle.routeDurationS) * 3.6;

    // Emit position update event (throttled — every ~10 ticks)
    if (Math.random() < 0.1) {
      this.emitEvent('vehicle', vehicle.id, 'vehicle.position.updated', {
        lat: newPosition.lat,
        lon: newPosition.lon,
        progress: vehicle.routeProgress,
        speed_kmh: vehicle.speed_kmh,
      });
    }

    // Check if vehicle reached destination
    if (vehicle.routeProgress >= 1) {
      this.completeVehicleRoute(vehicle);
    }
  }

  /**
   * Handle vehicle arriving at its destination.
   */
  private completeVehicleRoute(vehicle: Vehicle): void {
    const simTime = this.clock.getSimulatedTime();

    if (vehicle.status === 'en_route') {
      // Vehicle arrived at delivery location — mark orders as delivered
      for (const orderId of vehicle.assignedOrderIds) {
        const order = this.world.getOrder(orderId);
        if (order) {
          order.status = 'delivered';
          order.deliveredAt = simTime;

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
        // Request return route
        this.routingClient
          .calculateRoute(vehicle.position, depot.position)
          .then((returnRoute) => {
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
            // On error, just reset to idle at current position
            this.resetVehicleToIdle(vehicle);
          });
      } else {
        this.resetVehicleToIdle(vehicle);
      }
    } else if (vehicle.status === 'returning') {
      // Vehicle arrived back at depot
      this.resetVehicleToIdle(vehicle);
      this.emitEvent('vehicle', vehicle.id, 'vehicle.returned_to_depot', {
        depotId: vehicle.depotId,
      });
    }
  }

  /**
   * Reset a vehicle to idle state.
   */
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
  }

  /**
   * Emit a domain event through the event bus.
   */
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
   * Get the current full simulation state for API/WebSocket consumers.
   */
  public getState(): SimulationState {
    const vehicles = this.world.getAllVehicles();
    const orders = this.world.getAllOrders();

    const deliveredOrders = orders.filter((o) => o.status === 'delivered');
    const pendingOrders = orders.filter((o) => o.status === 'pending');
    const activeVehicles = vehicles.filter(
      (v) => v.status !== 'idle' && v.status !== 'broken_down'
    );

    // Calculate average delivery time
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

    // Calculate total distance
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
      stats: {
        activeVehicles: activeVehicles.length,
        totalOrders: orders.length,
        deliveredOrders: deliveredOrders.length,
        pendingOrders: pendingOrders.length,
        lateOrders: 0, // TODO: implement deadline tracking
        avgDeliveryTimeMin: Math.round(avgDeliveryTimeMin * 10) / 10,
        totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      },
    };
  }

  /**
   * Handle operator-injected events (God's-eye interventions).
   */
  public injectEvent(event: { type: string; targetId?: string; payload?: Record<string, unknown> }): void {
    switch (event.type) {
      case 'vehicle_breakdown': {
        const vehicle = event.targetId ? this.world.getVehicle(event.targetId) : undefined;
        if (vehicle) {
          vehicle.status = 'broken_down';
          vehicle.speed_kmh = 0;
          this.emitEvent('vehicle', vehicle.id, 'vehicle.failed', {
            reason: 'operator_intervention',
          });
        }
        break;
      }
      default:
        console.log(`[SimulationEngine] Unknown injection event type: ${event.type}`);
    }
  }
}
