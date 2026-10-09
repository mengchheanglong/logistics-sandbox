import { Coordinate, OrderPriority } from '../world/types.js';

export interface DeliveryCorridorPreset {
  id: string;
  name: string;
  description: string;
  pickup: { name: string; position: Coordinate };
  delivery: { name: string; position: Coordinate };
  suggestedPriority: OrderPriority;
  defaultSlaMin: number;
  tags: string[];
}

export const DELIVERY_CORRIDOR_PRESETS: DeliveryCorridorPreset[] = [
  {
    id: 'pp-depot-a-to-st271',
    name: 'Depot A → St 271 (Meanchey)',
    description: 'Central Market Depot A to St 271 south artery (Boeung Tumpun) • ~6.8 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'St 271 (Boeung Tumpun)', position: { lat: 11.5305, lon: 104.9085 } },
    suggestedPriority: 'urgent',
    defaultSlaMin: 15,
    tags: ['Ring Road', 'South Corridor', 'Urgent Blitz'],
  },
  {
    id: 'pp-depot-a-to-bkk1',
    name: 'Depot A → BKK1 (Pasteur)',
    description: 'Central Market Depot A to Pasteur / St 51 in BKK1 residential zone • ~2.1 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'BKK1 / Pasteur (St 51)', position: { lat: 11.5528, lon: 104.9282 } },
    suggestedPriority: 'express',
    defaultSlaMin: 30,
    tags: ['Commercial', 'Monivong Corridor', 'High Density'],
  },
  {
    id: 'pp-depot-b-to-tuolkork',
    name: 'Depot B → Tuol Kork (TK Ave)',
    description: 'Russian Market Depot B to Tuol Kork commercial center (St 289) • ~5.2 km',
    pickup: { name: 'Russian Market Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Tuol Kork (TK Ave St 289)', position: { lat: 11.5732, lon: 104.8984 } },
    suggestedPriority: 'express',
    defaultSlaMin: 35,
    tags: ['Cross-town', 'Mao Tse Toung', 'Tech District'],
  },
  {
    id: 'pp-hub-to-riverside',
    name: 'Central Hub → Riverside Quay',
    description: 'Bak Touk Central Hub to Sisowath Quay riverfront promenade • ~2.4 km',
    pickup: { name: 'Bak Touk Central Hub', position: { lat: 11.5621, lon: 104.9160 } },
    delivery: { name: 'Riverside (Sisowath Quay)', position: { lat: 11.5695, lon: 104.9312 } },
    suggestedPriority: 'urgent',
    defaultSlaMin: 20,
    tags: ['Riverfront', 'Tourist Hub', 'Waterfront'],
  },
  {
    id: 'pp-depot-a-to-sensok',
    name: 'Depot A → Sen Sok (AEON 2)',
    description: 'Central Market Depot A along Russian Blvd to AEON Mall 2 in Sen Sok • ~6.4 km',
    pickup: { name: 'Central Market Depot A', position: { lat: 11.5680, lon: 104.9223 } },
    delivery: { name: 'Sen Sok (AEON Mall 2)', position: { lat: 11.5850, lon: 104.8820 } },
    suggestedPriority: 'standard',
    defaultSlaMin: 45,
    tags: ['Northwest', 'Russian Blvd', 'Suburban Mall'],
  },
  {
    id: 'pp-depot-b-to-norodom',
    name: 'Depot B → Independence Monument',
    description: 'Russian Market Depot B north along Mao Tse Toung to Norodom Blvd • ~2.3 km',
    pickup: { name: 'Russian Market Depot B', position: { lat: 11.5435, lon: 104.9142 } },
    delivery: { name: 'Independence Monument / Norodom', position: { lat: 11.5564, lon: 104.9282 } },
    suggestedPriority: 'express',
    defaultSlaMin: 25,
    tags: ['Diplomatic', 'Norodom Blvd', 'City Center'],
  },
];
