import { DispatchStrategy, Order, RoutingAlgorithm } from '../world/types.js';
import { World } from '../world/world.js';
import { SimulationClock } from './clock.js';
import { Dispatcher, AssignmentResult } from '../dispatch/dispatcher.js';
import { VrpTourSolver } from '../dispatch/vrp.js';
import { RoutingClient, StrictRoutingError } from '../routing/client.js';
import { PredictiveAiEngine } from '../dispatch/predictive-ai.js';
import { IPersistenceLayer } from '../persistence/index.js';
import { OrderPipeline } from './order-pipeline.js';
import { EventEmitFn } from './fleet-advancer.js';

export interface DispatchCoordinatorContext {
  world: World;
  clock: SimulationClock;
  dispatcher: Dispatcher;
  vrpSolver: VrpTourSolver;
  routingClient: RoutingClient;
  predictiveAiEngine: PredictiveAiEngine;
  persistence: IPersistenceLayer;
  orderPipeline: OrderPipeline;
  dispatchQueue: string[];
  emitEvent: EventEmitFn;
  invalidateRun: (reason: string) => void;
  isStrictRouting: () => boolean;
  onBenchmarkUpdate: (queries: number, queryTimeMs: number, nodesVisited: number, ordersAssigned: number) => void;
}

export class DispatchCoordinator {
  private dispatching: boolean = false;

  constructor(private readonly context: DispatchCoordinatorContext) {}

  public isDispatching(): boolean {
    return this.dispatching;
  }

  public async dispatchPendingOrders(
    strategy: DispatchStrategy,
    routingAlgorithm: RoutingAlgorithm
  ): Promise<void> {
    if (this.dispatching || this.context.dispatchQueue.length === 0) return;

    const idleVehicles = this.context.world.getIdleVehicles();
    if (idleVehicles.length === 0) return;

    this.dispatching = true;

    // Multi-stop tour VRP solver strategy
    if (strategy === 'multi_stop_tour') {
      const vehicle = idleVehicles[0];
      const pendingOrders = this.context.dispatchQueue
        .map((id) => this.context.world.getOrder(id))
        .filter((o): o is Order => !!o && o.status === 'pending');

      const depot = this.context.world.getAllWarehouses().find((w) => w.id === vehicle.depotId) || {
        position: vehicle.position,
      };

      try {
        const tour = await this.context.vrpSolver.planTour(
          vehicle,
          pendingOrders,
          depot.position,
          this.context.routingClient,
          routingAlgorithm
        );

        if (tour && tour.legs.length > 0) {
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
          vehicle.trailHistory = [
            [vehicle.position.lon, vehicle.position.lat, this.context.clock.getSimulatedTime()],
          ];

          for (const orderId of tour.orderIds) {
            const order = this.context.world.getOrder(orderId);
            if (order) {
              order.status = 'assigned';
              order.assignedVehicleId = vehicle.id;
              order.assignedAt = this.context.clock.getSimulatedTime();
              this.context.persistence.relationships.syncOrder(order, vehicle.id).catch(() => {});
            }
            const qIndex = this.context.dispatchQueue.indexOf(orderId);
            if (qIndex !== -1) this.context.dispatchQueue.splice(qIndex, 1);
          }

          this.context.onBenchmarkUpdate(
            tour.totalQueries,
            tour.totalQueryTimeMs,
            tour.totalNodesVisited,
            tour.orderIds.length
          );

          this.context.emitEvent('vehicle', vehicle.id, 'vehicle.tour.dispatched', {
            orderCount: tour.orderIds.length,
            totalLegs: tour.legs.length,
            totalDistanceM: tour.totalDistanceM,
            totalDurationS: tour.totalDurationS,
          });
        }
      } catch (err) {
        console.error('[DispatchCoordinator] VRP dispatch error:', err);
      } finally {
        this.dispatching = false;
      }
      return;
    }

    // Standard single-order dispatch
    const orderId = this.context.dispatchQueue[0];
    const order = this.context.world.getOrder(orderId);
    if (!order || order.status !== 'pending') {
      this.context.orderPipeline.dequeueOrder(this.context.dispatchQueue, orderId);
      this.dispatching = false;
      return;
    }

    try {
      const result: AssignmentResult | null = await this.context.dispatcher.assignOrder(
        order,
        idleVehicles,
        this.context.routingClient,
        {
          strategy,
          routingAlgorithm,
          predictiveEngine: this.context.predictiveAiEngine,
          forecasts: this.context.predictiveAiEngine.computeDistrictForecasts(
            this.context.world,
            this.context.dispatchQueue
          ),
        }
      );

      if (result) {
        this.context.onBenchmarkUpdate(
          1,
          result.route.queryTimeMs || 0,
          result.route.nodesVisited || 0,
          1
        );

        const vehicle = this.context.world.getVehicle(result.vehicleId);
        if (vehicle && order.status === 'pending') {
          vehicle.status = 'en_route';
          vehicle.assignedOrderIds = [order.id];
          vehicle.routeGeometry = result.route.path;
          vehicle.routeProgress = 0;
          vehicle.routeDistanceM = result.route.distanceM;
          vehicle.routeDurationS = result.route.durationS > 0 ? result.route.durationS : 60;
          vehicle.currentRouteId = `R-${order.id}`;
          vehicle.currentLoad_kg = order.totalWeight_kg;
          vehicle.trailHistory = [
            [vehicle.position.lon, vehicle.position.lat, this.context.clock.getSimulatedTime()],
          ];

          order.status = 'assigned';
          order.assignedVehicleId = vehicle.id;
          order.assignedAt = this.context.clock.getSimulatedTime();
          order.estimatedDeliveryTime =
            this.context.clock.getSimulatedTime() + result.route.durationS * 1000;

          this.context.persistence.relationships.syncOrder(order, vehicle.id).catch(() => {});

          this.context.emitEvent('order', order.id, 'order.assigned', {
            vehicleId: vehicle.id,
            algorithm: result.route.algorithm,
            strategy: result.strategyUsed,
            distanceM: result.route.distanceM,
            durationS: result.route.durationS,
            nodesVisited: result.route.nodesVisited,
            queryTimeMs: result.route.queryTimeMs,
          });

          this.context.emitEvent('vehicle', vehicle.id, 'vehicle.dispatched', {
            orderId: order.id,
            routePoints: result.route.path.length,
            distanceM: result.route.distanceM,
          });
        }
        this.context.orderPipeline.dequeueOrder(this.context.dispatchQueue, order.id);
      }
    } catch (err) {
      console.error('[DispatchCoordinator] Dispatch error:', err);
      if (this.context.isStrictRouting() || err instanceof StrictRoutingError) {
        this.context.invalidateRun((err as Error).message);
      }
    } finally {
      this.dispatching = false;
    }
  }
}
