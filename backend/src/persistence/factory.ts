/**
 * @fileoverview Persistence Layer Factory.
 *
 * Instantiates the appropriate polyglot storage adapters based on configuration
 * or environment variables.
 */

import {
  IPersistenceLayer,
  ITelemetryRepository,
  IOrderRepository,
  IVehicleRepository,
  IScenarioRepository,
} from './types.js';
import { InMemoryTelemetryRepository } from './in-memory/telemetry.repository.js';
import { InMemoryOrderRepository } from './in-memory/order.repository.js';
import { InMemoryVehicleRepository } from './in-memory/vehicle.repository.js';
import { InMemoryScenarioRepository } from './in-memory/scenario.repository.js';
import { CassandraTelemetryRepository } from './cassandra/telemetry.repository.js';
import { MongoOrderRepository } from './mongodb/order.repository.js';
import { Neo4jRelationshipRepository } from './neo4j/relationship.repository.js';

export function createPersistenceLayer(
  driverType: 'in-memory' | 'cassandra' | 'mongodb' | 'polyglot' = (process.env.PERSISTENCE_DRIVER as any) || 'polyglot'
): IPersistenceLayer {
  let telemetry: ITelemetryRepository;
  let orders: IOrderRepository;
  const vehicles: IVehicleRepository = new InMemoryVehicleRepository();
  const scenarios: IScenarioRepository = new InMemoryScenarioRepository();
  const relationships = new Neo4jRelationshipRepository();

  switch (driverType) {
    case 'cassandra':
      telemetry = new CassandraTelemetryRepository();
      orders = new InMemoryOrderRepository();
      break;

    case 'mongodb':
      telemetry = new InMemoryTelemetryRepository();
      orders = new MongoOrderRepository();
      break;

    case 'polyglot':
      // Best-of-both-worlds: Cassandra wide-column telemetry + MongoDB document orders
      telemetry = new CassandraTelemetryRepository();
      orders = new MongoOrderRepository();
      break;

    case 'in-memory':
    default:
      telemetry = new InMemoryTelemetryRepository();
      orders = new InMemoryOrderRepository();
      break;
  }

  return {
    telemetry,
    orders,
    vehicles,
    scenarios,
    relationships,
    driverType,
    getStatus() {
      return {
        driverType,
        telemetry: telemetry.getStatus(),
        orders: orders.getStatus(),
        vehicles: vehicles.getStatus(),
        scenarios: scenarios.getStatus(),
        relationships: relationships.getStatus(),
      };
    },
  };
}
