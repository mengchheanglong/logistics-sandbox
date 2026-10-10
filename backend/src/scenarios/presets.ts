/**
 * @fileoverview Scenario presets for the logistics sandbox digital twin.
 */

import { ScenarioConfig } from '../world/types.js';

export const SCENARIO_PRESETS: Record<string, ScenarioConfig> = {
  morning_delivery: {
    id: 'morning_delivery',
    name: 'Phnom Penh Morning Delivery',
    description: 'Standard baseline logistics operations across Phnom Penh commercial and residential sectors.',
    seed: 42,
    city: 'Phnom Penh, Cambodia',
    bounds: { north: 11.60, south: 11.52, east: 104.96, west: 104.88 },
    vehicleCount: 30,
    orderCount: 200,
    depots: [
      { id: 'depot-a', name: 'Central Market Depot', position: { lat: 11.5680, lon: 104.9223 } },
      { id: 'depot-b', name: 'Russian Market Depot', position: { lat: 11.5490, lon: 104.9280 } },
    ],
    duration_hours: 8,
    trafficEnabled: false,
    incidents: [],
  },

  depot_stress_test: {
    id: 'depot_stress_test',
    name: 'Depot Flooding & Evacuation Stress Test',
    description: 'Monsoon flooding closes Russian Market Depot. Stationed fleet evacuates to Central Market under heavy citywide demand.',
    seed: 99,
    city: 'Phnom Penh, Cambodia',
    bounds: { north: 11.60, south: 11.52, east: 104.96, west: 104.88 },
    vehicleCount: 35,
    orderCount: 250,
    depots: [
      { id: 'depot-a', name: 'Central Market Depot', position: { lat: 11.5680, lon: 104.9223 } },
      { id: 'depot-b', name: 'Russian Market Depot (Flooded)', position: { lat: 11.5490, lon: 104.9280 } },
    ],
    duration_hours: 8,
    trafficEnabled: true,
    incidents: [
      {
        type: 'flooding',
        description: 'Monivong Approach Inundation',
        position: { lat: 11.535, lon: 104.932 },
        radiusM: 550,
        severity: 'critical',
      },
    ],
  },

  express_rush_hour: {
    id: 'express_rush_hour',
    name: 'Express Rush-Hour Blitz (VRPTW Priority)',
    description: 'High-density urgent delivery surge (15-min and 30-min tight SLAs) testing earliest-deadline-first dispatch under evening traffic.',
    seed: 101,
    city: 'Phnom Penh, Cambodia',
    bounds: { north: 11.60, south: 11.52, east: 104.96, west: 104.88 },
    vehicleCount: 28,
    orderCount: 180,
    depots: [
      { id: 'depot-a', name: 'Central Market Depot', position: { lat: 11.5680, lon: 104.9223 } },
      { id: 'depot-b', name: 'Russian Market Depot', position: { lat: 11.5490, lon: 104.9280 } },
    ],
    duration_hours: 6,
    trafficEnabled: true,
    incidents: [
      {
        type: 'congestion',
        description: 'Norodom Blvd Evening Gridlock',
        position: { lat: 11.557, lon: 104.928 },
        radiusM: 400,
        severity: 'high',
      },
    ],
  },

  ai_surge_rebalance: {
    id: 'ai_surge_rebalance',
    name: 'Suburban Surge & AI Predictive Rebalancing',
    description: 'Heavy demand surge across Sen Sok & Meanchey suburbs. Tests autonomous AI anticipatory fleet repositioning and dynamic SLA breach risk avoidance.',
    seed: 314,
    city: 'Phnom Penh, Cambodia',
    bounds: { north: 11.60, south: 11.52, east: 104.96, west: 104.88 },
    vehicleCount: 36,
    orderCount: 240,
    depots: [
      { id: 'depot-a', name: 'Central Market Depot', position: { lat: 11.5680, lon: 104.9223 } },
      { id: 'depot-b', name: 'Russian Market Depot', position: { lat: 11.5490, lon: 104.9280 } },
    ],
    duration_hours: 8,
    trafficEnabled: true,
    incidents: [
      {
        type: 'road_work',
        description: 'Russian Blvd Underpass Maintenance',
        position: { lat: 11.566, lon: 104.899 },
        radiusM: 350,
        severity: 'medium',
      },
    ],
  },

  cambodia_network: {
    id: 'cambodia_network',
    name: 'Cambodia Operational Fulfillment Network',
    description: 'Unified 4-depot operational supply chain network across Cambodia (Phnom Penh, Siem Reap, Sihanoukville, Battambang).',
    seed: 42,
    city: 'Cambodia National Network',
    bounds: { north: 13.50, south: 10.50, east: 105.00, west: 103.00 },
    vehicleCount: 40,
    orderCount: 200,
    depots: [
      { id: 'DC-PNH-01', name: 'Phnom Penh Central Fulfillment Hub', position: { lat: 11.5564, lon: 104.9282 } },
      { id: 'DC-REP-01', name: 'Siem Reap Regional Depot', position: { lat: 13.3671, lon: 103.8448 } },
      { id: 'DC-KOS-01', name: 'Sihanoukville Coastal Cross-Dock', position: { lat: 10.6253, lon: 103.5234 } },
      { id: 'DC-BAT-01', name: 'Battambang Distribution Center', position: { lat: 13.0957, lon: 103.2022 } },
    ],
    duration_hours: 8,
    trafficEnabled: false,
    incidents: [],
  },
};

export const defaultScenario = SCENARIO_PRESETS.morning_delivery;
