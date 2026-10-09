/**
 * @fileoverview Canonical Event Serialization and SHA-256 Hashing.
 *
 * Implements deterministic serialization of simulation event sequences:
 * - Recursive lexicographical key sorting for all JSON objects.
 * - Explicit exclusion of volatile wall-clock fields (realTimestamp, queryTimeMs).
 * - Finite number normalization.
 * - Deterministic SHA-256 digest computation over newline-delimited canonical event strings.
 */

import { createHash } from 'node:crypto';
import { SimulationEvent } from '../world/types.js';

export const VOLATILE_EXCLUDED_KEYS = new Set([
  'realTimestamp',
  'real_timestamp',
  'queryTimeMs',
  'query_time_ms',
  'wallClockTime',
  'wall_clock_time',
  'executionTimeMs',
  'execution_time_ms',
]);

/**
 * Recursively canonicalize any JSON-serializable value.
 */
export function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) {
    return null;
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    if (Object.is(val, -0)) return 0;
    return val;
  }
  if (typeof val === 'boolean' || typeof val === 'string') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => canonicalizeValue(item));
  }
  if (typeof val === 'object') {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>)
      .filter((k) => !VOLATILE_EXCLUDED_KEYS.has(k))
      .sort();
    for (const key of keys) {
      const propVal = (val as Record<string, unknown>)[key];
      if (propVal !== undefined && typeof propVal !== 'function') {
        sortedObj[key] = canonicalizeValue(propVal);
      }
    }
    return sortedObj;
  }
  return String(val);
}

/**
 * Produce a canonical single-line JSON string representing a SimulationEvent.
 */
export function canonicalizeEvent(event: SimulationEvent): string {
  // If entity is the simulation itself, normalize entityId to avoid run-specific UUID divergence
  const normalizedEntityId =
    event.entityType === 'simulation' ? 'simulation' : event.entityId;

  const canonicalObj = {
    seq: event.sequenceNumber,
    simTime: event.simTimestamp,
    entityType: event.entityType,
    entityId: normalizedEntityId,
    eventType: event.eventType,
    payload: canonicalizeValue(event.payload),
  };
  return JSON.stringify(canonicalObj);
}

/**
 * Compute the SHA-256 digest over the ordered canonical event sequence.
 */
export function computeCanonicalEventSequenceHash(events: SimulationEvent[]): string {
  const sortedEvents = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const lines = sortedEvents.map(canonicalizeEvent);
  const stream = lines.join('\n');
  return createHash('sha256').update(stream, 'utf8').digest('hex');
}
