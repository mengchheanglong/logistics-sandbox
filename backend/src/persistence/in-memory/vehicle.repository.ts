/**
 * @fileoverview In-Memory Vehicle State Repository.
 */

import { Vehicle } from '../../world/types.js';
import { IVehicleRepository } from '../types.js';

export class InMemoryVehicleRepository implements IVehicleRepository {
  private vehicles: Map<string, Vehicle> = new Map();

  public async saveVehicleState(vehicle: Vehicle): Promise<void> {
    this.vehicles.set(vehicle.id, { ...vehicle });
  }

  public async getVehicleState(id: string): Promise<Vehicle | null> {
    const v = this.vehicles.get(id);
    return v ? { ...v } : null;
  }

  public async getAllVehicleStates(): Promise<Vehicle[]> {
    return Array.from(this.vehicles.values()).map(v => ({ ...v }));
  }

  public getStatus() {
    return {
      driver: 'in-memory (key-value store)',
      healthy: true,
      vehicleCount: this.vehicles.size,
    };
  }
}
