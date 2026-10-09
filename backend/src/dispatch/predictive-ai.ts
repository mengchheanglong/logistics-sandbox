/**
 * @fileoverview Phase 4: Predictive AI Dispatch & Dynamic Fleet Rebalancer.
 *
 * Implements:
 * 1. Geographic zoning for Phnom Penh districts (Daun Penh, BKK/Chamkarmon, Tuol Kork, Sen Sok, Meanchey).
 * 2. Real-time demand forecasting & courier deficit detection.
 * 3. Anticipatory fleet repositioning (rebalancing surplus idle couriers to deficit staging areas).
 * 4. Dynamic SLA breach risk forecasting for in-transit orders.
 * 5. Multi-factor candidate scoring for predictive order assignment.
 */

import {
  Coordinate,
  DistrictZone,
  DistrictDemandForecast,
  SlaRiskPrediction,
  AiRebalancingAction,
  PredictiveAiMetrics,
  Vehicle,
  Order,
  RoutingAlgorithm,
} from '../world/types.js';
import { World } from '../world/world.js';
import { RoutingClient } from '../routing/client.js';
import { haversineDistance } from '../utils/geo.js';

export const PHNOM_PENH_DISTRICTS: DistrictZone[] = [
  {
    id: 'daun_penh',
    name: 'Daun Penh (Central / Riverside)',
    center: { lat: 11.5723, lon: 104.9252 },
    radiusM: 2200,
    demandWeight: 1.25,
    stagingPoint: { lat: 11.5680, lon: 104.9223 }, // Central Market Depot A area
  },
  {
    id: 'chamkarmon_bkk',
    name: 'Chamkarmon / BKK1',
    center: { lat: 11.5490, lon: 104.9250 },
    radiusM: 2500,
    demandWeight: 1.15,
    stagingPoint: { lat: 11.5435, lon: 104.9142 }, // Russian Market Depot B area
  },
  {
    id: 'tuol_kork',
    name: 'Tuol Kork (Tech & Commercial)',
    center: { lat: 11.5732, lon: 104.8984 },
    radiusM: 2600,
    demandWeight: 0.95,
    stagingPoint: { lat: 11.5710, lon: 104.9010 },
  },
  {
    id: 'sen_sok',
    name: 'Sen Sok (AEON 2 Suburban)',
    center: { lat: 11.5850, lon: 104.8820 },
    radiusM: 3400,
    demandWeight: 0.85,
    stagingPoint: { lat: 11.5820, lon: 104.8850 },
  },
  {
    id: 'meanchey',
    name: 'Meanchey / St 271 Artery',
    center: { lat: 11.5305, lon: 104.9085 },
    radiusM: 3000,
    demandWeight: 0.80,
    stagingPoint: { lat: 11.5350, lon: 104.9120 },
  },
];

export class PredictiveAiEngine {
  private districts: DistrictZone[] = PHNOM_PENH_DISTRICTS;
  private recentRebalances: AiRebalancingAction[] = [];
  private totalRebalancesCount: number = 0;
  private slaBreachesAvertedCount: number = 0;
  private lastRebalanceSimTime: number = 0;
  private readonly REBALANCE_COOLDOWN_SIM_MS = 60 * 1000; // 1 min sim cooldown between rebalancing directives
  private actionCounter: number = 0;

  public reset(): void {
    this.recentRebalances = [];
    this.totalRebalancesCount = 0;
    this.slaBreachesAvertedCount = 0;
    this.lastRebalanceSimTime = 0;
    this.actionCounter = 0;
  }

  /**
   * Determine which district a coordinate belongs to.
   */
  public getDistrictForCoordinate(coord: Coordinate): DistrictZone {
    let closest = this.districts[0];
    let minDistance = Infinity;

    for (const district of this.districts) {
      const d = haversineDistance(coord, district.center);
      if (d < minDistance) {
        minDistance = d;
        closest = district;
      }
    }
    return closest;
  }

  /**
   * Compute real-time demand forecasts and courier equilibrium per district.
   */
  public computeDistrictForecasts(world: World, pendingOrderIds: string[]): DistrictDemandForecast[] {
    const allVehicles = world.getAllVehicles();
    const allOrders = world.getAllOrders();

    return this.districts.map((district) => {
      // 1. Count pending orders originating or destined for this district
      let currentPending = 0;
      for (const orderId of pendingOrderIds) {
        const order = world.getOrder(orderId);
        if (!order || order.status !== 'pending') continue;
        const pickupDist = haversineDistance(order.pickupLocation, district.center);
        const deliveryDist = haversineDistance(order.deliveryLocation, district.center);
        if (pickupDist <= district.radiusM || deliveryDist <= district.radiusM) {
          currentPending++;
        }
      }

      // 2. Count couriers currently located in or heading toward this district
      let idleCouriers = 0;
      let activeCouriers = 0;
      for (const vehicle of allVehicles) {
        const dist = haversineDistance(vehicle.position, district.center);
        if (dist <= district.radiusM) {
          if (vehicle.status === 'idle') idleCouriers++;
          else activeCouriers++;
        }
      }

      // 3. Compute forecasted demand index (weighted by historic density and pending velocity)
      const historicalInflow = allOrders.filter(
        (o) => haversineDistance(o.deliveryLocation, district.center) <= district.radiusM
      ).length;
      const forecastDemand = Math.min(
        100,
        Math.round((currentPending * 12 + (historicalInflow % 20) * 2) * district.demandWeight)
      );

      // 4. Deficit score = required fleet minus available supply
      const requiredCouriers = Math.max(1, Math.ceil(currentPending * 1.2 + forecastDemand / 25));
      const availableSupply = idleCouriers + Math.round(activeCouriers * 0.4);
      const deficitScore = requiredCouriers - availableSupply;

      let status: 'balanced' | 'surplus' | 'deficit' | 'critical' = 'balanced';
      if (deficitScore >= 4) status = 'critical';
      else if (deficitScore >= 1) status = 'deficit';
      else if (deficitScore <= -3) status = 'surplus';

      return {
        districtId: district.id,
        districtName: district.name,
        center: district.center,
        currentPendingOrders: currentPending,
        forecastedDemandIndex: Math.max(10, forecastDemand),
        activeCouriers,
        idleCouriers,
        deficitScore,
        status,
      };
    });
  }

  /**
   * Evaluate in-transit deliveries and predict SLA breach risks before they happen.
   */
  public evaluateSlaBreachRisks(
    world: World,
    currentSimTime: number,
    trafficMultiplier: number = 1.0
  ): SlaRiskPrediction[] {
    const activeVehicles = world.getAllVehicles().filter(
      (v) => (v.status === 'en_route' || v.status === 'delivering') && v.assignedOrderIds.length > 0
    );

    const predictions: SlaRiskPrediction[] = [];

    for (const vehicle of activeVehicles) {
      for (const orderId of vehicle.assignedOrderIds) {
        const order = world.getOrder(orderId);
        if (!order || order.status === 'delivered' || !order.slaDeadline) continue;

        // Calculate estimated remaining travel time based on vehicle route progress & traffic
        const remainingProgress = Math.max(0, 1 - vehicle.routeProgress);
        const remainingDistanceM = vehicle.routeDistanceM * remainingProgress;
        const effectiveSpeedMs = Math.max(2.5, ((vehicle.speed_kmh || 30) / 3.6) / trafficMultiplier);
        const estimatedRemainingSec = remainingDistanceM / effectiveSpeedMs;
        const estimatedArrivalMs = currentSimTime + estimatedRemainingSec * 1000;

        const marginMs = order.slaDeadline - estimatedArrivalMs;
        const marginMinutes = Number((marginMs / (60 * 1000)).toFixed(1));

        // Risk scoring (0 - 100%)
        let riskScore = 0;
        let riskLevel: 'nominal' | 'moderate' | 'high' | 'critical' = 'nominal';
        let recommendedAction: string | undefined;

        if (marginMinutes < 0) {
          riskScore = 100;
          riskLevel = 'critical';
          recommendedAction = 'Imminent breach: Prioritize corridor express override or dynamic avoidance.';
        } else if (marginMinutes < 5) {
          riskScore = Math.min(95, Math.round(75 + (5 - marginMinutes) * 4));
          riskLevel = 'high';
          recommendedAction = 'High risk: Dispatcher recommending zero-delay straight-line bypass.';
        } else if (marginMinutes < 12) {
          riskScore = Math.min(65, Math.round(30 + (12 - marginMinutes) * 4));
          riskLevel = 'moderate';
          recommendedAction = 'Moderate risk: Monitor traffic congestion spikes.';
        } else {
          riskScore = Math.max(5, Math.round(20 - marginMinutes));
          riskLevel = 'nominal';
          recommendedAction = 'Nominal: On schedule.';
        }

        predictions.push({
          orderId: order.id,
          priority: order.priority || 'standard',
          vehicleId: vehicle.id,
          driverId: vehicle.driverId,
          remainingDistanceKm: Number((remainingDistanceM / 1000).toFixed(2)),
          estimatedArrivalMs,
          slaDeadline: order.slaDeadline,
          marginMinutes,
          riskScore,
          riskLevel,
          recommendedAction,
        });
      }
    }

    // Sort by risk descending (highest risk first)
    return predictions.sort((a, b) => b.riskScore - a.riskScore);
  }

  /**
   * Multi-factor scoring for candidate vehicles when Predictive AI Dispatch Strategy is chosen.
   */
  public scorePredictiveVehicle(
    order: Order,
    vehicle: Vehicle,
    forecasts: DistrictDemandForecast[]
  ): number {
    // 1. Proximity score (lower distance = better)
    const distanceM = haversineDistance(vehicle.position, order.pickupLocation);
    const distScore = distanceM / 1000; // in km

    // 2. Capacity matching: bonus for vehicle with appropriate capacity
    const capacityRatio = order.totalWeight_kg / (vehicle.capacity_kg || 1);
    const capacityPenalty = (1 - capacityRatio) * 1.5; // slight penalty for huge truck on tiny parcel

    // 3. Destination district deficit score: if delivering order to a deficit district, bonus!
    const destDistrict = this.getDistrictForCoordinate(order.deliveryLocation);
    const districtForecast = forecasts.find((f) => f.districtId === destDistrict.id);
    const deficitBonus = districtForecast && districtForecast.deficitScore > 0
      ? -Math.min(3, districtForecast.deficitScore * 0.8)
      : 0;

    // 4. SLA urgency penalty multiplier
    const priorityWeight = order.priority === 'urgent' ? 1.8 : order.priority === 'express' ? 1.3 : 1.0;

    return (distScore * priorityWeight) + capacityPenalty + deficitBonus;
  }

  /**
   * Plan anticipatory fleet repositioning if courier supply and demand are heavily unbalanced.
   */
  public async planAnticipatoryRebalancing(
    world: World,
    routingClient: RoutingClient,
    routingAlgorithm: RoutingAlgorithm,
    currentSimTime: number,
    pendingOrderIds: string[]
  ): Promise<{ vehicle: Vehicle; action: AiRebalancingAction; path: [number, number][]; distanceM: number; durationS: number } | null> {
    if (currentSimTime - this.lastRebalanceSimTime < this.REBALANCE_COOLDOWN_SIM_MS) {
      return null;
    }

    const forecasts = this.computeDistrictForecasts(world, pendingOrderIds);

    // Find district with greatest deficit
    const deficitDistricts = forecasts
      .filter((f) => f.deficitScore >= 2)
      .sort((a, b) => b.deficitScore - a.deficitScore);

    // Find district with greatest surplus idle couriers
    const surplusDistricts = forecasts
      .filter((f) => f.deficitScore <= -2 && f.idleCouriers >= 2)
      .sort((a, b) => a.deficitScore - b.deficitScore);

    if (deficitDistricts.length === 0 || surplusDistricts.length === 0) {
      return null;
    }

    const targetDeficit = deficitDistricts[0];
    const sourceSurplus = surplusDistricts[0];

    // Find best idle vehicle in surplus district
    const surplusZone = this.districts.find((d) => d.id === sourceSurplus.districtId)!;
    const deficitZone = this.districts.find((d) => d.id === targetDeficit.districtId)!;

    const candidateVehicles = world.getIdleVehicles().filter((v) => {
      const d = haversineDistance(v.position, surplusZone.center);
      return d <= surplusZone.radiusM;
    });

    if (candidateVehicles.length === 0) return null;

    // Pick closest vehicle in surplus zone to the deficit staging point
    candidateVehicles.sort((a, b) => {
      const dA = haversineDistance(a.position, deficitZone.stagingPoint);
      const dB = haversineDistance(b.position, deficitZone.stagingPoint);
      return dA - dB;
    });

    const chosenVehicle = candidateVehicles[0];

    try {
      const route = await routingClient.calculateRoute(
        chosenVehicle.position,
        deficitZone.stagingPoint,
        { algorithm: routingAlgorithm, metric: 'time' }
      );

      this.actionCounter++;
      const actionId = `REBAL-${String(this.actionCounter).padStart(4, '0')}`;
      const action: AiRebalancingAction = {
        id: actionId,
        simTimestamp: currentSimTime,
        vehicleId: chosenVehicle.id,
        fromDistrict: sourceSurplus.districtName,
        toDistrict: targetDeficit.districtName,
        targetPosition: deficitZone.stagingPoint,
        reason: `Deficit balance: ${targetDeficit.districtName} demand spike (+${targetDeficit.deficitScore}) from ${sourceSurplus.districtName}`,
        estimatedArrivalSimTime: currentSimTime + route.durationS * 1000,
      };

      this.lastRebalanceSimTime = currentSimTime;
      this.totalRebalancesCount++;
      this.recentRebalances.unshift(action);
      if (this.recentRebalances.length > 20) this.recentRebalances.pop();

      return {
        vehicle: chosenVehicle,
        action,
        path: route.path,
        distanceM: route.distanceM,
        durationS: route.durationS,
      };
    } catch {
      return null;
    }
  }

  public recordAvertedBreach(): void {
    this.slaBreachesAvertedCount++;
  }

  public recordBreachAverted(): void {
    this.slaBreachesAvertedCount++;
  }

  /**
   * Get aggregated Predictive AI metrics snapshot for state broadcast.
   */
  public getMetrics(world: World, currentSimTime: number, trafficMultiplier: number, pendingOrderIds: string[]): PredictiveAiMetrics {
    const districtForecasts = this.computeDistrictForecasts(world, pendingOrderIds);
    const topAtRiskDeliveries = this.evaluateSlaBreachRisks(world, currentSimTime, trafficMultiplier).slice(0, 8);

    // Calculate dynamic model efficiency based on balanced districts and low high-risk ratios
    const balancedCount = districtForecasts.filter((f) => f.status === 'balanced').length;
    const criticalCount = topAtRiskDeliveries.filter((d) => d.riskLevel === 'critical').length;
    const efficiency = Math.min(
      99,
      Math.max(68, Math.round(75 + balancedCount * 5 - criticalCount * 4 + (this.totalRebalancesCount % 10)))
    );

    return {
      activeRebalancingActions: this.recentRebalances.filter(
        (r) => r.estimatedArrivalSimTime > currentSimTime
      ).length,
      totalRebalancesExecuted: this.totalRebalancesCount,
      slaBreachRiskAvertedCount: this.slaBreachesAvertedCount,
      districtForecasts,
      topAtRiskDeliveries,
      recentRebalancingActions: this.recentRebalances.slice(0, 8),
      modelEfficiencyScore: efficiency,
    };
  }
}
