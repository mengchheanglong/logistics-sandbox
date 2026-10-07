/**
 * @fileoverview In-Memory Order Repository.
 *
 * Persists order lifecycle states, customer metadata, and delivers fulfillment KPIs.
 */

import { Order, OrderStatus } from '../../world/types.js';
import { IOrderRepository } from '../types.js';

export class InMemoryOrderRepository implements IOrderRepository {
  private orders: Map<string, Order> = new Map();

  public async saveOrder(order: Order): Promise<void> {
    this.orders.set(order.id, { ...order });
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    const o = this.orders.get(orderId);
    return o ? { ...o } : null;
  }

  public async getAllOrders(filter?: { status?: string; customerId?: string }): Promise<Order[]> {
    let list = Array.from(this.orders.values());
    if (filter?.status) {
      list = list.filter(o => o.status === filter.status);
    }
    if (filter?.customerId) {
      list = list.filter(o => o.customerId === filter.customerId);
    }
    return list.map(o => ({ ...o }));
  }

  public async updateOrderStatus(orderId: string, status: OrderStatus, deliveredAt?: number): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
      if (deliveredAt !== undefined) {
        order.deliveredAt = deliveredAt;
      }
    }
  }

  public async getMetrics() {
    const list = Array.from(this.orders.values());
    const total = list.length;
    const delivered = list.filter(o => o.status === 'delivered').length;
    const pending = list.filter(o => o.status === 'pending' || o.status === 'assigned').length;
    const breached = list.filter(o => o.slaStatus === 'breached').length;
    const onTimeRate = total > 0 ? Math.round(((total - breached) / total) * 100) : 100;

    return {
      total,
      delivered,
      pending,
      onTimeRate,
    };
  }

  public getStatus() {
    return {
      driver: 'in-memory (document map)',
      healthy: true,
      orderCount: this.orders.size,
    };
  }
}
