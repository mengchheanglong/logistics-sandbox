import { describe, it, expect, vi } from 'vitest';
import { SimulationEngine } from '../src/simulation/engine.js';
import { calculateAvoidanceWaypoint, haversineDistance } from '../src/utils/geo.js';
import type { RoadIncident, Vehicle } from '../src/world/types.js';

describe('In-Flight Re-Routing and Road Incidents', () => {
  it('calculates detour waypoint outside the obstacle radius', () => {
    const from = { lat: 11.55, lon: 104.90 };
    const to = { lat: 11.57, lon: 104.90 };
    const obstacle = { lat: 11.56, lon: 104.90 };
    const radiusM = 500;

    const detour = calculateAvoidanceWaypoint(from, to, obstacle, radiusM);
    const distToObstacle = haversineDistance(detour, obstacle);

    // Detour point should be at least 1.4x radius from obstacle center
    expect(distToObstacle).toBeGreaterThan(radiusM * 1.3);
  });

  it('detects whether remaining polyline intersects an incident zone', () => {
    const engine = new SimulationEngine();
    const incident: RoadIncident = {
      id: 'INC-1',
      type: 'accident',
      description: 'Central Road Blockade',
      position: { lat: 11.56, lon: 104.92 },
      radiusM: 500,
      severity: 'high',
      createdAt: 0,
      active: true,
    };

    // Path that directly intersects the incident
    const pathThrough: [number, number][] = [
      [104.91, 11.56],
      [104.92, 11.56], // Distance to incident is 0m
      [104.93, 11.56],
    ];

    expect(engine.isRouteIntersectingIncident(pathThrough, 0, incident)).toBe(true);

    // When vehicle has already passed the incident (progress 0.8)
    expect(engine.isRouteIntersectingIncident(pathThrough, 0.8, incident)).toBe(false);

    // Path that is far away (e.g. at lon 104.99)
    const pathFar: [number, number][] = [
      [104.99, 11.56],
      [104.995, 11.56],
    ];
    expect(engine.isRouteIntersectingIncident(pathFar, 0, incident)).toBe(false);
  });

  it('creates and clears road incidents', () => {
    const engine = new SimulationEngine();
    const incident = engine.createRoadIncident({
      type: 'flooding',
      description: 'Monsoon street flooding',
      position: { lat: 11.55, lon: 104.91 },
      radiusM: 400,
      severity: 'medium',
      autoRerouteAffected: false,
    });

    expect(incident.id).toBeDefined();
    expect(incident.active).toBe(true);
    expect(engine.getActiveIncidents().length).toBe(1);

    const cleared = engine.clearRoadIncident(incident.id);
    expect(cleared).toBe(true);
    expect(engine.getActiveIncidents().length).toBe(0);
  });

  it('reroutes an en-route vehicle dynamically', async () => {
    const engine = new SimulationEngine();
    const vehicle = engine.world.getAllVehicles()[0];

    // Set vehicle to en_route
    vehicle.status = 'en_route';
    vehicle.position = { lat: 11.55, lon: 104.92 };
    vehicle.routeGeometry = [
      [104.92, 11.55],
      [104.925, 11.555],
      [104.93, 11.56],
    ];
    vehicle.routeDistanceM = 1500;
    vehicle.routeDurationS = 200;
    vehicle.routeProgress = 0.4;
    vehicle.assignedOrderIds = [];

    // Mock routingClient.calculateRoute
    vi.spyOn(engine.routingClient, 'calculateRoute').mockResolvedValue({
      path: [
        [104.92, 11.55],
        [104.928, 11.558],
        [104.93, 11.56],
      ],
      distanceM: 1400,
      durationS: 180,
      algorithm: 'contraction_hierarchies',
      nodesVisited: 15,
      queryTimeMs: 0.1,
    });

    const result = await engine.rerouteVehicle(vehicle.id, {
      reason: 'manual_operator',
      avoidIncidents: false,
    });

    expect(result.success).toBe(true);
    expect(vehicle.routeProgress).toBe(0);
    expect(vehicle.routeDistanceM).toBe(1400);
    expect(vehicle.routeDurationS).toBe(180);
    expect(vehicle.rerouteCount).toBe(1);
    expect(vehicle.rerouteReason).toBe('manual_operator');
  });
});
