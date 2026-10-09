import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { InMemoryTelemetryRepository } from '../src/persistence/in-memory/telemetry.repository.js';
import { TelemetryPing } from '../src/persistence/types.js';
import { SimulationEngine } from '../src/simulation/engine.js';
import { setupRoutes } from '../src/api/routes.js';

const ping = (simulationId = 'run-1', timestamp = 0): TelemetryPing => ({
  rider_id: 'rider', simulation_id: simulationId, ping_timestamp: timestamp,
  ping_date: '1970-01-01', lat: 0, lon: 0, speed_kmh: 0, battery_level: 0, status: 'idle',
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Simulated telemetry ownership', () => {
  it('concurrent retries are acknowledged once and conflicting payloads cannot overwrite history', async () => {
    const repo = new InMemoryTelemetryRepository();
    const acks = await Promise.all(Array.from({ length: 20 }, () => repo.savePing(ping())));
    expect(acks.filter(a => !a.replayed)).toHaveLength(1);
    expect(acks[0]).toMatchObject({ stored: true, durable: false, source: 'simulated', sinkOwner: 'logistics-sandbox' });
    await expect(repo.savePing({ ...ping(), lat: 1 })).rejects.toThrow('Conflicting');
    expect(repo.getTotalPingCount()).toBe(1);
  });

  it('isolates runs and copies input/output while sorting actual timestamps', async () => {
    const repo = new InMemoryTelemetryRepository();
    const input = ping();
    await repo.savePing(input);
    input.lat = 50;
    await repo.saveBatch([ping('run-2'), ping('run-1', 2), ping('run-1', 1)]);
    const result = await repo.getRecentPings('rider', 5, 'run-1');
    expect(result.map(p => p.ping_timestamp)).toEqual([2, 1, 0]);
    expect(result[2].lat).toBe(0);
    result[2].lat = 80;
    expect((await repo.getPingsByTimeRange('rider', 0, 0, 'run-1'))[0].lat).toBe(0);
    expect(await repo.getRecentPings('rider', 5, 'run-2')).toHaveLength(1);
  });

  it('bounds both history and retry protection; evicted identities can be stored again', async () => {
    const repo = new InMemoryTelemetryRepository(2);
    await repo.saveBatch([ping('run', 0), ping('run', 1), ping('run', 2)]);
    expect(repo.getTotalPingCount()).toBe(2);
    expect((await repo.savePing(ping('run', 0))).replayed).toBe(false);
    expect((await repo.getRecentPings('rider', 5)).map(p => p.ping_timestamp)).toEqual([2, 0]);
    expect(repo.getStatus()).toMatchObject({ durable: false, capacity: 2, retryScope: 'retained-history' });
    expect(new InMemoryTelemetryRepository().getTotalPingCount()).toBe(0);
  });

  it('rejects invalid coordinates, battery, timestamps and limits without acknowledging storage', async () => {
    const repo = new InMemoryTelemetryRepository();
    for (const invalid of [{ lat: NaN }, { lon: 181 }, { battery_level: -1 }, { speed_kmh: -1 }, { ping_timestamp: Infinity }, { simulation_id: '' }]) {
      await expect(repo.savePing({ ...ping(), ...invalid })).rejects.toThrow('Invalid');
    }
    await expect(repo.getRecentPings('rider', -1)).rejects.toThrow('Invalid');
    expect(repo.getTotalPingCount()).toBe(0);
  });

  it('HTTP playback exposes only current-run memory and rejects malformed queries', async () => {
    vi.stubEnv('PERSISTENCE_DRIVER', 'in-memory');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const engine = new SimulationEngine();
    await engine.persistence.telemetry.saveBatch([ping('old'), ping(engine.getSimulationId())]);
    const app = express();
    app.use('/api', setupRoutes(engine));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No server address');
    const base = `http://127.0.0.1:${address.port}/api`;
    try {
      for (const path of ['/telemetry/rider/rider', '/telemetry/playback?riderId=rider']) {
        const response = await fetch(base + path);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ schemaVersion: 1, source: 'simulated', durable: false, sinkOwner: 'logistics-sandbox', count: 1 });
        expect(body.pings[0].simulation_id).toBe(engine.getSimulationId());
        if (body.summary) expect(body.summary.startTime).toBe(0);
      }
      for (const query of ['limit=-1', 'limit=NaN', 'startTime=0', 'startTime=2&endTime=1']) {
        expect((await fetch(`${base}/telemetry/playback?riderId=rider&${query}`)).status).toBe(400);
      }
    } finally {
      engine.stop();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
