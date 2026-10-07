import { useMemo } from 'react';
import type { SimulationStats } from '../types';

export interface AnalyticsTelemetryPoint {
  simTime: number;
  timeFormatted: string;
  activeVehicles: number;
  totalVehicles: number;
  utilizationRate: number; // 0 to 100
  deliveredOrders: number;
  pendingOrders: number;
  slaComplianceRate: number; // 0 to 100
  atRiskOrders: number;
  breachedOrders: number;
  avgSpeedKmh: number;
  trafficMultiplier: number;
}

interface AnalyticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  history: AnalyticsTelemetryPoint[];
  currentStats: SimulationStats;
  currentTrafficMultiplier: number;
  activeRoutingAlgorithm?: string;
  activeDispatchStrategy?: string;
  totalVehiclesCount: number;
}

export function AnalyticsDrawer({
  isOpen,
  onClose,
  history,
  currentStats,
  currentTrafficMultiplier,
  activeRoutingAlgorithm = 'contraction_hierarchies',
  activeDispatchStrategy = 'nearest',
  totalVehiclesCount,
}: AnalyticsDrawerProps) {
  if (!isOpen) return null;

  const latest = history[history.length - 1];
  const utilization = latest ? latest.utilizationRate : Math.round((currentStats.activeVehicles / (totalVehiclesCount || 1)) * 100);
  const slaRate = currentStats.slaComplianceRate ?? (latest ? latest.slaComplianceRate : 100);

  // SVG Area Chart Helper
  const renderAreaChart = (
    data: number[],
    color: string,
    id: string,
    minY = 0,
    maxY?: number
  ) => {
    if (data.length < 2) {
      return (
        <div className="h-24 flex items-center justify-center text-slate-600 text-xs italic">
          Accumulating telemetry stream...
        </div>
      );
    }

    const calculatedMax = maxY !== undefined ? maxY : Math.max(...data, 1);
    const range = Math.max(1, calculatedMax - minY);
    const width = 300;
    const height = 80;

    const points = data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const normalizedY = Math.min(1, Math.max(0, (val - minY) / range));
      const y = height - normalizedY * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const linePath = `M ${points.join(' L ')}`;
    const areaPath = `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;

    return (
      <svg className="w-full h-24 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {/* Horizontal gridlines */}
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#1e293b" strokeDasharray="3,3" />
        <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="#334155" />
        {/* Fill Area */}
        <path d={areaPath} fill={`url(#grad-${id})`} />
        {/* Line Stroke */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Active Pulse Point at Head */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].split(',')[0]}
            cy={points[points.length - 1].split(',')[1]}
            r="4"
            fill="#ffffff"
            stroke={color}
            strokeWidth="2"
          />
        )}
      </svg>
    );
  };

  const utilizationData = history.map((h) => h.utilizationRate);
  const deliveryData = history.map((h) => h.deliveredOrders);
  const slaData = history.map((h) => h.slaComplianceRate);

  return (
    <aside className="fixed inset-y-0 right-0 w-96 bg-slate-950/98 backdrop-blur-xl border-l border-slate-800 text-xs shadow-2xl z-30 flex flex-col select-none animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-2">
          <span className="text-lg">📊</span>
          <div>
            <h2 className="font-bold text-sm text-cyan-400 font-mono tracking-wider">Fleet Performance HUD</h2>
            <span className="text-[10px] text-slate-400 block font-sans">Real-time telemetry buffer ({history.length} samples)</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer text-base"
          title="Close Analytics HUD (Esc)"
        >
          ×
        </button>
      </div>

      {/* Main Metric Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Card 1: Fleet Utilization */}
        <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-cyan-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span> Fleet Utilization
            </span>
            <span className="font-mono text-base font-bold text-slate-100">{utilization}%</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-2">
            <span>{currentStats.activeVehicles} Active in Transit</span>
            <span>{Math.max(0, totalVehiclesCount - currentStats.activeVehicles)} Idle at Depots</span>
          </div>
          {renderAreaChart(utilizationData, '#00f0ff', 'util', 0, 100)}
        </div>

        {/* Card 2: Cumulative Delivery Throughput */}
        <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-emerald-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Delivery Velocity
            </span>
            <span className="font-mono text-base font-bold text-emerald-300">
              {currentStats.deliveredOrders} <span className="text-xs text-slate-400 font-normal">delivered</span>
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-2">
            <span>{currentStats.pendingOrders} Pending in Queue</span>
            <span>Avg Cycle: {currentStats.avgDeliveryTimeMin.toFixed(1)}m</span>
          </div>
          {renderAreaChart(deliveryData, '#10b981', 'delivery', 0)}
        </div>

        {/* Card 3: SLA Compliance Curve */}
        <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 shadow-md">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-bold text-amber-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span> SLA Compliance
            </span>
            <span className="font-mono text-base font-bold text-amber-300">{slaRate.toFixed(1)}%</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono mb-2">
            <span className="text-emerald-400">On-Time: {currentStats.slaOnTimeDeliveries ?? currentStats.deliveredOrders}</span>
            <span className="text-rose-400">Breached: {currentStats.slaBreachedDeliveries ?? currentStats.lateOrders}</span>
          </div>
          {renderAreaChart(slaData, '#fbbf24', 'sla', 0, 100)}
        </div>

        {/* Card 4: Network & Speed Distribution */}
        <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 shadow-md space-y-2">
          <span className="text-[11px] font-bold text-purple-400 font-mono uppercase tracking-wider block">
            Road Network & Solver Telemetry
          </span>
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block font-sans">Total Distance</span>
              <span className="font-bold text-sky-300 text-sm">
                {currentStats.totalDistanceKm.toFixed(1)} <span className="text-[10px] text-slate-500">km</span>
              </span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block font-sans">Traffic Impact</span>
              <span className="font-bold text-amber-400 text-sm">
                {currentTrafficMultiplier.toFixed(2)}× <span className="text-[10px] text-slate-500">congestion</span>
              </span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block font-sans">Routing Engine</span>
              <span className="font-bold text-cyan-300 truncate block text-[10px]" title={activeRoutingAlgorithm}>
                {activeRoutingAlgorithm.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block font-sans">Dispatch Strategy</span>
              <span className="font-bold text-purple-300 truncate block text-[10px]" title={activeDispatchStrategy}>
                {activeDispatchStrategy.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/40 text-[10px] text-slate-500 font-mono flex items-center justify-between">
        <span>Logistics Sandbox Analytics Engine</span>
        <span>Streaming (1 Hz)</span>
      </div>
    </aside>
  );
}
