/**
 * @fileoverview RoutingClient integrates with the osm-pathfinder Axum API.
 *
 * This client calls the real osm-pathfinder service for route calculations.
 * Vehicle movement follows the actual road geometry returned by the routing engine.
 * Under P0-05 strict mode, failures reject without synthetic straight-line fallbacks.
 */

import { Coordinate } from '../world/types.js';

export class StrictRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrictRoutingError';
  }
}

export interface GraphProvenance {
  nodes: number;
  edges: number;
  isDemo: boolean;
  datasetName: string;
  graphVersion: string;
  costModelVersion: string;
  available: boolean;
}

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
  /** Whether this route used synthetic/straight-line fallback */
  isFallback?: boolean;
  /** Whether the underlying graph is the synthetic demo graph */
  isDemo?: boolean;
  /** Pinned road graph version */
  graphVersion?: string;
  /** Pinned cost model version */
  costModelVersion?: string;
}

export interface RoutingOptions {
  /** Pathfinding algorithm: dijkstra, astar, bidirectional_dijkstra, bidirectional_astar, contraction_hierarchies */
  algorithm?: string;
  /** Cost metric: 'distance' or 'time' */
  metric?: string;
  /** Departure time as "HH:MM" for traffic-aware routing */
  departureTime?: string;
  /** Fleet vehicle profile: car, van, truck, motorcycle */
  profile?: string;
  /** If true, prohibits synthetic fallbacks and throws StrictRoutingError on failure */
  strict?: boolean;
  /** If true, rejects demo graphs and requires real OSM network */
  requireRealGraph?: boolean;
}

export class RoutingClient {
  private baseUrl: string;
  private available: boolean = true;
  private strictMode: boolean = false;
  private lastHealthCheck: number = 0;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  public setStrictMode(enabled: boolean): void {
    this.strictMode = enabled;
  }

  public isStrictMode(): boolean {
    return this.strictMode;
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
    const isStrict = options.strict ?? this.strictMode;
    const body = {
      start_lat: start.lat,
      start_lon: start.lon,
      end_lat: end.lat,
      end_lon: end.lon,
      algorithm: options.algorithm ?? 'contraction_hierarchies',
      metric: options.metric ?? 'time',
      ...(options.departureTime ? { departure_time: options.departureTime } : {}),
      ...(options.profile ? { profile: options.profile } : {}),
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

      const data = (await response.json()) as Record<string, unknown>;
      const isDemo = Boolean(data.is_demo);

      if (options.requireRealGraph && isDemo) {
        throw new StrictRoutingError(
          'Real road graph required for scored simulation, but osm-pathfinder is in demo mode.'
        );
      }

      return {
        path: data.path as [number, number][],
        distanceM: data.distance_m as number,
        durationS: data.duration_s as number,
        algorithm: data.algorithm as string,
        nodesVisited: data.nodes_visited as number,
        queryTimeMs: data.query_time_ms as number,
        startSnapped: data.start_snapped as [number, number] | undefined,
        endSnapped: data.end_snapped as [number, number] | undefined,
        isFallback: false,
        isDemo,
        graphVersion: data.graph_version as string | undefined,
        costModelVersion: data.cost_model_version as string | undefined,
      };
    } catch (err) {
      if (err instanceof StrictRoutingError) {
        throw err;
      }

      if (isStrict) {
        throw new StrictRoutingError(
          `Routing calculation failed in strict mode: ${(err as Error).message}. Synthetic straight-line fallback is prohibited for scored/validated runs.`
        );
      }

      if (this.available) {
        console.warn(`[RoutingClient] Route calculation failed: ${(err as Error).message}`);
        console.warn(`[RoutingClient] Is osm-pathfinder running at ${this.baseUrl}?`);
        this.available = false;
      }

      // Non-strict fallback: return a direct line (clearly marked as fallback)
      const fallbackDistance = haversineDistanceSimple(start, end);
      const fallbackDuration = fallbackDistance / 8.33; // ~30 km/h average

      return {
        path: [[start.lon, start.lat], [end.lon, end.lat]],
        distanceM: fallbackDistance,
        durationS: fallbackDuration,
        algorithm: 'fallback_direct',
        nodesVisited: 0,
        queryTimeMs: 0,
        isFallback: true,
        isDemo: true,
        graphVersion: 'fallback',
        costModelVersion: 'fallback-haversine',
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
   * Get road graph statistics and provenance metadata from osm-pathfinder.
   */
  public async getGraphStats(): Promise<{ nodes: number; edges: number }> {
    const prov = await this.getProvenance();
    return { nodes: prov.nodes, edges: prov.edges };
  }

  /**
   * Retrieve complete graph provenance from osm-pathfinder.
   */
  public async getProvenance(): Promise<GraphProvenance> {
    try {
      const response = await fetch(`${this.baseUrl}/api/graph/stats`, {
        signal: AbortSignal.timeout(2000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as Record<string, unknown>;
      return {
        nodes: (data.nodes as number) ?? 0,
        edges: (data.edges as number) ?? 0,
        isDemo: Boolean(data.is_demo),
        datasetName: (data.dataset_name as string) ?? 'unknown',
        graphVersion: (data.graph_version as string) ?? 'unknown',
        costModelVersion: (data.cost_model_version as string) ?? 'unknown',
        available: true,
      };
    } catch {
      return {
        nodes: 0,
        edges: 0,
        isDemo: true,
        datasetName: 'offline-fallback',
        graphVersion: 'none',
        costModelVersion: 'none',
        available: false,
      };
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
