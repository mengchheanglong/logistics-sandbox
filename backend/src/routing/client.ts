/**
 * @fileoverview RoutingClient integrates with the osm-pathfinder Axum API.
 *
 * This client calls the real osm-pathfinder service for route calculations.
 * Vehicle movement follows the actual road geometry returned by the routing engine.
 */

import { Coordinate } from '../world/types.js';

export interface RouteResult {
  /** Route polyline as [lon, lat] coordinate pairs */
  path: [number, number][];
  /** Total route distance in meters */
  distanceM: number;
  /** Estimated travel duration in seconds */
  durationS: number;
  /** Algorithm used for pathfinding */
  algorithm: string;
  /** Number of graph nodes explored */
  nodesVisited: number;
  /** Query execution time in milliseconds */
  queryTimeMs: number;
  /** Snapped start coordinate [lon, lat] */
  startSnapped?: [number, number];
  /** Snapped end coordinate [lon, lat] */
  endSnapped?: [number, number];
}

export interface RoutingOptions {
  /** Pathfinding algorithm: dijkstra, astar, bidirectional_dijkstra, bidirectional_astar, contraction_hierarchies */
  algorithm?: string;
  /** Cost metric: 'distance' or 'time' */
  metric?: string;
  /** Departure time as "HH:MM" for traffic-aware routing */
  departureTime?: string;
}

export class RoutingClient {
  private baseUrl: string;
  private available: boolean = true;
  private lastHealthCheck: number = 0;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Calculate a route between two coordinates using osm-pathfinder.
   * Returns the actual road geometry, distance, and duration.
   */
  public async calculateRoute(
    start: Coordinate,
    end: Coordinate,
    options: RoutingOptions = {}
  ): Promise<RouteResult> {
    const body = {
      start_lat: start.lat,
      start_lon: start.lon,
      end_lat: end.lat,
      end_lon: end.lon,
      algorithm: options.algorithm ?? 'contraction_hierarchies',
      metric: options.metric ?? 'time',
      ...(options.departureTime ? { departure_time: options.departureTime } : {}),
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Routing API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;

      return {
        path: data.path as [number, number][],
        distanceM: data.distance_m as number,
        durationS: data.duration_s as number,
        algorithm: data.algorithm as string,
        nodesVisited: data.nodes_visited as number,
        queryTimeMs: data.query_time_ms as number,
        startSnapped: data.start_snapped as [number, number] | undefined,
        endSnapped: data.end_snapped as [number, number] | undefined,
      };
    } catch (err) {
      if (!this.available) {
        // Already known to be unavailable, don't spam logs
      } else {
        console.warn(`[RoutingClient] Route calculation failed: ${(err as Error).message}`);
        console.warn(`[RoutingClient] Is osm-pathfinder running at ${this.baseUrl}?`);
        this.available = false;
      }

      // Fallback: return a direct line (clearly marked as fallback)
      const fallbackDistance = haversineDistanceSimple(start, end);
      const fallbackDuration = fallbackDistance / 8.33; // ~30 km/h average

      return {
        path: [[start.lon, start.lat], [end.lon, end.lat]],
        distanceM: fallbackDistance,
        durationS: fallbackDuration,
        algorithm: 'fallback_direct',
        nodesVisited: 0,
        queryTimeMs: 0,
      };
    }
  }

  /**
   * Check if the osm-pathfinder service is healthy.
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        this.available = true;
        this.lastHealthCheck = Date.now();
        return true;
      }
      return false;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Get road graph statistics from osm-pathfinder.
   */
  public async getGraphStats(): Promise<{ nodes: number; edges: number }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/graph/stats`, {
        signal: AbortSignal.timeout(2000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as { nodes: number; edges: number };
    } catch (err) {
      console.warn(`[RoutingClient] Failed to get graph stats: ${(err as Error).message}`);
      return { nodes: 0, edges: 0 };
    }
  }

  /** Whether the routing service was reachable on last attempt */
  public isAvailable(): boolean {
    return this.available;
  }
}

/** Simple haversine for fallback distance estimation */
function haversineDistanceSimple(a: Coordinate, b: Coordinate): number {
  const R = 6371e3;
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
