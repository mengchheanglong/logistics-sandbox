import { useState, useCallback, useEffect } from 'react';
import { MapView } from './components/MapView';
import { ControlBar } from './components/ControlBar';
import { StatsBar } from './components/StatsBar';
import { VehiclePanel } from './components/VehiclePanel';
import { IncidentPanel } from './components/IncidentPanel';
import { BenchmarkModal } from './components/BenchmarkModal';
import { GraphIntelligenceModal } from './components/GraphIntelligenceModal';
import { DispatchOrderModal } from './components/DispatchOrderModal';
import { AnalyticsDrawer, AnalyticsTelemetryPoint } from './components/AnalyticsDrawer';
import { TripPlaybackModal } from './components/TripPlaybackModal';
import { NotificationToast, NotificationItem } from './components/NotificationToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useSimulation } from './hooks/useSimulation';
import { useWebSocket } from './hooks/useWebSocket';
import type { SimulationState, SimulationEvent, Vehicle, RoutingAlgorithm, DispatchStrategy, TelemetryPlaybackPing, ChaosMode } from './types';
import './index.css';

export default function App() {
  return (
    <ErrorBoundary>
      <ControlRoom />
    </ErrorBoundary>
  );
}

function ControlRoom() {
  const {
    state,
    loading,
    scenarios,
    updateState,
    startSimulation,
    stopSimulation,
    pauseSimulation,
    resumeSimulation,
    setSpeed,
    loadScenario,
  } = useSimulation();

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [chaseMode, setChaseMode] = useState<boolean>(false);
  const [dispatchModalOpen, setDispatchModalOpen] = useState<boolean>(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState<boolean>(false);
  const [benchmarkModalOpen, setBenchmarkModalOpen] = useState<boolean>(false);
  const [graphModalOpen, setGraphModalOpen] = useState<boolean>(false);
  const [analyticsOpen, setAnalyticsOpen] = useState<boolean>(false);
  const [playbackModalOpen, setPlaybackModalOpen] = useState<boolean>(false);
  const [playbackVehicleId, setPlaybackVehicleId] = useState<string | null>(null);
  const [playbackCurrentPing, setPlaybackCurrentPing] = useState<TelemetryPlaybackPing | null>(null);
  const [playbackTrailPings, setPlaybackTrailPings] = useState<TelemetryPlaybackPing[]>([]);
  const [showTrails, setShowTrails] = useState<boolean>(true);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showOrders, setShowOrders] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [telemetryHistory, setTelemetryHistory] = useState<AnalyticsTelemetryPoint[]>([]);

  const handleStateUpdate = useCallback(
    (newState: SimulationState) => {
      updateState(newState);
    },
    [updateState]
  );

  const handleEvent = useCallback((event: SimulationEvent) => {
    const payload = event.payload as Record<string, any> | undefined;

    if (event.eventType === 'order.sla.breached') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'warning',
          title: 'SLA Breached',
          message: `Order ${event.entityId} (${payload?.priority || 'standard'}) breached delivery window.`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'vehicle.failed') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'error',
          title: 'Vehicle Breakdown',
          message: `Vehicle ${event.entityId} broke down. Active orders returned to dispatch queue.`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'incident.created') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'error',
          title: 'Road Hazard Alert',
          message: `${payload?.description || 'Hazard'} active (${payload?.radiusM || 500}m). Fleet auto-rerouted.`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'scenario.loaded') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'success',
          title: 'Scenario Loaded',
          message: `Switched to "${payload?.name || 'Preset'}" with ${payload?.vehicles || 30} vehicles.`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'order.created' && payload?.source === 'ecommerce-hive-nosql') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'info',
          title: `🛍️ New E-Commerce Order: ${event.entityId}`,
          message: `${payload?.customerName || 'Customer'} placed order (${payload?.itemsCount || 1} items). Routing through Phnom Penh!`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'order.assigned' && payload?.vehicleId) {
      // Non-intrusive logging for operator-injected orders (never hijack operator camera)
      if (payload?.source === 'operator_injection') {
        setNotifications((prev) => [
          ...prev,
          {
            id: event.eventId,
            type: 'info',
            title: `🚚 Courier Dispatched: ${event.entityId}`,
            message: `Assigned to ${payload.vehicleId}.`,
            timestamp: Date.now(),
          },
        ]);
      }
    } else if (event.eventType === 'order.delivered') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'success',
          title: `✅ Order Delivered: ${event.entityId}`,
          message: `Delivery completed by ${payload?.vehicleId || 'courier'}. E-Commerce marketplace updated.`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'vehicle.repositioned') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'info',
          title: `🤖 AI Anticipatory Rebalance: ${event.entityId}`,
          message: `${payload?.reason || 'Courier repositioned to deficit district.'}`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'chaos.injected') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'error',
          title: `⚡ Chaos Event: ${payload?.name || 'Urban Crisis'}`,
          message: `${payload?.description || 'Disruption active'}. Dynamic self-healing engaged.`,
          timestamp: Date.now(),
        },
      ]);
    } else if (event.eventType === 'chaos.self_healed') {
      setNotifications((prev) => [
        ...prev,
        {
          id: event.eventId,
          type: 'success',
          title: `💚 Crisis Self-Healed: ${payload?.name || 'Road Cleared'}`,
          message: `Normal road conditions restored at ${payload?.locationName || 'Phnom Penh corridor'}.`,
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  const handleToggleChaos = useCallback(async (mode: ChaosMode) => {
    try {
      await fetch('/api/simulation/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch {
      // Non-blocking
    }
  }, []);

  const handleTriggerAiRebalance = useCallback(async () => {
    try {
      await fetch('/api/ai/predictive/rebalance', { method: 'POST' });
    } catch {
      // Non-blocking
    }
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Buffer real-time telemetry stream for analytics charts (up to 40 data points)
  useEffect(() => {
    if (!state) return;
    const simSeconds = Math.floor(state.simTime / 1000);
    const formatted = `${String(Math.floor(simSeconds / 3600) % 24).padStart(2, '0')}:${String(
      Math.floor((simSeconds % 3600) / 60)
    ).padStart(2, '0')}:${String(simSeconds % 60).padStart(2, '0')}`;

    const totalVehicles = state.vehicles?.length || 30;
    const activeVehicles = state.stats?.activeVehicles || 0;
    const utilRate = Math.round((activeVehicles / (totalVehicles || 1)) * 100);

    const point: AnalyticsTelemetryPoint = {
      simTime: state.simTime,
      timeFormatted: formatted,
      activeVehicles,
      totalVehicles,
      utilizationRate: utilRate,
      deliveredOrders: state.stats?.deliveredOrders || 0,
      pendingOrders: state.stats?.pendingOrders || 0,
      slaComplianceRate: state.stats?.slaComplianceRate ?? 100,
      atRiskOrders: state.stats?.atRiskOrdersCount || 0,
      breachedOrders: state.stats?.lateOrders || 0,
      avgSpeedKmh: state.vehicles?.length
        ? state.vehicles.reduce((acc, v) => acc + v.speed_kmh, 0) / state.vehicles.length
        : 0,
      trafficMultiplier: state.trafficMultiplier || 1.0,
    };

    setTelemetryHistory((prev) => {
      // Append if simTime changed or initial
      if (prev.length > 0 && prev[prev.length - 1].simTime === state.simTime) return prev;
      const next = [...prev, point];
      return next.length > 40 ? next.slice(next.length - 40) : next;
    });
  }, [state?.simTime, state?.stats?.deliveredOrders, state?.stats?.activeVehicles]);

  // Safety: If selectedVehicleId is cleared, ensure chaseMode is always disabled
  useEffect(() => {
    if (!selectedVehicleId && chaseMode) {
      setChaseMode(false);
    }
  }, [selectedVehicleId, chaseMode]);

  // Keyboard Shortcuts for Mission Control
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state?.status === 'running') {
          pauseSimulation();
        } else if (state?.status === 'paused') {
          resumeSimulation();
        }
      } else if (e.key === 't' || e.key === 'T') {
        setShowTrails((prev) => !prev);
      } else if (e.key === 'h' || e.key === 'H') {
        setShowHeatmap((prev) => !prev);
      } else if (e.key === 'o' || e.key === 'O') {
        setShowOrders((prev) => !prev);
      } else if (e.key === 'l' || e.key === 'L') {
        setShowLegend((prev) => !prev);
      } else if (e.key === 'a' || e.key === 'A') {
        setAnalyticsOpen((prev) => !prev);
      } else if (e.key === 'c' || e.key === 'C') {
        if (selectedVehicleId) setChaseMode((prev) => !prev);
      } else if (e.key === 'Escape') {
        if (incidentModalOpen || benchmarkModalOpen || graphModalOpen || dispatchModalOpen || playbackModalOpen) {
          setIncidentModalOpen(false);
          setBenchmarkModalOpen(false);
          setGraphModalOpen(false);
          setDispatchModalOpen(false);
          setPlaybackModalOpen(false);
          setPlaybackCurrentPing(null);
          setPlaybackTrailPings([]);
        } else if (analyticsOpen) {
          setAnalyticsOpen(false);
        } else if (chaseMode) {
          setChaseMode(false);
          setSelectedVehicleId(null);
        } else if (selectedVehicleId) {
          setSelectedVehicleId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    state?.status,
    pauseSimulation,
    resumeSimulation,
    chaseMode,
    analyticsOpen,
    selectedVehicleId,
    incidentModalOpen,
    benchmarkModalOpen,
    graphModalOpen,
    dispatchModalOpen,
    playbackModalOpen,
  ]);

  const handleInjectIncident = async (event: {
    type: string;
    targetId?: string;
    payload?: Record<string, unknown>;
  }): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch('/api/events/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      const data = await res.json();
      return {
        success: data.success !== false,
        message: data.message || 'Incident successfully injected.',
      };
    } catch (err) {
      return {
        success: false,
        message: (err as Error).message,
      };
    }
  };

  const handleUpdateAlgorithms = async (config: {
    routingAlgorithm?: RoutingAlgorithm;
    dispatchStrategy?: DispatchStrategy;
  }) => {
    await fetch('/api/simulation/algorithm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  };

  // Connect WebSocket — use relative URL so Vite proxy handles it
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected } = useWebSocket(wsUrl, handleStateUpdate, handleEvent);

  if (loading || !state) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-slate-950 text-slate-200 select-none">
        <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-bold text-cyan-400 tracking-wide">Logistics Sandbox Digital Twin</h2>
        <p className="text-xs text-slate-500 mt-1 font-mono">Connecting to simulation server...</p>
      </div>
    );
  }

  const vehicles = state.vehicles ?? [];
  const warehouses = state.warehouses ?? [];
  const selectedVehicle = selectedVehicleId
    ? vehicles.find((v: Vehicle) => v.id === selectedVehicleId) ?? null
    : null;

  // Format sim time from milliseconds to HH:MM:SS
  const formatSimTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 select-none">
      <ControlBar
        simTime={formatSimTime(state.simTime)}
        speed={state.speed}
        status={state.status}
        connected={connected}
        activeScenarioId={state.activeScenarioId || 'morning_delivery'}
        scenarios={scenarios}
        showTrails={showTrails}
        showHeatmap={showHeatmap}
        showOrders={showOrders}
        showLegend={showLegend}
        ecommerceBridge={state.ecommerceBridge}
        benchmarkStats={state.benchmarkStats}
        onSpeedChange={setSpeed}
        onPause={pauseSimulation}
        onResume={resumeSimulation}
        onStart={startSimulation}
        onStop={stopSimulation}
        onSelectScenario={loadScenario}
        onToggleTrails={() => setShowTrails((prev) => !prev)}
        onToggleHeatmap={() => setShowHeatmap((prev) => !prev)}
        onToggleOrders={() => setShowOrders((prev) => !prev)}
        onToggleLegend={() => setShowLegend((prev) => !prev)}
        onOpenAnalytics={() => setAnalyticsOpen(true)}
        onOpenIncidents={() => setIncidentModalOpen(true)}
        onOpenBenchmark={() => setBenchmarkModalOpen(true)}
        onOpenGraph={() => setGraphModalOpen(true)}
        onOpenDispatchOrder={() => setDispatchModalOpen(true)}
        onOpenPlayback={() => {
          setPlaybackVehicleId(selectedVehicleId || vehicles[0]?.id || null);
          setPlaybackModalOpen(true);
        }}
        chaosMode={state.chaosMode || 'off'}
        onToggleChaos={handleToggleChaos}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <MapView
          vehicles={vehicles}
          warehouses={warehouses}
          orders={state.orders || []}
          incidents={state.incidents || []}
          selectedVehicleId={selectedVehicleId}
          onVehicleClick={setSelectedVehicleId}
          simTime={state.simTime}
          showTrails={showTrails}
          showHeatmap={showHeatmap}
          showOrders={showOrders}
          showLegend={showLegend}
          onToggleLegend={() => setShowLegend((prev) => !prev)}
          chaseMode={chaseMode}
          onToggleChaseMode={() => setChaseMode((prev) => !prev)}
          playbackCurrentPing={playbackCurrentPing}
          playbackTrailPings={playbackTrailPings}
        />

        {selectedVehicle && (
          <VehiclePanel
            vehicle={selectedVehicle}
            orders={state.orders || []}
            simTime={state.simTime}
            onClose={() => {
              setSelectedVehicleId(null);
              setChaseMode(false);
            }}
            onInjectEvent={handleInjectIncident}
            isChaseMode={chaseMode}
            onToggleChaseMode={() => setChaseMode((prev) => !prev)}
            onOpenTripPlayback={(vId) => {
              setPlaybackVehicleId(vId);
              setPlaybackModalOpen(true);
            }}
          />
        )}
      </div>

      <StatsBar stats={state.stats} ecommerceBridge={state.ecommerceBridge} />

      <AnalyticsDrawer
        isOpen={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        history={telemetryHistory}
        currentStats={state.stats}
        currentTrafficMultiplier={state.trafficMultiplier || 1.0}
        activeRoutingAlgorithm={state.benchmarkStats?.routingAlgorithm}
        activeDispatchStrategy={state.benchmarkStats?.dispatchStrategy}
        totalVehiclesCount={vehicles.length}
        predictiveAi={state.predictiveAi}
        onTriggerRebalance={handleTriggerAiRebalance}
      />

      <IncidentPanel
        vehicles={vehicles}
        warehouses={warehouses}
        incidents={state.incidents || []}
        currentTrafficMultiplier={state.trafficMultiplier}
        isOpen={incidentModalOpen}
        onClose={() => setIncidentModalOpen(false)}
        onInject={handleInjectIncident}
      />

      <BenchmarkModal
        isOpen={benchmarkModalOpen}
        onClose={() => setBenchmarkModalOpen(false)}
        stats={state.benchmarkStats}
        onUpdateAlgorithms={handleUpdateAlgorithms}
      />

      <GraphIntelligenceModal
        isOpen={graphModalOpen}
        onClose={() => setGraphModalOpen(false)}
        warehouses={warehouses}
        vehicles={vehicles}
      />

      <DispatchOrderModal
        isOpen={dispatchModalOpen}
        onClose={() => setDispatchModalOpen(false)}
        onTrackVehicle={(vehicleId) => {
          setSelectedVehicleId(vehicleId);
          setChaseMode(true);
        }}
      />

      <TripPlaybackModal
        isOpen={playbackModalOpen}
        onClose={() => {
          setPlaybackModalOpen(false);
          setPlaybackCurrentPing(null);
          setPlaybackTrailPings([]);
        }}
        vehicles={vehicles}
        initialVehicleId={playbackVehicleId}
        onPlaybackUpdate={(currentPing, allPings) => {
          setPlaybackCurrentPing(currentPing);
          setPlaybackTrailPings(allPings);
        }}
      />

      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
