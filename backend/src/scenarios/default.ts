/**
 * @fileoverview Default scenario configuration for Phnom Penh.
 */

import { ScenarioConfig } from '../world/types.js';

export const defaultScenario: ScenarioConfig = {
  name: 'Phnom Penh Morning Delivery',
  seed: 42,
  city: 'Phnom Penh, Cambodia',
  bounds: { north: 11.60, south: 11.52, east: 104.96, west: 104.88 },
  vehicleCount: 30,
  orderCount: 200,
  depots: [
    { id: 'depot-a', name: 'Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    { id: 'depot-b', name: 'Depot B', position: { lat: 11.5490, lon: 104.9280 } }
  ],
  duration_hours: 8,
  trafficEnabled: false,
  incidents: []
};
