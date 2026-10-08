/**
 * @fileoverview Phnom Penh Urban Chaos Engine (Autonomous Self-Healing Simulator)
 * Periodically injects authentic Cambodian urban disruptions (flash monsoons,
 * bridge blockages, courier flat tires, and flash sale surges) to test fleet resilience
 * and self-healing automation.
 */

import type { ChaosMode, ChaosIncidentEvent, Coordinate } from '../world/types.js';
import type { SimulationEngine } from './engine.js';

interface ChaosScenarioDefinition {
  name: string;
  type: 'flood' | 'bridge_closure' | 'courier_breakdown' | 'order_surge' | 'traffic_gridlock';
  locationName: string;
  position?: Coordinate;
  radiusM?: number;
  description: string;
  durationMs: number;
}

const PHNOM_PENH_CHAOS_TEMPLATES: ChaosScenarioDefinition[] = [
  {
    name: 'Preah Monivong Flash Monsoon',
    type: 'flood',
    locationName: 'Preah Monivong Blvd / Central',
    position: { lat: 11.5564, lon: 104.9282 },
    radiusM: 520,
    description: 'Sudden monsoon downpour submerges low-lying intersection. Fleet dynamic detour triggered.',
    durationMs: 40000,
  },
  {
    name: 'Chroy Changvar Bridge Maintenance',
    type: 'bridge_closure',
    locationName: 'Chroy Changvar Bridge Approach',
    position: { lat: 11.5870, lon: 104.9250 },
    radiusM: 460,
    description: 'Bridge lane closure restricts transit across Tonle Sap. Cross-river shipments re-routed.',
    durationMs: 45000,
  },
  {
    name: 'Russian Blvd Underpass Drainage',
    type: 'flood',
    locationName: 'Russian Blvd (Toul Kork / Sen Sok corridor)',
    position: { lat: 11.5640, lon: 104.8920 },
    radiusM: 480,
    description: 'Water accumulation in underpass blocks airport arterial corridor. Heavy detour in effect.',
    durationMs: 35000,
  },
  {
    name: 'Olympic Market Gridlock Spasm',
    type: 'traffic_gridlock',
    locationName: 'Mao Tse Toung / Olympic Market',
    position: { lat: 11.5470, lon: 104.9150 },
    radiusM: 420,
    description: 'Dense commercial market congestion impedes parcel transit.',
    durationMs: 30000,
  },
  {
    name: 'Courier Mechanical Flat Tire',
    type: 'courier_breakdown',
    locationName: 'In-Transit Courier Route',
    description: 'Urban road debris causes tire puncture. Package load automatically evicted and re-allocated.',
    durationMs: 25000,
  },
  {
    name: 'AEON 2 Sen Sok Flash Sale Surge',
    type: 'order_surge',
    locationName: 'Sen Sok Commercial District',
    position: { lat: 11.5850, lon: 104.8820 },
    description: 'Sudden flash order wave generated in suburban district testing predictive AI balancing.',
    durationMs: 20000,
  },
];

export class ChaosEngine {
  private mode: ChaosMode = 'off';
  private tickCounter: number = 0;
  private activeEvents: ChaosIncidentEvent[] = [];
  private totalEventsTriggered: number = 0;
  private totalEventsHealed: number = 0;

  public getMode(): ChaosMode {
    return this.mode;
  }

  public setMode(mode: ChaosMode): void {
    this.mode = mode;
  }

  public getActiveEvents(): ChaosIncidentEvent[] {
    return [...this.activeEvents];
  }

  public getMetrics() {
    return {
      mode: this.mode,
      activeEventsCount: this.activeEvents.length,
      totalEventsTriggered: this.totalEventsTriggered,
      totalEventsHealed: this.totalEventsHealed,
      activeEvents: this.activeEvents,
    };
  }

  /**
   * Main Chaos evaluation loop called every simulation engine tick.
   */
  public tick(simTime: number, engine: SimulationEngine): void {
    if (this.mode === 'off') return;

    this.tickCounter++;

    // 1. Process active chaos events and self-heal expired ones
    for (let i = this.activeEvents.length - 1; i >= 0; i--) {
      const event = this.activeEvents[i];
      if (simTime >= event.autoHealAtSimMs) {
        this.healEvent(event, engine);
        this.activeEvents.splice(i, 1);
        this.totalEventsHealed++;
      }
    }

    // 2. Determine trigger frequency based on selected chaos intensity
    // 100ms real ticks:
    // Low: Every 120 ticks (~12 real seconds)
    // Medium: Every 60 ticks (~6 real seconds)
    // Extreme: Every 30 ticks (~3 real seconds)
    const intervalTicks = this.mode === 'extreme' ? 30 : this.mode === 'medium' ? 60 : 120;
    const maxConcurrent = this.mode === 'extreme' ? 4 : this.mode === 'medium' ? 2 : 1;

    if (this.tickCounter % intervalTicks === 0 && this.activeEvents.length < maxConcurrent) {
      this.triggerRandomChaos(simTime, engine);
    }
  }

  private triggerRandomChaos(simTime: number, engine: SimulationEngine): void {
    const template = PHNOM_PENH_CHAOS_TEMPLATES[Math.floor(Math.random() * PHNOM_PENH_CHAOS_TEMPLATES.length)];
    const eventId = `CHAOS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

    const chaosEvent: ChaosIncidentEvent = {
      id: eventId,
      name: template.name,
      description: template.description,
      type: template.type,
      locationName: template.locationName,
      triggeredAtSimMs: simTime,
      autoHealAtSimMs: simTime + template.durationMs,
    };

    if (template.type === 'flood' || template.type === 'bridge_closure' || template.type === 'traffic_gridlock') {
      const incident = engine.createRoadIncident({
        type: template.type === 'flood' ? 'flooding' : template.type === 'bridge_closure' ? 'road_work' : 'congestion',
        description: `[CHAOS] ${template.name}`,
        position: template.position || { lat: 11.5564, lon: 104.9282 },
        radiusM: template.radiusM || 500,
        severity: this.mode === 'extreme' ? 'critical' : 'high',
        autoRerouteAffected: true,
      });
      chaosEvent.id = incident.id;
    } else if (template.type === 'courier_breakdown') {
      const enRouteVehicles = engine.world.getAllVehicles().filter((v) => v.status === 'en_route');
      const allVehicles = engine.world.getAllVehicles();
      const target = enRouteVehicles.length > 0
        ? enRouteVehicles[Math.floor(Math.random() * enRouteVehicles.length)]
        : (allVehicles.length > 0 ? allVehicles[Math.floor(Math.random() * allVehicles.length)] : null);

      if (target) {
        chaosEvent.id = target.id;
        engine.injectEvent({
          type: 'vehicle.broken_down',
          targetId: target.id,
          payload: { reason: `[CHAOS] ${template.name}` },
        });
      } else {
        return; // Skip only if world has 0 vehicles
      }
    } else if (template.type === 'order_surge') {
      const count = this.mode === 'extreme' ? 12 : 6;
      for (let i = 0; i < count; i++) {
        engine.injectCustomOrder({
          customerName: `Chaos Flash Buyer #${i + 1}`,
          deliveryLocation: { lat: 11.5850 + (Math.random() - 0.5) * 0.02, lon: 104.8820 + (Math.random() - 0.5) * 0.02 },
          priority: 'express',
          slaDurationMin: 25,
        }).catch(() => {});
      }
    }

    this.activeEvents.push(chaosEvent);
    this.totalEventsTriggered++;

    engine.emitEvent('simulation', engine.getSimulationId(), 'chaos.injected', {
      chaosId: chaosEvent.id,
      name: chaosEvent.name,
      description: chaosEvent.description,
      mode: this.mode,
      autoHealAtSimMs: chaosEvent.autoHealAtSimMs,
    });

    console.log(`[ChaosEngine] ⚡ Triggered Chaos Event: "${chaosEvent.name}" (${chaosEvent.locationName}) | Mode: ${this.mode}`);
  }

  private healEvent(event: ChaosIncidentEvent, engine: SimulationEngine): void {
    if (event.type === 'flood' || event.type === 'bridge_closure' || event.type === 'traffic_gridlock') {
      engine.clearRoadIncident(event.id);
    } else if (event.type === 'courier_breakdown') {
      engine.injectEvent({
        type: 'vehicle.recovered',
        targetId: event.id,
        payload: { reason: 'Autonomous mechanic service dispatched.' },
      });
    }

    engine.emitEvent('simulation', engine.getSimulationId(), 'chaos.self_healed', {
      chaosId: event.id,
      name: event.name,
      locationName: event.locationName,
    });

    console.log(`[ChaosEngine] 💚 Self-Healed Chaos Event: "${event.name}" (${event.locationName})`);
  }
}
