import type { SimulationStats } from '../types';

interface StatsBarProps {
  stats: SimulationStats;
}

export function StatsBar({ stats }: StatsBarProps) {
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-label">Active Vehicles</span>
        <span className="stat-value mono-font">{stats.activeVehicles}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Delivered</span>
        <span className="stat-value mono-font" style={{ color: 'var(--color-green)' }}>
          {stats.deliveredOrders}
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Total Orders</span>
        <span className="stat-value mono-font">{stats.totalOrders}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Pending</span>
        <span className="stat-value mono-font" style={{ color: 'var(--color-blue)' }}>
          {stats.pendingOrders}
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Late</span>
        <span className="stat-value mono-font" style={{ color: 'var(--color-red)' }}>
          {stats.lateOrders}
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Avg Delivery</span>
        <span className="stat-value mono-font">
          {stats.avgDeliveryTimeMin.toFixed(1)}<span className="stat-unit">min</span>
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Distance</span>
        <span className="stat-value mono-font">
          {stats.totalDistanceKm.toFixed(1)}<span className="stat-unit">km</span>
        </span>
      </div>
    </div>
  );
}
