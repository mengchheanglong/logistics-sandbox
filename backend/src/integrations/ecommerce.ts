/** Read-only marketplace adapter. Simulation results stay in local repositories. */

export interface EcommerceOrderItem {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  category?: string;
  weight_kg?: number;
}

export interface EcommerceProduct {
  product_id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  weight_kg: number;
}

export interface EcommerceOrder {
  order_id: string;
  customer_id?: string;
  customer_name: string;
  items: EcommerceOrderItem[];
  total: number;
  province: string;
  payment_method: string;
  status: string;
  delivery_address?: string;
  assigned_courier_id?: string;
  assigned_courier_name?: string;
}

export interface EcommerceBridgeStatus {
  enabled: boolean;
  connected: boolean;
  baseUrl: string;
  lastSyncTimestamp: number | null;
  ordersIngestedCount: number;
  telemetryPingsEmittedCount: number;
  catalogItemsCount: number;
  accessMode: 'read-only';
  egressPolicy: 'DISABLED';
}

export interface HiveProvinceRevenue {
  province: string;
  revenue: number;
  share: string;
}

export interface HiveTopCustomer {
  rank: number;
  name: string;
  city: string;
  spend: number;
  tier: string;
}

export interface HiveWarehouseAnalytics {
  success: boolean;
  warehouseEngine: string;
  storageLayer: string;
  stagingDir: string;
  format: string;
  metrics: {
    totalMonthlyOrders: number;
    activeCustomers: number;
    customerBuckets: number;
    septemberRevenue: number;
    queryLatencyMs: number;
    csvLatencyMs: number;
    speedupMultiplier: number;
    compressionRatio: number;
  };
  revenueByProvince: HiveProvinceRevenue[];
  topCustomers: HiveTopCustomer[];
  orderTiers: {
    highTier: { label: string; count: number; percentage: string };
    normalTier: { label: string; count: number; percentage: string };
  };
  pipelineStages: Array<{ stage: number; name: string; desc: string }>;
}

export interface HiveQueryResult {
  success: boolean;
  queryId: string;
  executionEngine: string;
  status: string;
  latencyMs: number;
  recordsScanned: number;
  partitionsPruned: number;
  error?: string;
}

export const FALLBACK_CAMBODIA_CATALOG: EcommerceProduct[] = [
  { product_id: 'P0874', name: 'Battambang Jasmine Fragrant Rice 5kg', category: 'Food & Groceries', price: 4.8, stock: 250, weight_kg: 5.0 },
  { product_id: 'P0875', name: 'Kampot Organic Black Pepper 250g', category: 'Food & Groceries', price: 7.5, stock: 140, weight_kg: 0.25 },
  { product_id: 'P0876', name: 'Mondulkiri Dark Roast Arabica Beans 500g', category: 'Food & Groceries', price: 9.2, stock: 95, weight_kg: 0.5 },
  { product_id: 'P0877', name: 'Wild Raw Forest Honey from Koh Kong 500ml', category: 'Food & Groceries', price: 14.0, stock: 60, weight_kg: 0.7 },
  { product_id: 'P0878', name: 'Kampot Fleur de Sel (Flower of Salt) 300g', category: 'Food & Groceries', price: 5.5, stock: 110, weight_kg: 0.3 },
  { product_id: 'P2210', name: 'Ultra Smartphone Pro Max 5G', category: 'Electronics', price: 289.0, stock: 45, weight_kg: 0.4 },
  { product_id: 'P2211', name: 'Noise-Cancelling Wireless Earbuds', category: 'Electronics', price: 65.0, stock: 80, weight_kg: 0.15 },
  { product_id: 'P2212', name: 'Curved 4K Ultra-Wide Monitor 34"', category: 'Electronics', price: 420.0, stock: 18, weight_kg: 7.5 },
  { product_id: 'P2214', name: 'Mechanical Keyboard RGB (Hot-Swap)', category: 'Electronics', price: 54.0, stock: 50, weight_kg: 0.9 },
  { product_id: 'P2215', name: 'Ultra Fast-Charging Power Bank 20,000mAh', category: 'Electronics', price: 36.0, stock: 110, weight_kg: 0.45 },
  { product_id: 'P2217', name: 'Compact 4K Foldable Drone with Gimbal', category: 'Electronics', price: 349.0, stock: 22, weight_kg: 1.2 },
  { product_id: 'P3314', name: 'Premium Linen Casual Shirt', category: 'Fashion & Apparel', price: 18.5, stock: 75, weight_kg: 0.3 },
  { product_id: 'P3315', name: 'Handwoven Silk Scarf (Krama Luxe)', category: 'Fashion & Apparel', price: 32.0, stock: 40, weight_kg: 0.2 },
  { product_id: 'P3318', name: 'Waterproof Commuter Backpack 22L', category: 'Fashion & Apparel', price: 45.0, stock: 55, weight_kg: 0.8 },
  { product_id: 'P5004', name: 'Traditional Khmer Herbal Inhaler & Balm Duo', category: 'Beauty & Wellness', price: 5.5, stock: 118, weight_kg: 0.1 },
  { product_id: 'P5005', name: 'Kampot Sea Salt Body Scrub 250g', category: 'Beauty & Wellness', price: 11.5, stock: 65, weight_kg: 0.35 },
];

export class EcommerceReadClient {
  private baseUrl: string;
  private isAvailable: boolean = false;
  private lastCheckTime: number = 0;
  private ingestedOrdersCount: number = 0;
  private catalog: EcommerceProduct[] = structuredClone(
    FALLBACK_CAMBODIA_CATALOG,
  );

  constructor(baseUrl: string = 'http://localhost:4000') {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Marketplace read URL must be HTTP(S) without credentials, query or fragment',
      );
    }
    this.baseUrl = url.href.replace(/\/+$/, '');
  }

  /**
   * Health check on ecommerce-hive-nosql API.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/products/meta/counts`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(2000),
      });
      this.isAvailable = res.ok;
      this.lastCheckTime = Date.now();
      if (this.isAvailable) {
        // Automatically sync catalog in background
        this.fetchCatalog().catch(() => {});
      }
      return this.isAvailable;
    } catch {
      this.isAvailable = false;
      this.lastCheckTime = Date.now();
      return false;
    }
  }

  /**
   * Fetch and cache products from upstream ecommerce catalog.
   */
  public async fetchCatalog(): Promise<EcommerceProduct[]> {
    if (!this.isAvailable) return structuredClone(this.catalog);
    try {
      const res = await fetch(`${this.baseUrl}/api/products`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return structuredClone(this.catalog);
      const data = await res.json();
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.products)
          ? data.products
          : [];
      if (list.length > 0) {
        this.catalog = list.map((p: any, index: number) => ({
          product_id:
            p.product_id || `P${String(index + 1000).padStart(4, '0')}`,
          name: p.name || 'Marketplace Item',
          category: p.category || 'General',
          price: Number(p.price) || 10,
          stock: p.stock !== undefined ? Number(p.stock) : 50,
          weight_kg: p.weight_kg ? Number(p.weight_kg) : this.estimateWeight(p),
        }));
      }
      return structuredClone(this.catalog);
    } catch (err) {
      console.warn(
        `[EcommerceClient] Failed to fetch catalog: ${(err as Error).message}`,
      );
      return structuredClone(this.catalog);
    }
  }

  public getCatalog(): EcommerceProduct[] {
    return structuredClone(this.catalog);
  }

  private estimateWeight(p: any): number {
    const name = (p.name || '').toLowerCase();
    if (name.includes('rice') || name.includes('5kg')) return 5.0;
    if (name.includes('monitor')) return 7.5;
    if (name.includes('drone')) return 1.2;
    if (name.includes('keyboard')) return 0.9;
    if (name.includes('backpack')) return 0.8;
    if (name.includes('honey') || name.includes('beans')) return 0.6;
    if (name.includes('power bank')) return 0.45;
    if (name.includes('phone')) return 0.35;
    if (
      name.includes('pepper') ||
      name.includes('salt') ||
      name.includes('shirt')
    )
      return 0.25;
    return 0.5;
  }

  /**
   * Read pending operational orders into the simulation.
   */
  public async fetchPendingOrders(): Promise<EcommerceOrder[]> {
    if (!this.isAvailable) return [];
    try {
      const res = await fetch(`${this.baseUrl}/api/orders`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.orders)
          ? (data as any).orders
          : Array.isArray((data as any)?.data)
            ? (data as any).data
            : [];
      return list.filter(
        (o: any) => o && (o.status === 'Pending' || o.status === 'Preparing'),
      );
    } catch (err) {
      console.warn(
        `[EcommerceClient] Failed to fetch orders: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Count orders copied into the local simulation.
   */
  public recordOrderIngested(): void {
    this.ingestedOrdersCount++;
  }

  /**
   * Fetch big-data OLAP warehouse analytics from Apache Hive reporting service.
   */
  public async fetchWarehouseAnalytics(): Promise<HiveWarehouseAnalytics | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/analytics`, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        this.isAvailable = true;
        return (await res.json()) as HiveWarehouseAnalytics;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Dispatch a HiveQL benchmark query (D1-D5) to the vectorized Tez execution engine.
   */
  public async executeHiveQuery(queryId: string): Promise<HiveQueryResult> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/analytics/query/${encodeURIComponent(queryId)}`,
        {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          signal: AbortSignal.timeout(3000),
        },
      );
      if (res.ok) {
        this.isAvailable = true;
        return (await res.json()) as HiveQueryResult;
      }
      return {
        success: false,
        queryId,
        executionEngine: 'Apache Hive 3.1.3 (Tez Vectorized Engine)',
        status: 'FAILED',
        latencyMs: 0,
        recordsScanned: 0,
        partitionsPruned: 0,
        error: `Server responded with status ${res.status}`,
      };
    } catch (err: any) {
      return {
        success: false,
        queryId,
        executionEngine: 'Apache Hive 3.1.3 (Tez Vectorized Engine)',
        status: 'OFFLINE',
        latencyMs: 0,
        recordsScanned: 0,
        partitionsPruned: 0,
        error: err.message,
      };
    }
  }

  public getStatus(): EcommerceBridgeStatus {
    return {
      accessMode: 'read-only',
      egressPolicy: 'DISABLED',
      enabled: true,
      connected: this.isAvailable,
      baseUrl: this.baseUrl,
      lastSyncTimestamp: this.lastCheckTime || null,
      ordersIngestedCount: this.ingestedOrdersCount,
      telemetryPingsEmittedCount: 0,
      catalogItemsCount: this.catalog.length,
    };
  }
}

export type MarketplaceReadAdapter = Pick<
  EcommerceReadClient,
  | 'checkHealth'
  | 'fetchCatalog'
  | 'getCatalog'
  | 'fetchPendingOrders'
  | 'recordOrderIngested'
  | 'fetchWarehouseAnalytics'
  | 'executeHiveQuery'
  | 'getStatus'
>;

// Compatibility name for existing read-only consumers. No write methods are exported.
export { EcommerceReadClient as EcommerceClient };
