/**
 * @fileoverview High-performance In-Memory Telemetry Repository.
 *
 * Implements ITelemetryRepository with a bounded rolling buffer (ring buffer)
 * and index by rider_id for sub-millisecond retrieval of breadcrumb trails.
 */

import { ITelemetryRepository, TelemetryPing } from '../types.js';

export class InMemoryTelemetryRepository implements ITelemetryRepository {
  private pings: TelemetryPing[] = [];
  private pingsByRider: Map<string, TelemetryPing[]> = new Map();
  private maxCapacity: number;

  constructor(maxCapacity: number = 25000) {
    this.maxCapacity = maxCapacity;
  }

  public async savePing(ping: TelemetryPing): Promise<void> {
    if (this.pings.length >= this.maxCapacity) {
      const evicted = this.pings.shift();
      if (evicted) {
        const riderList = this.pingsByRider.get(evicted.rider_id);
        if (riderList && riderList.length > 0) {
          riderList.shift();
        }
      }
    }

    this.pings.push(ping);

    let riderList = this.pingsByRider.get(ping.rider_id);
    if (!riderList) {
      riderList = [];
      this.pingsByRider.set(ping.rider_id, riderList);
    }
    riderList.push(ping);
  }

  public async saveBatch(pings: TelemetryPing[]): Promise<void> {
    for (const p of pings) {
      await this.savePing(p);
    }
  }

  public async getRecentPings(riderId: string, limit: number = 50): Promise<TelemetryPing[]> {
    const list = this.pingsByRider.get(riderId);
    if (!list || list.length === 0) return [];
    // Return newest first (descending timestamp, matching Cassandra clustering order)
    return list.slice(-limit).reverse();
  }

  public async getPingsByTimeRange(riderId: string, startMs: number, endMs: number): Promise<TelemetryPing[]> {
    const list = this.pingsByRider.get(riderId);
    if (!list || list.length === 0) return [];
    return list.filter(p => p.ping_timestamp >= startMs && p.ping_timestamp <= endMs);
  }

  public getTotalPingCount(): number {
    return this.pings.length;
  }

  public getStatus() {
    return {
      driver: 'in-memory (rolling buffer)',
      healthy: true,
      pingCount: this.pings.length,
    };
  }
}
