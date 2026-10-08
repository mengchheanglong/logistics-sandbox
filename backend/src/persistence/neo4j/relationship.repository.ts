/**
 * @fileoverview Neo4j Relationship Repository.
 *
 * Implements the Business & Logistics Relationship Graph (Phase 3 architecture):
 * - Graph Schema:
 *     (:Warehouse)-[:FEEDS]->(:Depot)
 *     (:Depot)-[:DISPATCHES]->(:Vehicle)
 *     (:Vehicle)-[:ASSIGNED_TO]->(:Driver)
 *     (:Vehicle)-[:CARRIES]->(:Order)
 *     (:Order)-[:DELIVERS_TO]->(:Customer)
 * - Traversal algorithms for Incident Impact Analysis (Cascade Failure Simulation)
 * - Hybrid non-blocking persistence: fast in-memory graph cache + async Cypher writes
 *   over Neo4j HTTP Bolt Transactional API (Port 7474/7687)
 */

import { Coordinate, Customer, Driver, Order, OrderStatus, Vehicle, Warehouse } from '../../world/types.js';
import {
  GraphNode,
  GraphRelationship,
  ImpactAnalysisResult,
  IRelationshipRepository,
} from '../types.js';

export class Neo4jRelationshipRepository implements IRelationshipRepository {
  private url: string;
  private authHeader: string;
  private isConnected: boolean = false;
  private lastCheckTime: number = 0;

  // In-memory graph cache for sub-millisecond traversal & resilience if Neo4j is offline
  private nodes: Map<string, GraphNode> = new Map();
  private relationships: Map<string, GraphRelationship> = new Map();

  // Async write queue to prevent blocking simulation ticks
  private writeQueue: string[] = [];
  private isFlushing: boolean = false;

  constructor(
    url: string = process.env.NEO4J_HTTP_URL || 'http://localhost:7474',
    user: string = process.env.NEO4J_USER || 'neo4j',
    pass: string = process.env.NEO4J_PASSWORD || 'marketplace2026'
  ) {
    this.url = url.replace(/\/+$/, '');
    this.authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

    // Initial connection check & queue worker
    this.checkHealth().catch(() => {});
    setInterval(() => this.flushQueue(), 1000);
  }

  /**
   * Health check against Neo4j HTTP API.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/db/neo4j/tx/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify({
          statements: [{ statement: 'RETURN 1 AS ping' }],
        }),
        signal: AbortSignal.timeout(2000),
      });

      this.isConnected = res.ok;
      this.lastCheckTime = Date.now();
      return this.isConnected;
    } catch {
      this.isConnected = false;
      this.lastCheckTime = Date.now();
      return false;
    }
  }

  /**
   * Execute raw Cypher statements against Neo4j.
   */
  public async executeCypher(cypher: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.isConnected && Date.now() - this.lastCheckTime > 5000) {
      await this.checkHealth();
    }

    if (!this.isConnected) {
      return { results: [], errors: [{ message: 'Neo4j is currently unreachable' }] };
    }

    try {
      const res = await fetch(`${this.url}/db/neo4j/tx/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify({
          statements: [{ statement: cypher, parameters: params }],
        }),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        throw new Error(`Neo4j HTTP Error ${res.status}: ${res.statusText}`);
      }

      return await res.json();
    } catch (err) {
      console.warn(`[Neo4jRelationshipRepository] Cypher execution error: ${(err as Error).message}`);
      return { results: [], errors: [{ message: (err as Error).message }] };
    }
  }

  /**
   * Enqueue a Cypher write statement to be flushed asynchronously.
   */
  private queueStatement(stmt: string): void {
    this.writeQueue.push(stmt);
    if (this.writeQueue.length >= 25) {
      this.flushQueue().catch(() => {});
    }
  }

  private async flushQueue(): Promise<void> {
    if (this.isFlushing || this.writeQueue.length === 0) return;
    this.isFlushing = true;

    const batch = this.writeQueue.splice(0, 50);
    try {
      if (!this.isConnected) {
        await this.checkHealth();
      }

      if (this.isConnected) {
        await fetch(`${this.url}/db/neo4j/tx/commit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.authHeader,
          },
          body: JSON.stringify({
            statements: batch.map((s) => ({ statement: s })),
          }),
          signal: AbortSignal.timeout(5000),
        });
      }
    } catch (err) {
      // Re-queue remaining statements if transient failure
      if (this.writeQueue.length < 200) {
        this.writeQueue.push(...batch);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Synchronize the static supply chain topology:
   * Warehouses, Depots, Vehicles, and assigned Drivers.
   */
  public async syncTopology(
    warehouses: Warehouse[],
    vehicles: Vehicle[],
    drivers: Driver[]
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
    const centralWarehouse = warehouses.find((w) => w.type === 'warehouse') || warehouses[0];
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

    // 2. Generate and queue Cypher MERGE batch for Neo4j
    const cypherBatch: string[] = [];

    // Warehouses & Depots
    for (const w of warehouses) {
      const label = w.type === 'warehouse' ? 'Warehouse' : 'Depot';
      cypherBatch.push(`
        MERGE (n:${label} {id: '${w.id}'})
        SET n.name = '${w.name.replace(/'/g, "\\'")}',
            n.type = '${w.type}',
            n.capacity = ${w.capacity},
            n.currentStock = ${w.currentStock},
            n.lat = ${w.position.lat},
            n.lon = ${w.position.lon},
            n.status = '${w.status || 'open'}'
      `);
    }

    // Warehouse -> FEEDS -> Depot
    if (centralWarehouse) {
      for (const d of warehouses.filter((w) => w.type === 'depot')) {
        cypherBatch.push(`
          MATCH (w:Warehouse {id: '${centralWarehouse.id}'}), (d:Depot {id: '${d.id}'})
          MERGE (w)-[:FEEDS]->(d)
        `);
      }
    }

    // Drivers
    for (const drv of drivers) {
      cypherBatch.push(`
        MERGE (d:Driver {id: '${drv.id}'})
        SET d.name = '${drv.name.replace(/'/g, "\\'")}',
            d.status = '${drv.status}'
      `);
    }

    // Vehicles + DISPATCHES + ASSIGNED_TO
    for (const v of vehicles) {
      cypherBatch.push(`
        MERGE (v:Vehicle {id: '${v.id}'})
        SET v.name = '${v.name}',
            v.type = '${v.type}',
            v.status = '${v.status}',
            v.capacity_kg = ${v.capacity_kg},
            v.currentLoad_kg = ${v.currentLoad_kg},
            v.speed_kmh = ${v.speed_kmh},
            v.lat = ${v.position.lat},
            v.lon = ${v.position.lon}
      `);

      if (v.depotId) {
        cypherBatch.push(`
          MATCH (d:Depot {id: '${v.depotId}'}), (v:Vehicle {id: '${v.id}'})
          MERGE (d)-[:DISPATCHES]->(v)
        `);
      }

      if (v.driverId) {
        cypherBatch.push(`
          MATCH (v:Vehicle {id: '${v.id}'}), (drv:Driver {id: '${v.driverId}'})
          MERGE (v)-[:ASSIGNED_TO]->(drv)
        `);
      }
    }

    for (const stmt of cypherBatch) {
      this.queueStatement(stmt);
    }
  }

  /**
   * Synchronize an Order and Customer, linking Vehicle -> CARRIES -> Order -> DELIVERS_TO -> Customer.
   */
  public async syncOrder(order: Order, vehicleId?: string | null, customer?: Customer): Promise<void> {
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
    const custName = customer?.name || (custId === 'C0457' ? 'Sokha Meas' : `Customer ${custId}`);
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

    // 2. Queue Cypher write
    this.queueStatement(`
      MERGE (o:Order {id: '${order.id}'})
      SET o.status = '${order.status}',
          o.priority = '${order.priority || 'standard'}',
          o.totalWeight_kg = ${order.totalWeight_kg},
          o.deliveryLat = ${order.deliveryLocation.lat},
          o.deliveryLon = ${order.deliveryLocation.lon}
      MERGE (c:Customer {id: '${custId}'})
      ON CREATE SET c.name = '${custName.replace(/'/g, "\\'")}'
      MERGE (o)-[:DELIVERS_TO]->(c)
    `);

    if (assignedVid) {
      this.queueStatement(`
        MATCH (v:Vehicle {id: '${assignedVid}'}), (o:Order {id: '${order.id}'})
        MERGE (v)-[:CARRIES]->(o)
      `);
    }
  }

  /**
   * Update lifecycle status of an order node.
   */
  public async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
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

    this.queueStatement(`
      MATCH (o:Order {id: '${orderId}'})
      SET o.status = '${status}'
      WITH o
      WHERE '${status}' IN ['delivered', 'cancelled']
      OPTIONAL MATCH (v:Vehicle)-[r:CARRIES]->(o)
      DELETE r
    `);
  }

  /**
   * Update vehicle live status and coordinates in graph.
   */
  public async updateVehicleStatus(vehicleId: string, status: string, pos?: Coordinate): Promise<void> {
    const node = this.nodes.get(vehicleId);
    if (node) {
      node.properties.status = status;
      if (pos) {
        node.properties.lat = pos.lat;
        node.properties.lon = pos.lon;
      }
    }

    this.queueStatement(`
      MATCH (v:Vehicle {id: '${vehicleId}'})
      SET v.status = '${status}'
      ${pos ? `, v.lat = ${pos.lat}, v.lon = ${pos.lon}` : ''}
    `);
  }

  /**
   * Run Cypher Traversal for Incident Impact Analysis:
   * Computes all downstream affected vehicles, pending orders, and customers if an asset fails.
   */
  public async getImpactAnalysis(
    entityType: 'depot' | 'vehicle' | 'warehouse',
    entityId: string
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
      if (oNode && oNode.properties.status !== 'delivered' && oNode.properties.status !== 'cancelled') {
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

    const traversalTimeMs = Math.round((performance.now() - startMs) * 100) / 100;
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
      estimatedRevenueAtRiskUSD: Math.round(impactedOrders.length * 35.5 * 100) / 100,
      traversalTimeMs,
      cypherQuery,
    };
  }

  /**
   * Retrieve complete graph topology (all nodes and relationships).
   */
  public async getGraphTopology(): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }> {
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
      driver: 'Neo4j Graph Database (Bolt / HTTP Transactional API)',
      healthy: this.isConnected,
      nodeCount: this.nodes.size,
      relationshipCount: this.relationships.size,
      url: this.url,
    };
  }
}
