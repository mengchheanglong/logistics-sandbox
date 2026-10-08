import React from 'react';
import {
  Globe,
  MapPin,
  Zap,
  Package,
  Flame,
  Layers,
  Clock,
  Pause,
  Play,
  Square,
  Cpu,
  ShoppingCart,
  FlaskConical,
  Network,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import type { SpeedSetting, EcommerceBridgeStatus, AlgorithmBenchmarkStats } from '../types';

interface ControlBarProps {
  simTime: string;
  speed: number;
  status: 'running' | 'paused' | 'stopped';
  connected: boolean;
  activeScenarioId?: string;
  scenarios?: Array<{ id: string; name: string; description?: string }>;
  showTrails?: boolean;
  showHeatmap?: boolean;
  showOrders?: boolean;
  showLegend?: boolean;
  ecommerceBridge?: EcommerceBridgeStatus;
  benchmarkStats?: AlgorithmBenchmarkStats;
  onSpeedChange: (speed: SpeedSetting) => void;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onSelectScenario?: (scenarioId: string) => void;
  onToggleTrails?: () => void;
  onToggleHeatmap?: () => void;
  onToggleOrders?: () => void;
  onToggleLegend?: () => void;
  onOpenAnalytics?: () => void;
  onOpenIncidents?: () => void;
  onOpenBenchmark?: () => void;
  onOpenGraph?: () => void;
}

const SPEEDS: { label: string; value: SpeedSetting }[] = [
  { label: '1×', value: 1 },
  { label: '10×', value: 10 },
  { label: '60×', value: 60 },
  { label: '600×', value: 600 },
];

export function ControlBar({
  simTime,
  speed,
  status,
  connected,
  activeScenarioId = 'morning_delivery',
  scenarios = [],
  showTrails = true,
  showHeatmap = true,
  showOrders = true,
  showLegend = true,
  ecommerceBridge,
  benchmarkStats,
  onSpeedChange,
  onPause,
  onResume,
  onStart,
  onStop,
  onSelectScenario,
  onToggleTrails,
  onToggleHeatmap,
  onToggleOrders,
  onToggleLegend,
  onOpenAnalytics,
  onOpenIncidents,
  onOpenBenchmark,
  onOpenGraph,
}: ControlBarProps) {
  const defaultPresets = [
    { id: 'morning_delivery', name: 'Morning Delivery' },
    { id: 'depot_stress_test', name: 'Depot Stress Test' },
    { id: 'express_rush_hour', name: 'Express Rush-Hour' },
  ];

  const availableScenarios = scenarios.length > 0 ? scenarios : defaultPresets;

  const algoShort =
    benchmarkStats?.routingAlgorithm === 'contraction_hierarchies'
      ? 'CH'
      : benchmarkStats?.routingAlgorithm === 'bidirectional_astar'
      ? 'Bi-A*'
      : benchmarkStats?.routingAlgorithm?.toUpperCase() || 'CH';

  const strategyShort =
    benchmarkStats?.dispatchStrategy === 'multi_stop_tour'
      ? 'Tour'
      : benchmarkStats?.dispatchStrategy === 'cluster_zone'
      ? 'Cluster'
      : benchmarkStats?.dispatchStrategy === 'route_aware'
      ? 'Route'
      : 'Nearest';

  return (
    <header className="h-14 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90 px-4 flex items-center justify-between select-none z-20 gap-3 text-xs overflow-x-auto">
      {/* Left: Brand, Connection, Scenario & View Toggles */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-cyan-400" />
          <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-cyan-400 via-sky-300 to-blue-400 bg-clip-text text-transparent whitespace-nowrap">
            Logistics Sandbox
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap border ${
              connected
                ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                : 'bg-rose-950/80 text-rose-400 border-rose-500/40'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
              }`}
            />
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="h-4 w-px bg-slate-800 shrink-0" />

        {/* Scenario Selector */}
        {onSelectScenario && (
          <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 hover:border-slate-700 rounded-md px-2 py-1 transition-colors shrink-0">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={activeScenarioId}
              onChange={(e) => onSelectScenario(e.target.value)}
              className="bg-transparent text-xs font-semibold text-cyan-300 outline-hidden cursor-pointer max-w-[170px] truncate pr-1"
              title="Select scenario preset with 1-click state reset"
            >
              {availableScenarios.map((sc) => (
                <option key={sc.id} value={sc.id} className="bg-slate-900 text-slate-200">
                  {sc.name.replace(' (VRPTW Priority)', '')}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* View Layer Toggles */}
        <div className="flex items-center bg-slate-900/90 p-0.5 rounded-md border border-slate-800 shrink-0">
          {onToggleTrails && (
            <button
              onClick={onToggleTrails}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                showTrails
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(0,229,255,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
              title="Toggle Animated Light Trails (TripsLayer)"
            >
              <Zap className="w-3 h-3 text-cyan-400" />
              <span>Trails</span>
            </button>
          )}

          {onToggleOrders && (
            <button
              onClick={onToggleOrders}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                showOrders
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
              title="Toggle Customer Delivery Order Pins"
            >
              <Package className="w-3 h-3 text-sky-400" />
              <span>Orders</span>
            </button>
          )}

          {onToggleHeatmap && (
            <button
              onClick={onToggleHeatmap}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                showHeatmap
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-[0_0_8px_rgba(255,145,0,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
              title="Toggle Demand Density Heatmap (HeatmapLayer)"
            >
              <Flame className="w-3 h-3 text-orange-400" />
              <span>Heatmap</span>
            </button>
          )}

          {onToggleLegend && (
            <button
              onClick={onToggleLegend}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                showLegend
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
              title="Toggle Visual Symbology & Color Legend HUD"
            >
              <Layers className="w-3 h-3 text-purple-400" />
              <span>Legend</span>
            </button>
          )}
        </div>
      </div>

      {/* Center: Authoritative Clock & Playback Pace */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          className="flex items-center gap-1.5 px-3 py-1 bg-slate-950/90 rounded-md border border-slate-800 text-cyan-300 font-mono text-sm font-bold tracking-widest shadow-inner whitespace-nowrap"
          title="Authoritative Simulation Time (HH:MM:SS)"
        >
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{simTime}</span>
        </div>

        <div className="flex items-center bg-slate-900/90 rounded-md border border-slate-800 p-0.5 shrink-0">
          <button
            className={`p-1 rounded transition-colors cursor-pointer ${
              speed === 0 || status === 'paused'
                ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={onPause}
            title="Pause Simulation"
          >
            <Pause className="w-3.5 h-3.5 fill-current" />
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors cursor-pointer ${
                speed === s.value && status === 'running'
                  ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => {
                if (status === 'paused') onResume();
                onSpeedChange(s.value);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Engine Telemetry Badges, Quick Actions & Start/Stop */}
      <div className="flex items-center gap-2 shrink-0">
        {benchmarkStats && (
          <button
            onClick={onOpenBenchmark}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 text-slate-300 text-[11px] font-mono whitespace-nowrap transition-colors cursor-pointer"
            title="Active routing & dispatch algorithms. Click to configure test bench."
          >
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-bold text-slate-200">{algoShort}</span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">{strategyShort}</span>
          </button>
        )}

        {ecommerceBridge && (
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono whitespace-nowrap border ${
              ecommerceBridge.connected
                ? 'bg-teal-950/60 border-teal-500/40 text-teal-300'
                : 'bg-slate-900/60 border-slate-800 text-slate-400'
            }`}
            title={`ecommerce-hive-nosql bridge: ${
              ecommerceBridge.connected ? 'Connected on port 4000' : 'Standby'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5 text-teal-400" />
            <span>{ecommerceBridge.connected ? 'Market: Live' : 'Market: Standby'}</span>
          </div>
        )}

        <div className="h-4 w-px bg-slate-800 shrink-0" />

        {onOpenBenchmark && (
          <button
            onClick={onOpenBenchmark}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-slate-900/90 text-slate-200 border border-slate-700/80 hover:bg-slate-800 hover:border-slate-600 whitespace-nowrap transition-all cursor-pointer"
            title="Open Algorithm Test Bench & Analytics"
          >
            <FlaskConical className="w-3.5 h-3.5 text-sky-400" />
            <span>Bench</span>
          </button>
        )}

        {onOpenGraph && (
          <button
            onClick={onOpenGraph}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-purple-950/60 text-purple-300 border border-purple-600/50 hover:bg-purple-900/60 hover:border-purple-400 whitespace-nowrap transition-all cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.15)] active:scale-95"
            title="Open Neo4j Graph Intelligence & Incident Impact Simulator (Phase 3)"
          >
            <Network className="w-3.5 h-3.5 text-purple-400" />
            <span>Neo4j Graph</span>
          </button>
        )}

        {onOpenIncidents && (
          <button
            onClick={onOpenIncidents}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-amber-950/50 text-amber-300 border border-amber-600/50 hover:bg-amber-900/50 hover:border-amber-500 whitespace-nowrap transition-all cursor-pointer"
            title="Open Incident Injection Panel"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>Incident</span>
          </button>
        )}

        {onOpenAnalytics && (
          <button
            onClick={onOpenAnalytics}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-cyan-950/60 text-cyan-300 border border-cyan-600/50 hover:bg-cyan-900/60 hover:border-cyan-400 whitespace-nowrap transition-all cursor-pointer shadow-[0_0_10px_rgba(0,240,255,0.15)]"
            title="Open Real-Time Fleet Performance Analytics HUD"
          >
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
            <span>Analytics</span>
          </button>
        )}

        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/90 border border-slate-800 text-xs font-mono font-bold whitespace-nowrap">
          <span
            className={`w-2 h-2 rounded-full ${
              status === 'running'
                ? 'bg-emerald-400 animate-pulse'
                : status === 'paused'
                ? 'bg-amber-400'
                : 'bg-rose-500'
            }`}
          />
          <span
            className={
              status === 'running'
                ? 'text-emerald-400'
                : status === 'paused'
                ? 'text-amber-400'
                : 'text-rose-400'
            }
          >
            {status.toUpperCase()}
          </span>
        </div>

        {status === 'stopped' ? (
          <button
            onClick={onStart}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_12px_rgba(37,99,235,0.35)] whitespace-nowrap transition-all cursor-pointer active:scale-95"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Start</span>
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded bg-rose-600 hover:bg-rose-500 text-white shadow-[0_0_12px_rgba(225,29,72,0.35)] whitespace-nowrap transition-all cursor-pointer active:scale-95"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        )}
      </div>
    </header>
  );
}
