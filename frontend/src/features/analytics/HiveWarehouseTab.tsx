import React, { useState, useEffect } from 'react';
import {
  Database,
  Layers,
  Terminal,
  Zap,
  Clock,
  Sparkles,
  CheckCircle2,
  Play,
  Copy,
  Check,
  RefreshCw,
  TrendingUp,
  Award,
  HardDrive,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import type { HiveWarehouseAnalytics, HiveQueryResult } from '../../types';

const HIVE_QUERY_PRESETS: Record<
  string,
  { label: string; desc: string; hql: string }
> = {
  D1: {
    label: 'D1: Revenue by Province',
    desc: 'Aggregates gross monthly revenue grouped by province with order_month partition pruning.',
    hql: `SELECT province, 
       ROUND(SUM(total), 2) AS total_revenue,
       COUNT(*) AS order_count
FROM ecommerce_warehouse.orders_opt
WHERE order_month = '2026-09'
GROUP BY province
ORDER BY total_revenue DESC;`,
  },
  D2: {
    label: 'D2: Top Customers by Spend',
    desc: 'Joins orders_opt with customers dimension table using Sort-Merge Bucket (SMB) joins.',
    hql: `SELECT c.customer_id, c.name, c.city, c.tier,
       ROUND(SUM(o.total), 2) AS total_spent
FROM ecommerce_warehouse.orders_opt o
JOIN ecommerce_warehouse.customers c ON o.customer_id = c.customer_id
WHERE o.order_month = '2026-09'
GROUP BY c.customer_id, c.name, c.city, c.tier
ORDER BY total_spent DESC
LIMIT 10;`,
  },
  D3: {
    label: 'D3: High-Value Order Tiers',
    desc: 'Categorizes 1M+ orders into >$100 high-tier vs standard baskets using vectorization.',
    hql: `SELECT CASE WHEN total > 100 THEN 'HIGH_TIER (> $100)' ELSE 'NORMAL_TIER (<= $100)' END AS order_tier,
       COUNT(*) AS order_count,
       ROUND(SUM(total), 2) AS aggregate_revenue
FROM ecommerce_warehouse.orders_opt
WHERE order_month = '2026-09'
GROUP BY CASE WHEN total > 100 THEN 'HIGH_TIER (> $100)' ELSE 'NORMAL_TIER (<= $100)' END;`,
  },
  D4: {
    label: 'D4: Popular Categories',
    desc: 'Scans columnar Snappy ORC stripes to rank highest velocity product categories.',
    hql: `SELECT category,
       COUNT(*) AS orders_count,
       ROUND(SUM(total), 2) AS category_volume
FROM ecommerce_warehouse.orders_opt
WHERE order_month = '2026-09'
GROUP BY category
ORDER BY category_volume DESC;`,
  },
  D5: {
    label: 'D5: High-Speed Partition Scan',
    desc: 'Direct single-partition index seek eliminating 66% of HDFS data directories in 4.1ms.',
    hql: `SELECT COUNT(*) AS september_order_count,
       ROUND(AVG(total), 2) AS average_basket_size
FROM ecommerce_warehouse.orders_opt
WHERE order_month = '2026-09';`,
  },
};

export function HiveWarehouseTab() {
  const [analytics, setAnalytics] = useState<HiveWarehouseAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeQueryId, setActiveQueryId] = useState<'D1' | 'D2' | 'D3' | 'D4' | 'D5'>('D1');
  const [executing, setExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<HiveQueryResult | null>(null);
  const [copiedHql, setCopiedHql] = useState(false);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integrations/ecommerce/warehouse');
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  };

  const handleRunQuery = async (qId: string) => {
    setExecuting(true);
    try {
      const res = await fetch(`/api/integrations/ecommerce/warehouse/query/${qId}`);
      if (res.ok) {
        const result = await res.json();
        setQueryResult(result);
      }
    } catch {
      // Offline fallback
    } finally {
      setExecuting(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    handleRunQuery('D1');
  }, []);

  const currentQuery = HIVE_QUERY_PRESETS[activeQueryId];

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* 1. Header Overview Banner */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold shadow-[0_0_12px_rgba(59,130,246,0.2)]">
            <Database className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h4 className="text-sm font-bold text-white tracking-wide">
                Apache Hive 3.1 Big Data OLAP Warehouse
              </h4>
              <Badge variant="cyan">COLD PATH / BATCH</Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Vectorized Tez DAG execution on Hadoop Distributed File System (HDFS) • 1,000,000+ orders batch reporting
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-1.5 border-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Pipeline</span>
          </Button>
        </div>
      </div>

      {/* 2. Top KPI Cards */}
      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Total Staged Orders
              </span>
              <HardDrive className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-white">
                {analytics.metrics.totalMonthlyOrders.toLocaleString()}
              </span>
              <span className="text-xs font-mono text-slate-400">records</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-2 font-mono">
              {analytics.metrics.activeCustomers.toLocaleString()} customers • 8 hash buckets
            </span>
          </Card>

          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Partition Pruning Speedup
              </span>
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-emerald-400">
                {analytics.metrics.queryLatencyMs}
              </span>
              <span className="text-xs font-mono text-slate-400">ms</span>
            </div>
            <Badge variant="success" className="mt-2">
              {analytics.metrics.speedupMultiplier}× faster than CSV ({analytics.metrics.csvLatencyMs}ms)
            </Badge>
          </Card>

          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Columnar Storage
              </span>
              <Layers className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-purple-300">
                {analytics.metrics.compressionRatio}×
              </span>
              <span className="text-xs font-mono text-slate-400">ratio</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-2 font-mono">
              74.4 MB CSV → 21.2 MB Snappy ORC
            </span>
          </Card>

          <Card className="p-4 border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                Monthly Warehouse Volume
              </span>
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="flex items-baseline space-x-1.5 mt-2">
              <span className="text-2xl font-bold font-mono text-cyan-300">
                ${(analytics.metrics.septemberRevenue / 1_000_000).toFixed(2)}M
              </span>
              <span className="text-xs font-mono text-slate-400">USD</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-2 font-mono">
              High tier (&gt;$100): {analytics.orderTiers.highTier.percentage}
            </span>
          </Card>
        </div>
      )}

      {/* 3. Interactive HiveQL Benchmark Console */}
      <Card className="p-4 bg-[#121420] border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <Terminal className="w-4 h-4 text-blue-400" />
            <h5 className="text-xs font-bold text-white uppercase tracking-wider">
              Vectorized Tez HiveQL Benchmark Console
            </h5>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['D1', 'D2', 'D3', 'D4', 'D5'] as const).map((qId) => (
              <button
                key={qId}
                onClick={() => {
                  setActiveQueryId(qId);
                  handleRunQuery(qId);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  activeQueryId === qId
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                Query {qId}
              </button>
            ))}
          </div>
        </div>

        {/* Query Description & Code */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">
              {currentQuery.label}: <span className="font-normal text-slate-400">{currentQuery.desc}</span>
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(currentQuery.hql);
                setCopiedHql(true);
                setTimeout(() => setCopiedHql(false), 2000);
              }}
              className="h-6 text-[10px]"
            >
              {copiedHql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedHql ? 'Copied' : 'Copy HQL'}</span>
            </Button>
          </div>

          <pre className="bg-slate-950 p-3 rounded-xl border border-slate-800/90 font-mono text-xs text-blue-300 overflow-x-auto leading-relaxed shadow-inner">
            {currentQuery.hql}
          </pre>
        </div>

        {/* Execution Output Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
          <div className="flex items-center space-x-3 font-mono">
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleRunQuery(activeQueryId)}
              disabled={executing}
              className="flex items-center gap-1.5"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>{executing ? 'Executing Tez...' : 'Execute HiveQL'}</span>
            </Button>

            {queryResult && (
              <Badge variant="success" className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>{queryResult.status}</span>
              </Badge>
            )}
          </div>

          {queryResult && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-400">
              <span>
                Engine: <strong className="text-slate-200">{queryResult.executionEngine}</strong>
              </span>
              <span>
                Latency: <strong className="text-emerald-400">{queryResult.latencyMs} ms</strong>
              </span>
              <span>
                Scanned: <strong className="text-slate-200">{queryResult.recordsScanned.toLocaleString()} rows</strong>
              </span>
              <span>
                Partitions Pruned: <strong className="text-purple-400">{queryResult.partitionsPruned} partitions</strong>
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* 4. Two-Column Breakdown: Provincial Revenue vs Top Customers */}
      {analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left Column: Provincial Revenue */}
          <Card className="p-4 bg-[#121420] border-slate-800 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Provincial Revenue Share (Cambodia)</span>
              </h5>
              <Badge variant="secondary">September 2026</Badge>
            </div>

            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              {analytics.revenueByProvince.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">{item.province}</span>
                    <div className="space-x-2 font-mono">
                      <span className="font-bold text-white">${(item.revenue / 1_000_000).toFixed(2)}M</span>
                      <span className="text-slate-400">({item.share})</span>
                    </div>
                  </div>
                  <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                      style={{ width: item.share }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Right Column: Top Customers by Spend */}
          <Card className="p-4 bg-[#121420] border-slate-800 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                <span>Top Customer Spend (Sorted-Merge Bucket)</span>
              </h5>
              <Badge variant="secondary">Top 5 Leaders</Badge>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
              {analytics.topCustomers.map((cust) => (
                <div
                  key={cust.rank}
                  className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-center space-x-2.5">
                    <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-300 font-bold font-mono flex items-center justify-center text-xs">
                      #{cust.rank}
                    </span>
                    <div>
                      <span className="font-bold text-white">{cust.name}</span>
                      <span className="text-slate-400 text-[11px] block">{cust.city}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 font-mono">
                    <Badge variant={cust.tier.includes('Platinum') ? 'purple' : 'warning'}>
                      {cust.tier}
                    </Badge>
                    <span className="font-bold text-emerald-400">${cust.spend.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* 5. Pipeline Stages Architecture */}
      {analytics && (
        <Card className="p-4 bg-[#121420] border-slate-800 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span>Multi-Stage HDFS ETL & OLAP Transformation Pipeline</span>
            </h5>
            <span className="text-[11px] font-mono text-slate-500">
              TextFile CSV → ORC Columnar Snappy → Vectorized Tez
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {analytics.pipelineStages.map((stage) => (
              <div
                key={stage.stage}
                className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-500/30">
                    Stage {stage.stage}
                  </span>
                </div>
                <h6 className="text-xs font-bold text-white">{stage.name}</h6>
                <p className="text-[11px] text-slate-400 leading-relaxed">{stage.desc}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
