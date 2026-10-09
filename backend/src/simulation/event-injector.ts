import {
  Coordinate,
  Order,
  OrderItem,
  OrderPriority,
  RoadIncident,
  RoutingAlgorithm,
  Vehicle,
} from '../world/types.js';
import { World } from '../world/world.js';
import { SimulationClock } from './clock.js';
import { IPersistenceLayer } from '../persistence/index.js';
import { IncidentManager } from './incident-manager.js';
import { RerouteCoordinator } from './reroute-coordinator.js';
import { FleetAdvancer, EventEmitFn } from './fleet-advancer.js';
import { OrderPipeline } from './order-pipeline.js';
import { DELIVERY_CORRIDOR_PRESETS } from './corridors.js';

export interface EventInjectionPayload {
  type: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}

export interface EventInjectionResult {
  success: boolean;
  message: string;
  incident?: RoadIncident;
  order?: Order;
  vehicle?: Vehicle;
  affectedVehiclesCount?: number;
}

export interface CustomOrderOptions {
  presetId?: string;
  pickupLocation?: Coordinate;
  deliveryLocation?: Coordinate;
  customerName?: string;
  priority?: OrderPriority;
  slaDurationMin?: number;
  items?: OrderItem[];
  totalWeight_kg?: number;
}

export interface EventInjectorContext {
  world: World;
  clock: SimulationClock;
  persistence: IPersistenceLayer;
  incidentManager: IncidentManager;
  rerouteCoordinator: RerouteCoordinator;
  fleetAdvancer: FleetAdvancer;
  orderPipeline: OrderPipeline;
  dispatchQueue: string[];
  simulationId: string;
  activeRoutingAlgorithm: RoutingAlgorithm;
  emitEvent: EventEmitFn;
  dispatchPendingOrders: () => Promise<void> | void;
  setTrafficMultiplier: (multiplier: number) => void;
  onBenchmarkQueries?: (queries: number, queryTimeMs: number, nodesVisited: number) => void;
}

export class EventInjector {
  constructor(private readonly context: EventInjectorContext) {}

  public injectEvent(event: EventInjectionPayload): EventInjectionResult {
    const { world, clock, persistence, incidentManager, rerouteCoordinator, fleetAdvancer, orderPipeline, dispatchQueue, simulationId, activeRoutingAlgorithm, emitEvent, setTrafficMultiplier, onBenchmarkQueries } = this.context;

    switch (event.type) {
      case 'vehicle_breakdown':
      case 'vehicle.broken_down':
      case 'vehicle.failed': {
        const vehicle = event.targetId ? world.getVehicle(event.targetId) : undefined;
        if (!vehicle) return { success: false, message: 'Vehicle not found' };

        vehicle.status = 'broken_down';
        vehicle.speed_kmh = 0;

        persistence.relationships.updateVehicleStatus(vehicle.id, 'broken_down', vehicle.position).catch(() => {});
        persistence.relationships.getImpactAnalysis('vehicle', vehicle.id).then((impact) => {
          emitEvent('incident', vehicle.id, 'incident.impact_analyzed', {
            impact,
            source: 'neo4j_relationship_graph',
          });
        }).catch(() => {});

        let reallocated = 0;
        if (vehicle.assignedOrderIds.length > 0) {
          for (const orderId of vehicle.assignedOrderIds) {
            const order = world.getOrder(orderId);
            if (order && order.status !== 'delivered') {
              order.status = 'pending';
              order.assignedVehicleId = null;
              dispatchQueue.unshift(order.id);
              reallocated++;
            }
          }
          vehicle.assignedOrderIds = [];
        }

        emitEvent('vehicle', vehicle.id, 'vehicle.failed', {
          reason: 'operator_intervention',
          reallocatedOrders: reallocated,
        });
        return { success: true, message: `Vehicle ${vehicle.id} broke down. ${reallocated} orders returned to queue.`, vehicle };
      }

      case 'vehicle_recover':
      case 'vehicle.recovered': {
        const vehicle = event.targetId ? world.getVehicle(event.targetId) : undefined;
        if (!vehicle) return { success: false, message: 'Vehicle not found' };

        fleetAdvancer.resetVehicleToIdle(vehicle);
        persistence.relationships.updateVehicleStatus(vehicle.id, 'idle', vehicle.position).catch(() => {});
        emitEvent('vehicle', vehicle.id, 'vehicle.recovered', {
          reason: 'operator_intervention',
        });
        return { success: true, message: `Vehicle ${vehicle.id} repaired and back in service.`, vehicle };
      }

      case 'depot_closure':
      case 'depot.closed': {
        const depotId = event.targetId;
        const depot = world.getAllWarehouses().find((w) => w.id === depotId);
        if (!depot) return { success: false, message: 'Depot not found' };

        depot.status = 'closed';

        persistence.relationships.getImpactAnalysis('depot', depot.id).then((impact) => {
          emitEvent('incident', depot.id, 'incident.impact_analyzed', {
            impact,
            source: 'neo4j_relationship_graph',
          });
        }).catch(() => {});

        const openDepot = world.getAllWarehouses().find((w) => w.id !== depotId && w.status !== 'closed');
        let rehomed = 0;
        if (openDepot) {
          for (const v of world.getAllVehicles()) {
            if (v.depotId === depotId && v.status === 'idle') {
              v.depotId = openDepot.id;
              rehomed++;
            }
          }
        }

        emitEvent('depot', depot.id, 'depot.closed', {
          reason: (event.payload?.reason as string) || 'emergency_flooding',
          rehomedVehicles: rehomed,
        });
        return { success: true, message: `Depot ${depot.name} (${depot.id}) closed. ${rehomed} vehicles transferred.` };
      }

      case 'depot_reopen':
      case 'depot.reopened': {
        const depotId = event.targetId;
        const depot = world.getAllWarehouses().find((w) => w.id === depotId);
        if (!depot) return { success: false, message: 'Depot not found' };

        depot.status = 'open';
        emitEvent('depot', depot.id, 'depot.reopened', {});
        return { success: true, message: `Depot ${depot.name} reopened.` };
      }

      case 'demand_spike': {
        const count = Number(event.payload?.count) || 20;
        const simTime = clock.getSimulatedTime();
        for (let i = 0; i < count; i++) {
          const order = world.generateOrder(simTime);
          orderPipeline.incrementOrdersGenerated(1);
          dispatchQueue.push(order.id);
          persistence.orders.saveOrder(order).catch(() => {});
        }
        orderPipeline.sortDispatchQueueByEDF(dispatchQueue, world);
        emitEvent('simulation', simulationId, 'demand.spike', {
          ordersInjected: count,
        });
        return { success: true, message: `Demand spike: injected ${count} urgent orders.` };
      }

      case 'traffic_congestion': {
        const factor = Number(event.payload?.multiplier) || 2.0;
        setTrafficMultiplier(factor);
        emitEvent('traffic', 'city_network', 'traffic.changed', {
          multiplier: factor,
        });
        if (event.payload?.autoReroute) {
          rerouteCoordinator
            .rerouteFleet(
              world.getAllVehicles(),
              world,
              clock.getSimulatedTime(),
              clock.getFormattedTime().slice(0, 5),
              activeRoutingAlgorithm,
              { reason: `traffic_congestion_${factor}x`, avoidIncidents: true }
            )
            .then((res) => {
              if (onBenchmarkQueries) onBenchmarkQueries(res.totalQueries, res.totalQueryTimeMs, res.totalNodesVisited);
            })
            .catch(console.error);
        }
        return { success: true, message: `Traffic congestion set to ${factor.toFixed(1)}x slowdown.` };
      }

      case 'road_incident':
      case 'incident.create':
      case 'incident.created': {
        const payload = event.payload || {};
        const pos = (payload.center as Coordinate) || (payload.position as Coordinate) || { lat: 11.5564, lon: 104.9282 };
        const incident = incidentManager.createIncident({
          type: (payload.type as any) || (payload.incidentType as any) || 'accident',
          description: (payload.description as string) || 'Road Incident Blockade',
          position: pos,
          radiusM: Number(payload.radiusM) || 500,
          severity: (payload.severity as any) || 'high',
          autoRerouteAffected: payload.autoReroute !== false,
        }, clock.getSimulatedTime());

        emitEvent('incident', incident.id, 'incident.created', {
          type: incident.type,
          description: incident.description,
          position: incident.position,
          radiusM: incident.radiusM,
          severity: incident.severity,
        });

        const affected = incidentManager.getAffectedVehicles(world.getAllVehicles(), incident);
        if (payload.autoReroute !== false && affected.length > 0) {
          for (const vehicle of affected) {
            rerouteCoordinator
              .rerouteVehicle(vehicle, world, clock.getSimulatedTime(), clock.getFormattedTime().slice(0, 5), activeRoutingAlgorithm, {
                reason: `hazard_avoidance_${incident.type}`,
                avoidIncidents: true,
              })
              .then((res) => {
                if (res.success && onBenchmarkQueries) {
                  onBenchmarkQueries(res.queries || 0, res.queryTimeMs || 0, res.nodesVisited || 0);
                }
              })
              .catch((err) => {
                console.warn(`[SimulationEngine] Auto-reroute failed for ${vehicle.id}:`, (err as Error).message);
              });
          }
        }

        return { success: true, incident, message: `Road incident created: "${incident.description}" (Radius: ${incident.radiusM}m).` };
      }

      case 'clear_incident':
      case 'incident.clear':
      case 'incident.cleared': {
        const incidentId = event.targetId || (event.payload?.incidentId as string);
        if (!incidentId) return { success: false, message: 'Incident ID required.' };
        const cleared = incidentManager.clearIncident(incidentId);
        if (cleared) {
          emitEvent('incident', cleared.id, 'incident.cleared', {
            incidentId: cleared.id,
            description: cleared.description,
          });
          return { success: true, message: `Incident ${incidentId} cleared.` };
        }
        return { success: false, message: 'Incident not found or already inactive.' };
      }

      case 'reroute_vehicle': {
        if (!event.targetId) return { success: false, message: 'Target vehicle ID required.' };
        const vehicle = world.getVehicle(event.targetId);
        if (!vehicle) return { success: false, message: 'Vehicle not found.' };
        const reason = (event.payload?.reason as string) || 'operator_command';
        rerouteCoordinator
          .rerouteVehicle(vehicle, world, clock.getSimulatedTime(), clock.getFormattedTime().slice(0, 5), activeRoutingAlgorithm, {
            reason,
            avoidIncidents: true,
          })
          .then((res) => {
            if (res.success && onBenchmarkQueries) {
              onBenchmarkQueries(res.queries || 0, res.queryTimeMs || 0, res.nodesVisited || 0);
            }
          })
          .catch(console.error);
        return { success: true, message: `In-flight re-route requested for vehicle ${event.targetId}.` };
      }

      case 'reroute_fleet': {
        const reason = (event.payload?.reason as string) || 'operator_fleet_command';
        rerouteCoordinator
          .rerouteFleet(
            world.getAllVehicles(),
            world,
            clock.getSimulatedTime(),
            clock.getFormattedTime().slice(0, 5),
            activeRoutingAlgorithm,
            { reason, avoidIncidents: true }
          )
          .then((res) => {
            if (onBenchmarkQueries) onBenchmarkQueries(res.totalQueries, res.totalQueryTimeMs, res.totalNodesVisited);
          })
          .catch(console.error);
        return { success: true, message: 'Fleet-wide in-flight re-route triggered.' };
      }

      case 'inject_order':
      case 'order.injected':
      case 'order.create': {
        const payload = (event.payload || {}) as any;
        this.injectCustomOrder(payload).then((res) => {
          emitEvent('order', res.order?.id || 'manual', 'order.injected', res);
        }).catch(console.error);
        return { success: true, message: 'Express delivery order injected.' };
      }

      default:
        console.log(`[SimulationEngine] Unknown injection event type: ${event.type}`);
        return { success: false, message: `Unknown event type: ${event.type}` };
    }
  }

  public async injectCustomOrder(options: CustomOrderOptions): Promise<{
    success: boolean;
    order?: Order;
    assignedVehicleId?: string | null;
    message: string;
    ecommerceSynced?: boolean;
  }> {
    const { world, clock, persistence, orderPipeline, dispatchQueue, emitEvent, dispatchPendingOrders } = this.context;
    const simTime = clock.getSimulatedTime();
    let pickupLocation = options.pickupLocation;
    let deliveryLocation = options.deliveryLocation;
    let customerName = options.customerName;
    let priority = options.priority;

    if (options.presetId) {
      const preset = DELIVERY_CORRIDOR_PRESETS.find((p) => p.id === options.presetId);
      if (preset) {
        pickupLocation = pickupLocation || preset.pickup.position;
        deliveryLocation = deliveryLocation || preset.delivery.position;
        customerName = customerName || `${preset.name} Customer`;
        priority = priority || preset.suggestedPriority;
      }
    }

    if (!pickupLocation) {
      const defaultDepot = world.getAllWarehouses()[0];
      pickupLocation = defaultDepot?.position || { lat: 11.568, lon: 104.9223 };
    }

    if (!deliveryLocation) {
      deliveryLocation = { lat: 11.5528, lon: 104.9282 };
    }

    const order = world.createCustomOrder({
      pickupLocation,
      deliveryLocation,
      customerName,
      priority: priority || 'express',
      slaDurationMin: options.slaDurationMin,
      items: options.items,
      totalWeight_kg: options.totalWeight_kg,
      simTimestamp: simTime,
    });

    orderPipeline.incrementOrdersGenerated(1);

    if (order.priority === 'urgent' || order.priority === 'express') {
      dispatchQueue.unshift(order.id);
    } else {
      dispatchQueue.push(order.id);
    }

    orderPipeline.sortDispatchQueueByEDF(dispatchQueue, world);
    persistence.orders.saveOrder(order).catch(() => {});

    emitEvent('order', order.id, 'order.created', {
      orderId: order.id,
      customerId: order.customerId,
      customerName: world.getCustomer(order.customerId)?.name,
      pickupLocation: order.pickupLocation,
      deliveryLocation: order.deliveryLocation,
      priority: order.priority,
      slaDeadline: order.slaDeadline,
      slaDurationMin: order.slaDurationMin,
      itemsCount: order.items.length,
      source: 'operator_injection',
    });

    await dispatchPendingOrders();

    const assignedVehicle = order.assignedVehicleId ? world.getVehicle(order.assignedVehicleId) : null;
    const msg = assignedVehicle
      ? `Order ${order.id} (${(order.priority || 'standard').toUpperCase()}) dispatched to ${assignedVehicle.name} (${assignedVehicle.driverName})!`
      : `Order ${order.id} (${(order.priority || 'standard').toUpperCase()}) queued for next available courier.`;

    return {
      success: true,
      order,
      assignedVehicleId: order.assignedVehicleId,
      message: msg,
      ecommerceSynced: false,
    };
  }
}
