/**
 * @fileoverview Integration client for the upstream ecommerce-hive-nosql platform.
 *
 * Connects the Logistics Sandbox digital twin to the e-commerce marketplace:
 * 1. Ingests customer orders from ecommerce-hive-nosql (MongoDB backend on port 4000)
 * 2. Emits status updates back (Pending -> Preparing -> Out for Delivery -> Delivered)
 * 3. Streams simulated rider GPS telemetry pings into ecommerce-hive-nosql (Cassandra ingest on /api/riders/ping)
 */

import { Coordinate } from '../world/types.js';

export interface EcommerceOrder {
  order_id: string;
  customer_id?: string;
  customer_name: string;
  items: Array<{ product_id: string; name: string; quantity: number; price: number }>;
  total: number;
  province: string;
  payment_method: string;
  status: string;
  delivery_address?: string;
  assigned_courier_id?: string;
  assigned_courier_name?: string;
}

export interface EcommerceBridgeStatus {
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  lastSyncTimestamp: number | null;
  ordersIngestedCount: number;
  telemetryPingsEmittedCount: number;
}

export class EcommerceClient {
  private baseUrl: string;
  private isAvailable: boolean = false;
  private lastCheckTime: number = 0;
  private ingestedOrdersCount: number = 0;
  private pingsEmittedCount: number = 0;

  constructor(baseUrl: string = 'http://localhost:4000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Health check on ecommerce-hive-nosql API.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/orders`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
      });
      this.isAvailable = res.ok;
      this.lastCheckTime = Date.now();
      return this.isAvailable;
    } catch {
      this.isAvailable = false;
      this.lastCheckTime = Date.now();
      return false;
    }
  }

  /**
   * Fetch active orders from ecommerce-hive-nosql (status: "Pending" or "Preparing").
   */
  public async fetchPendingOrders(): Promise<EcommerceOrder[]> {
    if (!this.isAvailable) return [];
    try {
      const res = await fetch(`${this.baseUrl}/api/orders`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const orders = (await res.json()) as EcommerceOrder[];
      return orders.filter(
        (o) => o.status === 'Pending' || o.status === 'Preparing'
      );
    } catch (err) {
      console.warn(`[EcommerceClient] Failed to fetch orders: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Update order status in ecommerce-hive-nosql.
   * e.g., transition to "Out for Delivery" or "Delivered".
   */
  public async updateOrderStatus(
    orderId: string,
    status: 'Pending' | 'Preparing' | 'Out for Delivery' | 'Delivered' | 'Cancelled',
    courierId?: string
  ): Promise<boolean> {
    if (!this.isAvailable) return false;
    try {
      const res = await fetch(`${this.baseUrl}/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, courier_id: courierId }),
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Stream simulated rider telemetry ping directly into ecommerce-hive-nosql
   * which ingests it into Apache Cassandra (`rider_gps_pings` table).
   */
  public async sendRiderPing(
    riderId: string,
    pos: Coordinate,
    speedKmh: number,
    battery: number = 92
  ): Promise<boolean> {
    if (!this.isAvailable) return false;
    try {
      const res = await fetch(`${this.baseUrl}/api/riders/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rider_id: riderId,
          lat: pos.lat,
          lng: pos.lon,
          speed: `${speedKmh.toFixed(1)} km/h`,
          battery: Math.round(battery),
        }),
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        this.pingsEmittedCount++;
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  public recordOrderIngested(): void {
    this.ingestedOrdersCount++;
  }

  public getStatus(): EcommerceBridgeStatus {
    return {
      enabled: true,
      connected: this.isAvailable,
      baseUrl: this.baseUrl,
      lastSyncTimestamp: this.lastCheckTime || null,
      ordersIngestedCount: this.ingestedOrdersCount,
      telemetryPingsEmittedCount: this.pingsEmittedCount,
    };
  }
}
