/**
 * @fileoverview High-performance In-Memory Telemetry Repository.
 *
 * Implements ITelemetryRepository with a bounded rolling buffer (ring buffer)
 * and index by rider_id for sub-millisecond retrieval of breadcrumb trails.
 */

import { ITelemetryRepository, TelemetryAcknowledgement, TelemetryPing } from '../types.js';

export class InMemoryTelemetryRepository implements ITelemetryRepository {
  private pings: TelemetryPing[] = [];
  private pingsByRider: Map<string, TelemetryPing[]> = new Map();
  private maxCapacity: number;
  private identities = new Map<string, TelemetryPing>();

  constructor(maxCapacity: number = 25000) {
    if (!Number.isSafeInteger(maxCapacity) || maxCapacity < 1) throw new Error('Invalid telemetry capacity');
    this.maxCapacity = maxCapacity;
  }

  public async savePing(ping: TelemetryPing): Promise<TelemetryAcknowledgement> {
    if (!ping.simulation_id || !ping.rider_id || !ping.status ||
        !Number.isSafeInteger(ping.ping_timestamp) || ping.ping_timestamp < 0 ||
        !Number.isFinite(ping.lat) || Math.abs(ping.lat) > 90 ||
        !Number.isFinite(ping.lon) || Math.abs(ping.lon) > 180 ||
        !Number.isFinite(ping.speed_kmh) || ping.speed_kmh < 0 ||
        !Number.isFinite(ping.battery_level) || ping.battery_level < 0 || ping.battery_level > 100 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(ping.ping_date)) throw new Error('Invalid simulated telemetry ping');
    const key = this.identity(ping);
    const stored = this.identities.get(key);
    const copy: TelemetryPing = { rider_id: ping.rider_id, simulation_id: ping.simulation_id,
      ping_timestamp: ping.ping_timestamp, ping_date: ping.ping_date, lat: ping.lat, lon: ping.lon,
      speed_kmh: ping.speed_kmh, battery_level: ping.battery_level, status: ping.status };
    const ack: TelemetryAcknowledgement = { schemaVersion: 1, stored: true, replayed: !!stored,
      durable: false, source: 'simulated', storage: 'in-memory', sinkOwner: 'logistics-sandbox', simulationId: ping.simulation_id,
      sourceId: ping.simulation_id, tenantId: 'demo',
      units: { coordinates: 'degrees', speed: 'km/h', battery: 'percent', time: 'simulation-ms' } };
    if (stored) {
      if (JSON.stringify(stored) !== JSON.stringify(copy)) throw new Error('Conflicting telemetry retry');
      return ack;
    }
    if (this.pings.length >= this.maxCapacity) {
      const evicted = this.pings.shift();
      if (evicted) {
        this.identities.delete(this.identity(evicted));
        const riderList = this.pingsByRider.get(evicted.rider_id);
        if (riderList && riderList.length > 0) {
          riderList.shift();
          if (riderList.length === 0) this.pingsByRider.delete(evicted.rider_id);
        }
      }
    }

    this.pings.push(copy);
    this.identities.set(key, copy);

    let riderList = this.pingsByRider.get(ping.rider_id);
    if (!riderList) {
      riderList = [];
      this.pingsByRider.set(ping.rider_id, riderList);
    }
    riderList.push(copy);
    return ack;
  }

  private identity(ping: TelemetryPing): string {
    return JSON.stringify([ping.simulation_id, ping.rider_id, ping.ping_timestamp]);
  }

  public async saveBatch(pings: TelemetryPing[]): Promise<void> {
    for (const p of pings) {
      await this.savePing(p);
    }
  }

  public async getRecentPings(riderId: string, limit: number = 50, simulationId?: string): Promise<TelemetryPing[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid telemetry limit');
    const list = this.pingsByRider.get(riderId);
    if (!list || list.length === 0) return [];
    return list.filter(p => !simulationId || p.simulation_id === simulationId)
      .sort((a, b) => b.ping_timestamp - a.ping_timestamp).slice(0, limit).map(p => ({ ...p }));
  }

  public async getPingsByTimeRange(riderId: string, startMs: number, endMs: number, simulationId?: string): Promise<TelemetryPing[]> {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) throw new Error('Invalid telemetry time range');
    const list = this.pingsByRider.get(riderId);
    if (!list || list.length === 0) return [];
    return list.filter(p => (!simulationId || p.simulation_id === simulationId) && p.ping_timestamp >= startMs && p.ping_timestamp <= endMs)
      .sort((a, b) => a.ping_timestamp - b.ping_timestamp).map(p => ({ ...p }));
  }

  public getTotalPingCount(): number {
    return this.pings.length;
  }

  public getStatus(): ReturnType<ITelemetryRepository['getStatus']> {
    return {
      driver: 'in-memory (rolling buffer)',
      healthy: true,
      pingCount: this.pings.length,
      schemaVersion: 1, source: 'simulated', tenantId: 'demo', sinkOwner: 'logistics-sandbox',
      storage: 'in-memory', durable: false, capacity: this.maxCapacity,
      retryScope: 'retained-history', retention: 'capacity-or-process-exit',
    };
  }
}
