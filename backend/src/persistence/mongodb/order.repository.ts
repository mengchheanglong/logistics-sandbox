/**
 * @fileoverview MongoDB Order Repository Adapter.
 *
 * Implements IOrderRepository targeting the MongoDB orders collection schema
 * from ecommerce-hive-nosql:
 *
 *   {
 *     order_id: string,
 *     customer_id: string,
 *     customer_name: string,
 *     items: Array<{ product_id, name, quantity, price }>,
 *     total: number,
 *     province: string,
 *     payment_method: string,
 *     status: string,
 *     delivery_address: string,
 *     assigned_courier_id: string,
 *     created_at: Date
 *   }
 */

import { Order, OrderStatus } from '../../world/types.js';
import { IOrderRepository } from '../types.js';
import { InMemoryOrderRepository } from '../in-memory/order.repository.js';

export class MongoOrderRepository implements IOrderRepository {
  private fallbackRepo: InMemoryOrderRepository;
  private baseUrl: string;
  private isConnected: boolean = false;

  constructor(baseUrl: string = 'http://localhost:4000') {
    this.baseUrl = baseUrl;
    this.fallbackRepo = new InMemoryOrderRepository();
    this.testConnection();
  }

  private async testConnection(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/api/orders`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
      });
      this.isConnected = res.ok;
    } catch {
      this.isConnected = false;
    }
  }

  public async saveOrder(order: Order): Promise<void> {
    // 1. Always record in local repository
    await this.fallbackRepo.saveOrder(order);

    // 2. Synchronize to MongoDB via REST bridge if available
    if (this.isConnected) {
      try {
        await fetch(`${this.baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: order.id,
            customer_id: order.customerId,
            customer_name: `Customer (${order.customerId})`,
            items: order.items.map(it => ({
              product_id: it.product_id || 'P-GEN',
              name: it.name,
              quantity: it.quantity,
              price: it.price || 10,
            })),
            total: order.items.reduce((acc, it) => acc + (it.price || 10) * it.quantity, 0),
            province: 'Phnom Penh',
            payment_method: 'Bakong KHQR',
            status: order.status === 'delivered' ? 'Delivered' : order.status === 'in_transit' ? 'Out for Delivery' : 'Preparing',
            delivery_address: `Phnom Penh (${order.deliveryLocation.lat.toFixed(4)}, ${order.deliveryLocation.lon.toFixed(4)})`,
            assigned_courier_id: order.assignedVehicleId || undefined,
          }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {
        // Continue with local store
      }
    }
  }

  public async getOrder(orderId: string): Promise<Order | null> {
    return this.fallbackRepo.getOrder(orderId);
  }

  public async getAllOrders(filter?: { status?: string; customerId?: string }): Promise<Order[]> {
    return this.fallbackRepo.getAllOrders(filter);
  }

  public async updateOrderStatus(orderId: string, status: OrderStatus, deliveredAt?: number): Promise<void> {
    await this.fallbackRepo.updateOrderStatus(orderId, status, deliveredAt);

    if (this.isConnected) {
      const upstreamStatus = status === 'delivered' ? 'Delivered' : status === 'in_transit' ? 'Out for Delivery' : 'Preparing';
      try {
        await fetch(`${this.baseUrl}/api/orders/${orderId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: upstreamStatus }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {
        // Continue
      }
    }
  }

  public async getMetrics() {
    return this.fallbackRepo.getMetrics();
  }

  public getStatus() {
    return {
      driver: 'MongoDB (orders collection via microservice bridge)',
      healthy: this.isConnected,
      orderCount: (this.fallbackRepo as any).orders?.size || 0,
    };
  }
}
