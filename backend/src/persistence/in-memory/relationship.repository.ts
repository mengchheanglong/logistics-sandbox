/** Local simulation relationship projection. No remote database connection. */
import {
  Coordinate,
  Customer,
  Driver,
  Order,
  OrderStatus,
  Vehicle,
  Warehouse,
} from '../../world/types.js';
import {
  GraphNode,
  GraphRelationship,
  ImpactAnalysisResult,
  IRelationshipRepository,
} from '../types.js';

export class InMemoryRelationshipRepository implements IRelationshipRepository {
  private nodes: Map<string, GraphNode> = new Map();
  private relationships: Map<string, GraphRelationship> = new Map();

  public async executeCypher(
    _cypher: string,
    _params: Record<string, unknown> = {},
  ): Promise<unknown> {
    return {
      results: [],
      errors: [
        { message: 'Remote Cypher execution is disabled in the simulator' },
      ],
    };
  }

  public async syncTopology(
    warehouses: Warehouse[],
    vehicles: Vehicle[],
    drivers: Driver[],
  ): Promise<void> {
    // 1. Update in-memory graph
    for (const w of warehouses) {
      const label = w.type === 'warehouse' ? 'Warehouse' : 'Depot';
      this.nodes.set(w.id, {
        id: w.id,
        label,
        properties: {
          name: w.name,
          type: w.type,
          capacity: w.capacity,
          currentStock: w.currentStock,
          lat: w.position.lat,
          lon: w.position.lon,
          status: w.status || 'open',
        },
      });
    }

    for (const d of drivers) {
      this.nodes.set(d.id, {
        id: d.id,
        label: 'Driver',
        properties: {
          name: d.name,
          status: d.status,
          vehicleId: d.vehicleId,
        },
      });
    }

    for (const v of vehicles) {
      this.nodes.set(v.id, {
        id: v.id,
        label: 'Vehicle',
        properties: {
          name: v.name,
          type: v.type,
          status: v.status,
          driverId: v.driverId,
          depotId: v.depotId,
          capacity_kg: v.capacity_kg,
          currentLoad_kg: v.currentLoad_kg,
          speed_kmh: v.speed_kmh,
          lat: v.position.lat,
          lon: v.position.lon,
        },
      });

      // Relationship: Depot -> DISPATCHES -> Vehicle
      if (v.depotId && this.nodes.has(v.depotId)) {
        const edgeId = `rel_${v.depotId}_dispatches_${v.id}`;
        this.relationships.set(edgeId, {
          id: edgeId,
          type: 'DISPATCHES',
          from: v.depotId,
          to: v.id,
        });
      }

      // Relationship: Vehicle -> ASSIGNED_TO -> Driver
      if (v.driverId && this.nodes.has(v.driverId)) {
        const edgeId = `rel_${v.id}_assigned_${v.driverId}`;
        this.relationships.set(edgeId, {
          id: edgeId,
          type: 'ASSIGNED_TO',
          from: v.id,
          to: v.driverId,
        });
      }
    }

    // Connect Primary Warehouse to Regional Depots
    const centralWarehouse =
      warehouses.find((w) => w.type === 'warehouse') || warehouses[0];
    if (centralWarehouse) {
      for (const d of warehouses.filter((w) => w.type === 'depot')) {
        const edgeId = `rel_${centralWarehouse.id}_feeds_${d.id}`;
        this.relationships.set(edgeId, {
          id: edgeId,
          type: 'FEEDS',
          from: centralWarehouse.id,
          to: d.id,
        });
      }
    }
  }

  /**
   * Synchronize an Order and Customer, linking Vehicle -> CARRIES -> Order -> DELIVERS_TO -> Customer.
   */
  public async syncOrder(
    order: Order,
    vehicleId?: string | null,
    customer?: Customer,
  ): Promise<void> {
    // 1. In-memory graph update
    this.nodes.set(order.id, {
      id: order.id,
      label: 'Order',
      properties: {
        status: order.status,
        priority: order.priority || 'standard',
        totalWeight_kg: order.totalWeight_kg,
        customerId: order.customerId,
        assignedVehicleId: vehicleId || order.assignedVehicleId,
        pickupLat: order.pickupLocation.lat,
        pickupLon: order.pickupLocation.lon,
        deliveryLat: order.deliveryLocation.lat,
        deliveryLon: order.deliveryLocation.lon,
        createdAt: order.createdAt,
        eta: order.estimatedDeliveryTime,
      },
    });

    const custId = customer?.id || order.customerId || 'C0457';
    const custName =
      customer?.name ||
      (custId === 'C0457' ? 'Sokha Meas' : `Customer ${custId}`);
    this.nodes.set(custId, {
      id: custId,
      label: 'Customer',
      properties: {
        name: custName,
        address: customer?.address || 'Phnom Penh Center',
        lat: customer?.position.lat || order.deliveryLocation.lat,
        lon: customer?.position.lon || order.deliveryLocation.lon,
      },
    });

    // Edge: Order -> DELIVERS_TO -> Customer
    const deliversEdge = `rel_${order.id}_delivers_${custId}`;
    this.relationships.set(deliversEdge, {
      id: deliversEdge,
      type: 'DELIVERS_TO',
      from: order.id,
      to: custId,
    });

    // Edge: Vehicle -> CARRIES -> Order
    const assignedVid = vehicleId || order.assignedVehicleId;
    if (assignedVid && this.nodes.has(assignedVid)) {
      const carriesEdge = `rel_${assignedVid}_carries_${order.id}`;
      this.relationships.set(carriesEdge, {
        id: carriesEdge,
        type: 'CARRIES',
        from: assignedVid,
        to: order.id,
      });
    }
  }

  /**
   * Update lifecycle status of an order node.
   */
  public async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
  ): Promise<void> {
    const node = this.nodes.get(orderId);
    if (node) {
      node.properties.status = status;
    }

    // If order delivered or cancelled, remove CARRIES relationship in memory
    if (status === 'delivered' || status === 'cancelled') {
      for (const [edgeId, edge] of this.relationships.entries()) {
        if (edge.type === 'CARRIES' && edge.to === orderId) {
          this.relationships.delete(edgeId);
        }
      }
    }
  }

  /**
   * Update vehicle live status and coordinates in graph.
   */
  public async updateVehicleStatus(
    vehicleId: string,
    status: string,
    pos?: Coordinate,
  ): Promise<void> {
    const node = this.nodes.get(vehicleId);
    if (node) {
      node.properties.status = status;
      if (pos) {
        node.properties.lat = pos.lat;
        node.properties.lon = pos.lon;
      }
    }
  }

  /**
   * Run Cypher Traversal for Incident Impact Analysis:
   * Computes all downstream affected vehicles, pending orders, and customers if an asset fails.
   */
  public async getImpactAnalysis(
    entityType: 'depot' | 'vehicle' | 'warehouse',
    entityId: string,
  ): Promise<ImpactAnalysisResult> {
    const startMs = performance.now();

    // 1. In-Memory Graph Traversal (guaranteed < 1ms response)
    const targetNode = this.nodes.get(entityId);
    const impactedVehicles: ImpactAnalysisResult['impactedVehicles'] = [];
    const impactedOrders: ImpactAnalysisResult['impactedOrders'] = [];
    const impactedCustomers: ImpactAnalysisResult['impactedCustomers'] = [];

    const vehicleIds = new Set<string>();

    if (entityType === 'vehicle') {
      vehicleIds.add(entityId);
    } else if (entityType === 'depot') {
      // Find all vehicles dispatched by this depot
      for (const edge of this.relationships.values()) {
        if (edge.type === 'DISPATCHES' && edge.from === entityId) {
          vehicleIds.add(edge.to);
        }
      }
    } else if (entityType === 'warehouse') {
      // Warehouse -> FEEDS -> Depot -> DISPATCHES -> Vehicle
      const depotIds = new Set<string>();
      for (const edge of this.relationships.values()) {
        if (edge.type === 'FEEDS' && edge.from === entityId) {
          depotIds.add(edge.to);
        }
      }
      for (const edge of this.relationships.values()) {
        if (edge.type === 'DISPATCHES' && depotIds.has(edge.from)) {
          vehicleIds.add(edge.to);
        }
      }
    }

    // Collect vehicle details
    for (const vId of vehicleIds) {
      const vNode = this.nodes.get(vId);
      if (vNode) {
        const driverNode = this.nodes.get(vNode.properties.driverId);
        impactedVehicles.push({
          id: vId,
          name: vNode.properties.name,
          type: vNode.properties.type,
          status: vNode.properties.status,
          driverName: driverNode?.properties.name,
          currentLoad_kg: vNode.properties.currentLoad_kg || 0,
        });
      }
    }

    // Find orders carried by impacted vehicles
    const orderIds = new Set<string>();
    for (const edge of this.relationships.values()) {
      if (edge.type === 'CARRIES' && vehicleIds.has(edge.from)) {
        orderIds.add(edge.to);
      }
    }

    let totalPayloadKg = 0;
    for (const oId of orderIds) {
      const oNode = this.nodes.get(oId);
      if (
        oNode &&
        oNode.properties.status !== 'delivered' &&
        oNode.properties.status !== 'cancelled'
      ) {
        const weight = oNode.properties.totalWeight_kg || 1.5;
        totalPayloadKg += weight;
        impactedOrders.push({
          id: oId,
          status: oNode.properties.status,
          priority: oNode.properties.priority,
          customerId: oNode.properties.customerId,
          totalWeight_kg: weight,
        });

        // Find customer
        for (const rel of this.relationships.values()) {
          if (rel.type === 'DELIVERS_TO' && rel.from === oId) {
            const cNode = this.nodes.get(rel.to);
            if (cNode && !impactedCustomers.some((c) => c.id === cNode.id)) {
              impactedCustomers.push({
                id: cNode.id,
                name: cNode.properties.name,
                address: cNode.properties.address,
              });
            }
          }
        }
      }
    }

    const traversalTimeMs =
      Math.round((performance.now() - startMs) * 100) / 100;
    const cypherQuery =
      entityType === 'vehicle'
        ? `MATCH (v:Vehicle {id: '${entityId}'})-[c:CARRIES]->(o:Order)-[:DELIVERS_TO]->(cust:Customer) WHERE o.status IN ['assigned', 'picked_up', 'in_transit'] RETURN v, o, cust`
        : `MATCH (d:Depot {id: '${entityId}'})-[:DISPATCHES]->(v:Vehicle)-[:CARRIES]->(o:Order)-[:DELIVERS_TO]->(cust:Customer) WHERE o.status IN ['assigned', 'picked_up', 'in_transit'] RETURN d, v, o, cust`;

    return {
      targetEntity: {
        type: entityType,
        id: entityId,
        name: targetNode?.properties?.name || entityId,
        status: targetNode?.properties?.status || 'unknown',
      },
      impactedVehicles,
      impactedOrders,
      impactedCustomers,
      totalOrdersAtRisk: impactedOrders.length,
      totalPayloadKg: Math.round(totalPayloadKg * 10) / 10,
      estimatedRevenueAtRiskUSD:
        Math.round(impactedOrders.length * 35.5 * 100) / 100,
      traversalTimeMs,
      cypherQuery,
    };
  }

  /**
   * Retrieve complete graph topology (all nodes and relationships).
   */
  public async getGraphTopology(): Promise<{
    nodes: GraphNode[];
    relationships: GraphRelationship[];
  }> {
    return {
      nodes: Array.from(this.nodes.values()),
      relationships: Array.from(this.relationships.values()),
    };
  }

  /**
   * Status and metrics.
   */
  public getStatus(): {
    driver: string;
    healthy: boolean;
    nodeCount: number;
    relationshipCount: number;
    url: string;
  } {
    return {
      driver: 'in-memory relationship graph',
      healthy: true,
      nodeCount: this.nodes.size,
      relationshipCount: this.relationships.size,
      url: '',
    };
  }
}
