import {
  AlgorithmBenchmarkStats,
  RoutingAlgorithm,
  DispatchStrategy,
  SimulationState,
  Vehicle,
  Order,
} from '../world/types.js';
import { World } from '../world/world.js';
import { SimulationClock } from './clock.js';
import { MarketplaceReadAdapter } from '../integrations/ecommerce.js';
import { IPersistenceLayer } from '../persistence/index.js';
import { IncidentManager } from './incident-manager.js';
import { PredictiveAiEngine } from '../dispatch/predictive-ai.js';
import { ChaosEngine } from './chaos-engine.js';
import { GraphProvenance } from '../routing/client.js';

export interface BenchmarkMetricsRaw {
  totalQueries: number;
  totalQueryTimeMs: number;
  totalNodesVisited: number;
  totalOrdersAssigned: number;
}

export interface StateBuilderContext {
  simulationId: string;
  clock: SimulationClock;
  world: World;
  ecommerceClient: MarketplaceReadAdapter;
  persistence: IPersistenceLayer;
  incidentManager: IncidentManager;
  predictiveAiEngine: PredictiveAiEngine;
  chaosEngine: ChaosEngine;
  dispatchQueue: string[];
  trafficMultiplier: number;
  activeScenarioId: string;
  activeRoutingAlgorithm: RoutingAlgorithm;
  activeDispatchStrategy: DispatchStrategy;
  strictRouting: boolean;
  requireRealGraph: boolean;
  cachedProvenance?: GraphProvenance;
  invalidationReason?: string;
  cumulativeDistanceKm: number;
  benchmarkMetrics: BenchmarkMetricsRaw;
  getStatus: () => 'running' | 'paused' | 'stopped' | 'invalidated';
}

export class SimulationStateBuilder {
  public static buildBenchmarkStats(
    metrics: BenchmarkMetricsRaw,
    vehicles: Vehicle[],
    routingAlgorithm: RoutingAlgorithm,
    dispatchStrategy: DispatchStrategy
  ): AlgorithmBenchmarkStats {
    const totalQueries = Math.max(1, metrics.totalQueries);
    const avgQueryTimeMs = Math.round((metrics.totalQueryTimeMs / totalQueries) * 1000) / 1000;
    const avgNodesVisited = Math.round((metrics.totalNodesVisited / totalQueries) * 10) / 10;
    const totalDistanceDrivenKm = vehicles.reduce(
      (sum, v) => sum + (v.routeDistanceM * v.routeProgress) / 1000,
      0
    );

    return {
      routingAlgorithm,
      dispatchStrategy,
      totalQueries: metrics.totalQueries,
      totalQueryTimeMs: Math.round(metrics.totalQueryTimeMs * 100) / 100,
      avgQueryTimeMs,
      totalNodesVisited: metrics.totalNodesVisited,
      avgNodesVisited,
      totalDistanceDrivenKm: Math.round(totalDistanceDrivenKm * 10) / 10,
      totalOrdersAssigned: metrics.totalOrdersAssigned,
    };
  }

  public static buildState(ctx: StateBuilderContext): SimulationState {
    const vehicles = ctx.world.getAllVehicles();
    const orders = ctx.world.getAllOrders();

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
    const totalDistanceKm = ctx.cumulativeDistanceKm + activeDistanceKm;

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
    const predictiveMetrics = ctx.predictiveAiEngine.getMetrics(
      ctx.world,
      ctx.clock.getSimulatedTime(),
      ctx.trafficMultiplier,
      ctx.dispatchQueue
    );

    const benchmarkStats = this.buildBenchmarkStats(
      ctx.benchmarkMetrics,
      vehicles,
      ctx.activeRoutingAlgorithm,
      ctx.activeDispatchStrategy
    );

    return {
      simulationId: ctx.simulationId,
      simTime: ctx.clock.getSimulatedTime(),
      speed: ctx.clock.speed,
      status: ctx.getStatus(),
      vehicles,
      orders,
      warehouses: ctx.world.getAllWarehouses(),
      ecommerceBridge: ctx.ecommerceClient.getStatus(),
      persistence: ctx.persistence.getStatus(),
      trafficMultiplier: ctx.trafficMultiplier,
      benchmarkStats,
      incidents: ctx.incidentManager.getActiveIncidents(),
      activeScenarioId: ctx.activeScenarioId,
      predictiveAi: predictiveMetrics,
      chaosMode: ctx.chaosEngine.getMode(),
      chaosActiveEventsCount: ctx.chaosEngine.getActiveEvents().length,
      strictRouting: ctx.strictRouting,
      requireRealGraph: ctx.requireRealGraph,
      invalidationReason: ctx.invalidationReason,
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
        aiRebalancesCount: predictiveMetrics.totalRebalancesExecuted,
        slaBreachesAverted: predictiveMetrics.slaBreachRiskAvertedCount,
      },
    };
  }
}
