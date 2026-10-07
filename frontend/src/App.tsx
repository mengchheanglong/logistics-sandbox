import { useState, useCallback } from 'react';
import { MapView } from './components/MapView';
import { ControlBar } from './components/ControlBar';
import { StatsBar } from './components/StatsBar';
import { VehiclePanel } from './components/VehiclePanel';
import { useSimulation } from './hooks/useSimulation';
import { useWebSocket } from './hooks/useWebSocket';
import type { SimulationState, SimulationEvent, Vehicle } from './types';
import './index.css';

export default function App() {
  const {
    state,
    loading,
    updateState,
    startSimulation,
    stopSimulation,
    pauseSimulation,
    resumeSimulation,
    setSpeed,
  } = useSimulation();

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const handleStateUpdate = useCallback(
    (newState: SimulationState) => {
      updateState(newState);
    },
    [updateState]
  );

  const handleEvent = useCallback((_event: SimulationEvent) => {
    // Future: show event toast notifications
  }, []);

  // Connect WebSocket — use relative URL so Vite proxy handles it
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected } = useWebSocket(wsUrl, handleStateUpdate, handleEvent);

  if (loading || !state) {
    return (
      <div className="loading-screen">
        <h2>Logistics Sandbox</h2>
        <p>Connecting to simulation server...</p>
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
    <div className="app-container">
      <ControlBar
        simTime={formatSimTime(state.simTime)}
        speed={state.speed}
        status={state.status}
        connected={connected}
        onSpeedChange={setSpeed}
        onPause={pauseSimulation}
        onResume={resumeSimulation}
        onStart={startSimulation}
        onStop={stopSimulation}
      />

      <div className="main-content">
        <MapView
          vehicles={vehicles}
          warehouses={warehouses}
          selectedVehicleId={selectedVehicleId}
          onVehicleClick={setSelectedVehicleId}
        />

        {selectedVehicle && (
          <VehiclePanel
            vehicle={selectedVehicle}
            onClose={() => setSelectedVehicleId(null)}
          />
        )}
      </div>

      <StatsBar stats={state.stats} />
    </div>
  );
}
