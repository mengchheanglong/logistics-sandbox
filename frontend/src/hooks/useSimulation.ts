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

  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string; description?: string }>>([]);

  const fetchScenarios = async () => {
    try {
      const res = await fetch('/api/scenarios');
      if (res.ok) {
        const data = await res.json();
        setScenarios(data);
      }
    } catch (err) {
      console.error('Failed to fetch scenarios:', err);
    }
  };

  useEffect(() => {
    fetchScenarios();
  }, []);

  const loadScenario = async (scenarioId: string) => {
    try {
      const res = await fetch('/api/scenarios/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId }),
      });
      if (res.ok) {
        await fetchState();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to load scenario:', err);
      return false;
    }
  };

  return {
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
  };
}
