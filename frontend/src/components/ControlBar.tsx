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
  onOpenIncidents?: () => void;
  onOpenBenchmark?: () => void;
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
  onOpenIncidents,
  onOpenBenchmark,
}: ControlBarProps) {
  const defaultPresets = [
    { id: 'morning_delivery', name: 'Phnom Penh Morning Delivery' },
    { id: 'depot_stress_test', name: 'Depot Flooding Stress Test' },
    { id: 'express_rush_hour', name: 'Express Rush-Hour Blitz' },
  ];

  const availableScenarios = scenarios.length > 0 ? scenarios : defaultPresets;

  return (
    <div className="control-bar flex items-center justify-between px-5 py-2.5 bg-ops-panel border-b border-ops-border select-none z-20">
      <div className="controls-left flex items-center gap-3">
        <h1 className="text-base font-bold text-ops-cyan tracking-wide flex items-center gap-1.5">
          <span>🌐</span> Logistics Sandbox
        </h1>

        <div className={`ws-indicator text-[11px] font-mono px-2 py-0.5 rounded font-bold ${connected ? 'ws-connected text-emerald-400 bg-emerald-950/60 border border-emerald-500/40' : 'ws-disconnected text-rose-400 bg-rose-950/60 border border-rose-500/40'}`}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </div>

        {/* Scenario Preset Selector */}
        {onSelectScenario && (
          <div className="flex items-center gap-1.5 ml-1 bg-slate-900/90 border border-slate-700/80 rounded px-2 py-1">
            <span className="text-xs text-slate-400 font-medium">Scenario:</span>
            <select
              value={activeScenarioId}
              onChange={(e) => onSelectScenario(e.target.value)}
              className="bg-transparent text-xs font-semibold text-ops-cyan outline-none cursor-pointer border-none"
              title="Switch simulation scenario with 1-click state reset"
            >
              {availableScenarios.map((sc) => (
                <option key={sc.id} value={sc.id} className="bg-slate-900 text-slate-200">
                  {sc.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Map Layer Toggles */}
        <div className="flex items-center gap-1.5 ml-2 border-l border-slate-700/60 pl-3">
          {onToggleTrails && (
            <button
              onClick={onToggleTrails}
              className={`text-xs px-2 py-1 rounded font-medium transition-all ${
                showTrails
                  ? 'bg-cyan-500/20 text-ops-cyan border border-ops-cyan/50 shadow-[0_0_10px_rgba(0,229,255,0.25)]'
                  : 'bg-slate-800/60 text-slate-400 border border-slate-700/40 hover:text-slate-200'
              }`}
              title="Toggle animated Glowing Light Trails (TripsLayer)"
            >
              ⚡ Trails
            </button>
          )}

          {onToggleHeatmap && (
            <button
              onClick={onToggleHeatmap}
              className={`text-xs px-2 py-1 rounded font-medium transition-all ${
                showHeatmap
                  ? 'bg-orange-500/20 text-ops-orange border border-ops-orange/50 shadow-[0_0_10px_rgba(255,145,0,0.25)]'
                  : 'bg-slate-800/60 text-slate-400 border border-slate-700/40 hover:text-slate-200'
              }`}
              title="Toggle Demand Density Heatmap (HeatmapLayer)"
            >
              🔥 Heatmap
            </button>
          )}
        </div>

        {benchmarkStats && (
          <div
            className="algo-indicator text-xs font-mono px-2 py-1 rounded cursor-pointer bg-slate-900/80 border border-slate-700/60 text-slate-300 hover:border-ops-cyan/60"
            onClick={onOpenBenchmark}
            title="Active routing & dispatch algorithms. Click to configure test bench."
          >
            ⚙️ {benchmarkStats.routingAlgorithm === 'contraction_hierarchies' ? 'CH' : benchmarkStats.routingAlgorithm.toUpperCase()} • {benchmarkStats.dispatchStrategy.replace(/_/g, ' ').toUpperCase()}
          </div>
        )}

        {ecommerceBridge && (
          <div
            className={`bridge-indicator text-xs font-mono px-2 py-1 rounded ${
              ecommerceBridge.connected
                ? 'bridge-online text-teal-300 bg-teal-950/60 border border-teal-500/40'
                : 'bridge-standby text-slate-400 bg-slate-900/60 border border-slate-700/40'
            }`}
            title={`ecommerce-hive-nosql: ${ecommerceBridge.connected ? 'Connected on :4000' : 'Standby (:4000)'}`}
          >
            {ecommerceBridge.connected ? '🛒 MARKETPLACE: LIVE' : '🛒 MARKETPLACE: STANDBY'}
          </div>
        )}
      </div>

      <div className="controls-center flex items-center gap-3">
        <div className="time-display font-mono text-base font-bold text-slate-100 bg-slate-900/90 px-3 py-1 rounded border border-slate-700/60 tracking-wider">
          {simTime}
        </div>

        <div className="speed-controls flex items-center bg-slate-900/90 rounded border border-slate-700/60 p-0.5">
          <button
            className={`speed-btn px-2.5 py-1 text-xs font-semibold rounded ${
              speed === 0 || status === 'paused'
                ? 'active bg-ops-cyan text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={onPause}
            title="Pause Simulation"
          >
            ⏸
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              className={`speed-btn px-2.5 py-1 text-xs font-semibold rounded transition-colors ${
                speed === s.value && status === 'running'
                  ? 'active bg-ops-cyan text-slate-950 font-bold'
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

      <div className="controls-right flex items-center gap-2.5">
        {onOpenBenchmark && (
          <button
            className="btn btn-secondary text-xs px-2.5 py-1.5 rounded font-medium bg-slate-800 text-slate-200 border border-slate-700 hover:border-slate-500"
            onClick={onOpenBenchmark}
            title="Open Algorithm Test Bench & Analytics"
          >
            🧪 Test Bench
          </button>
        )}

        {onOpenIncidents && (
          <button
            className="btn btn-warning text-xs px-2.5 py-1.5 rounded font-medium bg-amber-950/60 text-amber-300 border border-amber-600/50 hover:bg-amber-900/50"
            onClick={onOpenIncidents}
            title="Open Road Incident Injection Panel"
          >
            ⚡ Inject Incident
          </button>
        )}

        <div className={`status-indicator status-${status} flex items-center gap-1.5 text-xs font-mono font-semibold px-2 py-1 rounded bg-slate-900/80 border border-slate-700/60`}>
          <span className={`status-dot w-2 h-2 rounded-full ${
            status === 'running' ? 'bg-emerald-400 animate-pulse' : status === 'paused' ? 'bg-amber-400' : 'bg-rose-500'
          }`} />
          <span className={status === 'running' ? 'text-emerald-400' : status === 'paused' ? 'text-amber-400' : 'text-rose-400'}>
            {status.toUpperCase()}
          </span>
        </div>

        {status === 'stopped' ? (
          <button
            className="btn btn-primary text-xs px-3 py-1.5 rounded font-bold bg-ops-blue text-white hover:bg-blue-600 transition-colors"
            onClick={onStart}
          >
            ▶ Start
          </button>
        ) : (
          <button
            className="btn btn-danger text-xs px-3 py-1.5 rounded font-bold bg-ops-red text-white hover:bg-rose-600 transition-colors"
            onClick={onStop}
          >
            ■ Stop
          </button>
        )}
      </div>
    </div>
  );
}
