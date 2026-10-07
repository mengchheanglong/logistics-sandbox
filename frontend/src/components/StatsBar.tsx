import type { SimulationStats, EcommerceBridgeStatus } from '../types';

interface StatsBarProps {
  stats: SimulationStats;
  ecommerceBridge?: EcommerceBridgeStatus;
}

export function StatsBar({ stats, ecommerceBridge }: StatsBarProps) {
  return (
    <footer className="flex items-center justify-around px-6 py-2 bg-ops-panel border-t border-ops-border text-xs z-10 select-none">
      <StatItem label="Active Vehicles" value={stats.activeVehicles} />
      <StatItem label="Delivered" value={stats.deliveredOrders} colorClass="text-ops-green" />
      <StatItem label="Total Orders" value={stats.totalOrders} />
      <StatItem label="Pending" value={stats.pendingOrders} colorClass="text-ops-blue" />
      <StatItem label="Late" value={stats.lateOrders} colorClass="text-ops-red" />
      <StatItem label="Avg Delivery" value={`${stats.avgDeliveryTimeMin.toFixed(1)} min`} />
      <StatItem label="Distance" value={`${stats.totalDistanceKm.toFixed(1)} km`} />
      {ecommerceBridge && (
        <>
          <StatItem label="Marketplace Ingest" value={ecommerceBridge.ordersIngestedCount} colorClass="text-ops-cyan" />
          <StatItem label="Cassandra Pings" value={ecommerceBridge.telemetryPingsEmittedCount} colorClass="text-ops-teal" />
        </>
      )}
    </footer>
  );
}

function StatItem({
  label,
  value,
  colorClass = 'text-slate-200',
}: {
  label: string;
  value: string | number;
  colorClass?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <span className={`font-mono text-sm font-semibold ${colorClass}`}>{value}</span>
    </div>
  );
}

