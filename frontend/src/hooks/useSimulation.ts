import { useState, useCallback, useEffect } from 'react';
import type { SimulationState, SpeedSetting } from '../types';

export function useSimulation() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchState = async () => {
    try {
      const response = await fetch('/api/simulation/state');
      if (response.ok) {
        const data: SimulationState = await response.json();
        setState(data);
      }
    } catch (err) {
      console.error('Failed to fetch simulation state:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, []);

  const updateState = useCallback((newState: SimulationState) => {
    setState(newState);
  }, []);

  const startSimulation = async () => {
    await fetch('/api/simulation/start', { method: 'POST' });
    await fetchState();
  };

  const stopSimulation = async () => {
    await fetch('/api/simulation/stop', { method: 'POST' });
    await fetchState();
  };

  const pauseSimulation = async () => {
    await fetch('/api/simulation/pause', { method: 'POST' });
  };

  const resumeSimulation = async () => {
    await fetch('/api/simulation/resume', { method: 'POST' });
  };

  const setSpeed = async (speed: SpeedSetting) => {
    await fetch('/api/simulation/speed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed }),
    });
  };

  return {
    state,
    loading,
    updateState,
    startSimulation,
    stopSimulation,
    pauseSimulation,
    resumeSimulation,
    setSpeed,
  };
}
