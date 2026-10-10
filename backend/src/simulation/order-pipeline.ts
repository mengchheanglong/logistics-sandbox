import { Coordinate, Order, OrderPriority, OPERATIONAL_FACILITIES } from '../world/types.js';
import { World } from '../world/world.js';
import { IPersistenceLayer } from '../persistence/index.js';
import { EcommerceOrder, MarketplaceReadAdapter, FALLBACK_CAMBODIA_CATALOG } from '../integrations/ecommerce.js';
import { randomPointInBounds } from '../utils/geo.js';

export class OrderPipeline {
  private ordersGenerated: number = 0;
  private targetOrderCount: number = 0;
  private orderGenerationIntervalMs: number = 0;
  private lastOrderGenTime: number = 0;

  constructor(targetOrderCount: number = 100, durationHours: number = 12) {
    this.configurePacing(targetOrderCount, durationHours);
  }

  public configurePacing(targetOrderCount: number, durationHours: number): void {
    this.targetOrderCount = targetOrderCount;
    this.ordersGenerated = 0;
    this.lastOrderGenTime = 0;
    const durationMs = durationHours * 60 * 60 * 1000;
    this.orderGenerationIntervalMs = durationMs / Math.max(1, targetOrderCount);
  }

  public getOrdersGenerated(): number {
    return this.ordersGenerated;
  }

  public incrementOrdersGenerated(count: number = 1): void {
    this.ordersGenerated += count;
  }

  public resetPacing(targetOrderCount: number, durationHours: number): void {
    this.configurePacing(targetOrderCount, durationHours);
  }

  public dequeueOrder(queue: string[], orderId: string): boolean {
    const idx = queue.indexOf(orderId);
    if (idx !== -1) {
      queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  public sortDispatchQueueByEDF(queue: string[], world: World): void {
    queue.sort((idA, idB) => {
      const orderA = world.getOrder(idA);
      const orderB = world.getOrder(idB);
      const deadlineA = orderA?.slaDeadline ?? Infinity;
      const deadlineB = orderB?.slaDeadline ?? Infinity;
      if (deadlineA !== deadlineB) {
        return deadlineA - deadlineB;
      }
      const PRIORITY_RANKS: Record<string, number> = { urgent: 0, express: 1, standard: 2 };
      const rankA = orderA?.priority ? (PRIORITY_RANKS[orderA.priority] ?? 2) : 2;
      const rankB = orderB?.priority ? (PRIORITY_RANKS[orderB.priority] ?? 2) : 2;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const seqA = orderA?.creationSeq ?? orderA?.createdAt ?? 0;
      const seqB = orderB?.creationSeq ?? orderB?.createdAt ?? 0;
      if (seqA !== seqB) {
        return seqA - seqB;
      }
      return idA.localeCompare(idB);
    });
  }

  public resolveDeliveryLocation(world: World, address?: string, explicitCoords?: Coordinate): Coordinate {
    if (explicitCoords && typeof explicitCoords.lat === 'number' && typeof explicitCoords.lon === 'number') {
      return explicitCoords;
    }
    const addr = (address || '').toLowerCase();
    if (addr.includes('boeung tumpun') || addr.includes('meanchey') || addr.includes('271')) {
      return { lat: 11.5305, lon: 104.9085 };
    }
    if (addr.includes('pasteur') || addr.includes('bkk1') || addr.includes('keng kang')) {
      return { lat: 11.5520, lon: 104.9248 };
    }
    if (addr.includes('tuol kork') || addr.includes('tk')) {
      return { lat: 11.5750, lon: 104.8970 };
    }
    if (addr.includes('norodom') || addr.includes('tonle bassac') || addr.includes('bassac')) {
      return { lat: 11.5450, lon: 104.9350 };
    }
    if (addr.includes('teuk thla') || addr.includes('sen sok') || addr.includes('russian federation')) {
      return { lat: 11.5620, lon: 104.8780 };
    }
    if (addr.includes('chroy changvar') || addr.includes('ocic')) {
      return { lat: 11.5950, lon: 104.9380 };
    }
    if (addr.includes('riverside') || addr.includes('daun penh') || addr.includes('wat phnom')) {
      return { lat: 11.5750, lon: 104.9310 };
    }
    return randomPointInBounds(world.getConfig().bounds, {
      nextFloat: (min, max) => world.getRng().nextFloat(min, max),
    });
  }

  public generatePacedOrders(
    simTime: number,
    world: World,
    queue: string[],
    persistence: IPersistenceLayer,
    onOrderCreated: (order: Order) => void
  ): void {
    if (this.ordersGenerated >= this.targetOrderCount) return;

    if (simTime - this.lastOrderGenTime >= this.orderGenerationIntervalMs) {
      const order = world.generateOrder(simTime);
      this.ordersGenerated++;
      this.lastOrderGenTime = simTime;
      queue.push(order.id);
      this.sortDispatchQueueByEDF(queue, world);
      persistence.orders.saveOrder(order).catch(() => {});
      onOrderCreated(order);
    }
  }

  public seedInitialOrders(
    count: number,
    simTime: number,
    world: World,
    queue: string[],
    persistence: IPersistenceLayer
  ): void {
    const toGen = Math.min(count, Math.max(1, this.targetOrderCount - this.ordersGenerated));
    for (let i = 0; i < toGen; i++) {
      const order = world.generateOrder(simTime);
      this.ordersGenerated++;
      queue.push(order.id);
      persistence.orders.saveOrder(order).catch(() => {});
    }
    this.sortDispatchQueueByEDF(queue, world);
  }

  public ingestEcommerceOrder(
    eOrder: EcommerceOrder,
    simTime: number,
    world: World,
    queue: string[],
    persistence: IPersistenceLayer,
    ecommerceClient: MarketplaceReadAdapter
  ): Order {
    const existing = world.getOrder(eOrder.order_id);
    if (existing) return existing;

    // Resolve facility depot: check order's pickup location, facility_id, province, or world depots
    let depot: { position: Coordinate; id?: string; name?: string } | undefined;
    const rawOrder = eOrder as any;

    if (rawOrder.pickup_location || rawOrder.pickupLocation) {
      const pos = rawOrder.pickup_location || rawOrder.pickupLocation;
      depot = { position: pos, id: rawOrder.facility_id || 'depot-operational', name: 'Operational Facility' };
    } else if (rawOrder.facility_id) {
      depot = world.getWarehouse(rawOrder.facility_id) || OPERATIONAL_FACILITIES.find((f) => f.id === rawOrder.facility_id);
    } else if (eOrder.province) {
      const prov = eOrder.province.toLowerCase();
      if (prov.includes('siem reap')) {
        depot = world.getWarehouse('DC-REP-01') || OPERATIONAL_FACILITIES.find((f) => f.id === 'DC-REP-01');
      } else if (prov.includes('sihanouk') || prov.includes('coastal') || prov.includes('kampot')) {
        depot = world.getWarehouse('DC-KOS-01') || OPERATIONAL_FACILITIES.find((f) => f.id === 'DC-KOS-01');
      } else if (prov.includes('battambang')) {
        depot = world.getWarehouse('DC-BAT-01') || OPERATIONAL_FACILITIES.find((f) => f.id === 'DC-BAT-01');
      } else if (prov.includes('phnom penh') || prov.includes('kandal')) {
        depot = world.getWarehouse('DC-PNH-01') || OPERATIONAL_FACILITIES.find((f) => f.id === 'DC-PNH-01');
      }
    }

    if (!depot) {
      const depots = world.getAllWarehouses();
      depot = depots.length > 0 ? depots[0] : OPERATIONAL_FACILITIES[0];
    }

    // Ensure operational facility exists in world if needed
    if (depot && depot.id && !world.getWarehouse(depot.id)) {
      const opFacility = OPERATIONAL_FACILITIES.find((f) => f.id === depot!.id);
      world.addWarehouse(opFacility || {
        id: depot.id,
        name: depot.name || 'Operational Facility',
        position: depot.position,
        capacity: 10000,
        currentStock: 5000,
        type: 'depot',
        status: 'open',
      });
    }

    const deliveryLocation = this.resolveDeliveryLocation(
      world,
      eOrder.delivery_address,
      rawOrder.delivery_location || rawOrder.deliveryLocation
    );

    // Compute accurate demand weight from catalog
    let totalWeight = 0;
    for (const item of eOrder.items || []) {
      const catItem = FALLBACK_CAMBODIA_CATALOG.find((c) => c.product_id === item.product_id);
      const unitWeight = catItem?.weight_kg ?? (item.weight_kg ?? 2.0);
      totalWeight += unitWeight * (item.quantity || 1);
    }
    if (totalWeight <= 0) totalWeight = 5.0;

    const order: Order = {
      id: eOrder.order_id,
      customerId: eOrder.customer_id || 'C-ECOMMERCE',
      status: 'pending',
      priority: 'express',
      slaDurationMin: 35,
      slaDeadline: simTime + 35 * 60 * 1000,
      slaStatus: 'on_time',
      items: structuredClone(eOrder.items) || [{ name: 'Marketplace Item', quantity: 1 }],
      totalWeight_kg: totalWeight,
      pickupLocation: depot.position,
      deliveryLocation,
      assignedVehicleId: null,
      createdAt: simTime,
      assignedAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      estimatedDeliveryTime: null,
    };

    world.addOrder(order);
    persistence.orders.saveOrder(order).catch(() => {});
    queue.unshift(order.id);
    ecommerceClient.recordOrderIngested();
    return order;
  }
}
