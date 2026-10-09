import { Coordinate, RoadIncident, Vehicle } from '../world/types.js';
import { haversineDistance } from '../utils/geo.js';

export interface CreateIncidentOptions {
  type: 'accident' | 'road_work' | 'flooding' | 'congestion';
  description: string;
  position: Coordinate;
  radiusM: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  autoRerouteAffected?: boolean;
}

export class IncidentManager {
  private incidents: RoadIncident[] = [];
  private incidentCounter: number = 0;

  public createIncident(data: CreateIncidentOptions, simTime: number): RoadIncident {
    this.incidentCounter++;
    const id = `INC-${String(this.incidentCounter).padStart(4, '0')}`;
    const incident: RoadIncident = {
      id,
      type: data.type,
      description: data.description,
      position: data.position,
      radiusM: data.radiusM,
      severity: data.severity || 'high',
      createdAt: simTime,
      active: true,
    };
    this.incidents.push(incident);
    return incident;
  }

  public clearIncident(incidentId: string): RoadIncident | null {
    const incident = this.incidents.find((i) => i.id === incidentId);
    if (!incident || !incident.active) return null;
    incident.active = false;
    return incident;
  }

  public getActiveIncidents(): RoadIncident[] {
    return this.incidents.filter((i) => i.active);
  }

  public getAllIncidents(): RoadIncident[] {
    return [...this.incidents];
  }

  public isRouteIntersectingIncident(
    path: [number, number][],
    progress: number,
    incident: RoadIncident
  ): boolean {
    if (!path || path.length === 0) return false;
    const startIndex = Math.min(path.length - 1, Math.ceil(progress * (path.length - 1)));
    for (let i = startIndex; i < path.length; i++) {
      const pt = { lon: path[i][0], lat: path[i][1] };
      if (haversineDistance(pt, incident.position) <= incident.radiusM) {
        return true;
      }
    }
    return false;
  }

  public getAffectedVehicles(vehicles: Vehicle[], incident: RoadIncident): Vehicle[] {
    return vehicles.filter((v) => {
      if (v.status !== 'en_route' && v.status !== 'returning') return false;
      return this.isRouteIntersectingIncident(v.routeGeometry, v.routeProgress, incident);
    });
  }

  public reset(): void {
    this.incidents = [];
    this.incidentCounter = 0;
  }
}
