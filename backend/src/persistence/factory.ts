/**
 * @fileoverview Persistence Layer Factory.
 *
 * Creates local simulation repositories. Remote drivers fail closed.
 */

import { IPersistenceLayer } from './types.js';
import { InMemoryTelemetryRepository } from './in-memory/telemetry.repository.js';
import { InMemoryOrderRepository } from './in-memory/order.repository.js';
import { InMemoryVehicleRepository } from './in-memory/vehicle.repository.js';
import { InMemoryScenarioRepository } from './in-memory/scenario.repository.js';
import { InMemoryRelationshipRepository } from './in-memory/relationship.repository.js';

export function createPersistenceLayer(
  driverType: string = process.env.PERSISTENCE_DRIVER || 'in-memory',
): IPersistenceLayer {
  if (driverType !== 'in-memory') {
    throw new Error(
      `Simulation persistence must be in-memory; remote driver "${driverType}" is disabled`,
    );
  }
  const telemetry = new InMemoryTelemetryRepository();
  const orders = new InMemoryOrderRepository();
  const vehicles = new InMemoryVehicleRepository();
  const scenarios = new InMemoryScenarioRepository();
  const relationships = new InMemoryRelationshipRepository();

  return {
    telemetry,
    orders,
    vehicles,
    scenarios,
    relationships,
    driverType: 'in-memory',
    getStatus() {
      return {
        driverType: 'in-memory',
        telemetry: telemetry.getStatus(),
        orders: orders.getStatus(),
        vehicles: vehicles.getStatus(),
        scenarios: scenarios.getStatus(),
        relationships: relationships.getStatus(),
      };
    },
  };
}
