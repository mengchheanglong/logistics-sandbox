import type { SimulationStats, EcommerceBridgeStatus } from '../types';

interface StatsBarProps {
  stats: SimulationStats;
  ecommerceBridge?: EcommerceBridgeStatus;
}

export function StatsBar({ stats, ecommerceBridge }: StatsBarProps) {
  const slaRate = stats.slaComplianceRate ?? 100;
  const slaColor =
    slaRate >= 90
      ? 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40'
      : slaRate >= 75
      ? 'text-amber-400 bg-amber-950/60 border-amber-500/40'
      : 'text-rose-400 bg-rose-950/60 border-rose-500/40';

  const atRiskCount = stats.atRiskOrdersCount ?? 0;
  const breachedCount = stats.slaBreachedDeliveries ?? 0;

  // Format delivery duration cleanly (e.g. 14.5 min, 2.3 hrs)
  const formatDeliveryTime = (min: number): string => {
    if (!min || min <= 0) return '0.0 min';
    if (min < 60) return `${min.toFixed(1)} min`;
    if (min < 1440) return `${(min / 60).toFixed(1)} hrs`;
    return `${(min / 1440).toFixed(1)} days`;
  };

  return (
    <footer className="h-12 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/90 px-6 flex items-center justify-between text-xs z-10 select-none overflow-x-auto gap-6 shrink-0">
      {/* Cluster 1: Fleet Operations */}
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fleet</span>
        <StatGroup
          label="Active Fleet"
          value={stats.activeVehicles}
          colorClass="text-cyan-400 font-bold"
        />
        <StatGroup
          label="Distance"
          value={`${stats.totalDistanceKm.toFixed(1)} km`}
          colorClass="text-slate-200"
        />
      </div>

      <div className="h-5 w-px bg-slate-800 shrink-0" />

      {/* Cluster 2: Order Pipeline */}
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pipeline</span>
        <StatGroup
          label="Delivered"
          value={stats.deliveredOrders.toLocaleString()}
          colorClass="text-emerald-400 font-bold"
        />
        <StatGroup
          label="Pending Queue"
          value={stats.pendingOrders.toLocaleString()}
          colorClass="text-cyan-300"
        />
        <StatGroup
          label="Total Orders"
          value={stats.totalOrders.toLocaleString()}
          colorClass="text-slate-300"
        />
      </div>

      <div className="h-5 w-px bg-slate-800 shrink-0" />

      {/* Cluster 3: VRPTW SLA Performance */}
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">SLA Health</span>

        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Compliance:</span>
          <span className={`px-1.5 py-0.5 rounded font-mono text-xs font-bold border ${slaColor}`}>
            {slaRate.toFixed(1)}%
          </span>
        </div>

        <StatGroup
          label="At Risk"
          value={atRiskCount}
          colorClass={atRiskCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}
        />
        <StatGroup
          label="Breached"
          value={breachedCount.toLocaleString()}
          colorClass={breachedCount > 0 ? 'text-rose-400 font-bold' : 'text-slate-400'}
        />
        <StatGroup
          label="Avg Cycle"
          value={formatDeliveryTime(stats.avgDeliveryTimeMin)}
          colorClass="text-slate-300"
        />
      </div>

      {ecommerceBridge && (
        <>
          <div className="h-5 w-px bg-slate-800 shrink-0" />

          {/* Cluster 4: Infrastructure & E-Commerce Synchronization */}
          <div className="flex items-center gap-3.5 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${ecommerceBridge.connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              Marketplace Read
            </span>
            <StatGroup
              label="Inventory SKUs"
              value={`${ecommerceBridge.catalogItemsCount ?? 16} Catalog`}
              colorClass="text-emerald-400 font-semibold"
            />
            <StatGroup
              label="Market Ingest"
              value={ecommerceBridge.ordersIngestedCount.toLocaleString()}
              colorClass="text-cyan-400 font-semibold"
            />
            <StatGroup
              label="Upstream Writes"
              value="Disabled"
              colorClass="text-teal-400 font-semibold"
            />
          </div>
        </>
      )}
    </footer>
  );
}

function StatGroup({
  label,
  value,
  colorClass = 'text-slate-200',
}: {
  label: string;
  value: string | number;
  colorClass?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}:</span>
      <span className={`font-mono text-xs tabular-nums ${colorClass}`}>{value}</span>
    </div>
  );
}
