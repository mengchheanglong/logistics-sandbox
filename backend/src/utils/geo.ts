/**
 * @fileoverview Geographic utilities for the logistics simulation.
 *
 * Provides haversine distance calculation, distance-weighted polyline
 * interpolation (critical for vehicle movement along route geometry),
 * and random coordinate generation.
 */

import { Coordinate } from '../world/types.js';

/**
 * Calculate the great-circle distance between two coordinates using the
 * Haversine formula.
 * @returns Distance in meters
 */
export function haversineDistance(a: Coordinate, b: Coordinate): number {
  const R = 6371e3; // Earth radius in metres
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const deltaPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLambda = ((b.lon - a.lon) * Math.PI) / 180;

  const x =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

  return R * c;
}

/**
 * Compute cumulative distances along a polyline path.
 * Each element i represents the total distance from path[0] to path[i].
 */
function computeCumulativeDistances(path: [number, number][]): number[] {
  const distances = [0];
  for (let i = 1; i < path.length; i++) {
    const a: Coordinate = { lon: path[i - 1][0], lat: path[i - 1][1] };
    const b: Coordinate = { lon: path[i][0], lat: path[i][1] };
    distances.push(distances[i - 1] + haversineDistance(a, b));
  }
  return distances;
}

/**
 * Interpolate a position along a polyline path based on a progress value (0–1).
 *
 * Uses **distance-weighted interpolation**: progress 0.5 means the point is
 * at 50% of the total path distance, not 50% of the segment count.
 * This ensures uniform speed appearance regardless of segment density.
 *
 * @param path  Array of [lon, lat] coordinates forming the route polyline
 * @param progress  Value between 0 (start) and 1 (end)
 * @returns Interpolated coordinate
 */
export function interpolateAlongPath(path: [number, number][], progress: number): Coordinate {
  if (path.length === 0) return { lat: 0, lon: 0 };
  if (progress <= 0 || path.length === 1) return { lon: path[0][0], lat: path[0][1] };
  if (progress >= 1) return { lon: path[path.length - 1][0], lat: path[path.length - 1][1] };

  const cumDist = computeCumulativeDistances(path);
  const totalDistance = cumDist[cumDist.length - 1];

  if (totalDistance === 0) return { lon: path[0][0], lat: path[0][1] };

  const targetDistance = progress * totalDistance;

  // Binary search for the segment containing the target distance
  let segIndex = 0;
  for (let i = 1; i < cumDist.length; i++) {
    if (cumDist[i] >= targetDistance) {
      segIndex = i - 1;
      break;
    }
  }

  const segStart = cumDist[segIndex];
  const segEnd = cumDist[segIndex + 1];
  const segLength = segEnd - segStart;

  // How far along this segment
  const segProgress = segLength > 0 ? (targetDistance - segStart) / segLength : 0;

  const p1 = path[segIndex];
  const p2 = path[segIndex + 1];

  return {
    lon: p1[0] + (p2[0] - p1[0]) * segProgress,
    lat: p1[1] + (p2[1] - p1[1]) * segProgress,
  };
}

/**
 * Calculate the total distance of a polyline path in meters.
 */
export function pathDistance(path: [number, number][]): number {
  if (path.length < 2) return 0;
  const cumDist = computeCumulativeDistances(path);
  return cumDist[cumDist.length - 1];
}

/**
 * Generate a random coordinate within geographic bounds using a seeded RNG.
 */
export function randomPointInBounds(
  bounds: { north: number; south: number; east: number; west: number },
  rng: { nextFloat: (min: number, max: number) => number }
): Coordinate {
  return {
    lat: rng.nextFloat(bounds.south, bounds.north),
    lon: rng.nextFloat(bounds.west, bounds.east),
  };
}

/**
 * Format a coordinate as a human-readable string.
 */
export function formatCoordinate(coord: Coordinate): string {
  return `${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}`;
}

/**
 * Calculate a detour waypoint around an obstacle coordinate.
 * Shifts perpendicularly from the trajectory line by 1.5x the obstacle radius.
 */
export function calculateAvoidanceWaypoint(
  from: Coordinate,
  to: Coordinate,
  obstacle: Coordinate,
  radiusM: number
): Coordinate {
  const dx = to.lon - from.lon;
  const dy = to.lat - from.lat;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return obstacle;

  // Perpendicular normal vector
  const nx = -dy / len;
  const ny = dx / len;

  // Convert meters to approximate lat/lon degrees (1 deg lat ~ 111,000m)
  const offsetM = radiusM * 1.5;
  const latOffset = (ny * offsetM) / 111000;
  const lonOffset = (nx * offsetM) / (111000 * Math.cos((obstacle.lat * Math.PI) / 180));

  return {
    lat: obstacle.lat + latOffset,
    lon: obstacle.lon + lonOffset,
  };
}

