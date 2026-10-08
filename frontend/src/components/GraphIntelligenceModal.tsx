import React, { useState, useEffect } from 'react';
import type { GraphStatus, ImpactAnalysisResult, Warehouse, Vehicle } from '../types';

interface GraphIntelligenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: Warehouse[];
  vehicles: Vehicle[];
}

export function GraphIntelligenceModal({
  isOpen,
  onClose,
  warehouses,
  vehicles,
}: GraphIntelligenceModalProps) {
  const [graphStatus, setGraphStatus] = useState<GraphStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Impact Simulation State
  const [selectedType, setSelectedType] = useState<'depot' | 'vehicle'>('depot');
  const [selectedId, setSelectedId] = useState<string>('depot-a');
  const [impactResult, setImpactResult] = useState<ImpactAnalysisResult | null>(null);
  const [simulatingImpact, setSimulatingImpact] = useState(false);

  // Custom Cypher Console State
  const [customCypher, setCustomCypher] = useState<string>(
    'MATCH (d:Depot)-[:DISPATCHES]->(v:Vehicle)-[:ASSIGNED_TO]->(drv:Driver) RETURN d.name, count(v) AS vehicleCount'
  );
  const [cypherOutput, setCypherOutput] = useState<any>(null);
  const [runningCypher, setRunningCypher] = useState(false);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch('/api/graph/status');
      if (res.ok) {
        const data = await res.json();
        setGraphStatus(data);
      }
    } catch {
      // Fallback
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      handleRunImpact('depot', selectedId || 'depot-a');
    }
  }, [isOpen]);

  const handleSyncTopology = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/graph/sync', { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
      }
    } catch {
      // Ignore
    } finally {
      setSyncing(false);
    }
  };

  const handleRunImpact = async (type: 'depot' | 'vehicle', id: string) => {
    setSimulatingImpact(true);
    try {
      const res = await fetch(`/api/graph/impact/${type}/${id}`);
      if (res.ok) {
        const data = await res.json();
        setImpactResult(data);
      }
    } catch {
      // Ignore
    } finally {
      setSimulatingImpact(false);
    }
  };

  const handleExecuteCypher = async (queryText?: string) => {
    const q = queryText || customCypher;
    setRunningCypher(true);
    try {
      const res = await fetch('/api/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cypher: q }),
      });
      if (res.ok) {
        const data = await res.json();
        setCypherOutput(data);
      }
    } catch (err: any) {
      setCypherOutput({ error: err.message });
    } finally {
      setRunningCypher(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-[#12121a] border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-[#161622]">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold text-lg">
              ☊
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Neo4j Graph Intelligence & Incident Impact Simulator
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  PHASE 3
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Index-free adjacency relationship graph • Bolt protocol (Port 7687) • Cypher Traversal Engine
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">
                Neo4j Instance
              </span>
              <div className="flex items-center space-x-2 mt-1">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    graphStatus?.healthy ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400'
                  }`}
                />
                <span className="text-sm font-bold text-white font-mono">
                  {graphStatus?.healthy ? 'Online (Bolt 7687)' : 'Standby / Fallback'}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">HTTP 7474 active</span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">
                Graph Nodes
              </span>
              <p className="text-xl font-mono font-bold text-white mt-1">
                {graphStatus?.nodeCount ?? 62} <span className="text-xs font-normal text-slate-400">nodes</span>
              </p>
              <span className="text-[10px] text-slate-500 block mt-1">Warehouses, Depots, Fleet, Drivers, Orders</span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
              <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">
                Relationships
              </span>
              <p className="text-xl font-mono font-bold text-purple-400 mt-1">
                {graphStatus?.relationshipCount ?? 62} <span className="text-xs font-normal text-slate-400">edges</span>
              </p>
              <span className="text-[10px] text-slate-500 block mt-1">FEEDS, DISPATCHES, ASSIGNED_TO, CARRIES</span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl flex flex-col justify-between">
              <span className="text-[10px] font-mono uppercase text-slate-400 block tracking-wider">
                Topology Sync
              </span>
              <button
                onClick={handleSyncTopology}
                disabled={syncing}
                className="mt-1 w-full py-1.5 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                {syncing ? 'Syncing...' : '↻ Push Sync to Neo4j'}
              </button>
            </div>
          </div>

          {/* Section: Incident Impact Simulator */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>⚡ Cascade Failure & Incident Impact Simulator</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Simulate emergency flooding or vehicle failure to calculate downstream delays in microsecond graph traversal
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <select
                  value={selectedType}
                  onChange={(e) => {
                    const newType = e.target.value as 'depot' | 'vehicle';
                    setSelectedType(newType);
                    const defaultTarget = newType === 'depot' ? 'depot-a' : vehicles[0]?.id || 'TRUCK-001';
                    setSelectedId(defaultTarget);
                    handleRunImpact(newType, defaultTarget);
                  }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2.5 py-1.5 font-mono"
                >
                  <option value="depot">Target: Depot</option>
                  <option value="vehicle">Target: Vehicle</option>
                </select>

                <select
                  value={selectedId}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    handleRunImpact(selectedType, e.target.value);
                  }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2.5 py-1.5 font-mono"
                >
                  {selectedType === 'depot' ? (
                    <>
                      <option value="depot-a">Depot A (Central Market)</option>
                      <option value="depot-b">Depot B (Russian Market)</option>
                    </>
                  ) : (
                    vehicles.slice(0, 15).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.type})
                      </option>
                    ))
                  )}
                </select>

                <button
                  onClick={() => handleRunImpact(selectedType, selectedId)}
                  disabled={simulatingImpact}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer"
                >
                  {simulatingImpact ? 'Traversing...' : 'Run Simulation'}
                </button>
              </div>
            </div>

            {/* Impact Results Cards */}
            {impactResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[#181824] border border-slate-800 p-3 rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-slate-400">Traversal Latency</span>
                    <p className="text-lg font-bold font-mono text-emerald-400 mt-0.5">
                      {impactResult.traversalTimeMs} ms
                    </p>
                    <span className="text-[10px] text-slate-500">O(1) memory pointers</span>
                  </div>

                  <div className="bg-[#181824] border border-slate-800 p-3 rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-slate-400">Stranded Vehicles</span>
                    <p className="text-lg font-bold font-mono text-amber-400 mt-0.5">
                      {impactResult.impactedVehicles.length} vehicles
                    </p>
                    <span className="text-[10px] text-slate-500">Need fleet re-homing</span>
                  </div>

                  <div className="bg-[#181824] border border-slate-800 p-3 rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-slate-400">At-Risk Orders</span>
                    <p className="text-lg font-bold font-mono text-rose-400 mt-0.5">
                      {impactResult.totalOrdersAtRisk} deliveries
                    </p>
                    <span className="text-[10px] text-slate-500">{impactResult.totalPayloadKg} kg total cargo</span>
                  </div>

                  <div className="bg-[#181824] border border-slate-800 p-3 rounded-lg">
                    <span className="text-[10px] uppercase font-mono text-slate-400">Revenue At Risk</span>
                    <p className="text-lg font-bold font-mono text-purple-300 mt-0.5">
                      ${impactResult.estimatedRevenueAtRiskUSD}
                    </p>
                    <span className="text-[10px] text-slate-500">{impactResult.impactedCustomers.length} customers</span>
                  </div>
                </div>

                {/* Generated Cypher Query Box */}
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-xs text-slate-300 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pb-1 border-b border-slate-800/80">
                    <span className="font-bold text-slate-400">Cypher Graph Traversal Query Executed:</span>
                    <span className="text-emerald-400">Index-Free Adjacency</span>
                  </div>
                  <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap py-1 text-[11px]">
                    {impactResult.cypherQuery}
                  </pre>
                </div>

                {/* List of Affected Vehicles & Drivers */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-300 block">
                    Impacted Fleet Assets ({impactResult.impactedVehicles.length} Vehicles Affected):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
                    {impactResult.impactedVehicles.map((v) => (
                      <div
                        key={v.id}
                        className="bg-slate-800/50 border border-slate-700/60 p-2.5 rounded-lg flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-bold text-white block">{v.name}</span>
                          <span className="text-[10px] text-slate-400">
                            Driver: {v.driverName || 'Assigned Driver'}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                          {v.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section: Live Cypher Query Console */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>⚡ Interactive Neo4j Cypher Console</span>
              </h4>
              <span className="text-[11px] text-slate-400">Real-time query on live database</span>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const q = 'MATCH (d:Depot)-[:DISPATCHES]->(v:Vehicle) RETURN d.name AS depot, count(v) AS fleetSize';
                  setCustomCypher(q);
                  handleExecuteCypher(q);
                }}
                className="text-[11px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono transition-colors"
              >
                Fleet Size by Depot
              </button>

              <button
                onClick={() => {
                  const q = 'MATCH (c:Customer) RETURN c.id AS id, c.name AS name, c.city AS city LIMIT 8';
                  setCustomCypher(q);
                  handleExecuteCypher(q);
                }}
                className="text-[11px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono transition-colors"
              >
                Query E-Commerce Referral Customers
              </button>

              <button
                onClick={() => {
                  const q = 'MATCH (w:Warehouse)-[:FEEDS]->(d:Depot) RETURN w.name, d.name';
                  setCustomCypher(q);
                  handleExecuteCypher(q);
                }}
                className="text-[11px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono transition-colors"
              >
                Warehouse Feeds Depots
              </button>
            </div>

            {/* Cypher Input Bar */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customCypher}
                onChange={(e) => setCustomCypher(e.target.value)}
                placeholder="Enter Cypher statement (e.g., MATCH (n) RETURN n LIMIT 10)"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-purple-500"
              />
              <button
                onClick={() => handleExecuteCypher()}
                disabled={runningCypher}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                {runningCypher ? 'Executing...' : 'Run Query'}
              </button>
            </div>

            {/* Output Display */}
            {cypherOutput && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs max-h-48 overflow-y-auto">
                <span className="text-[10px] text-slate-500 block pb-1 border-b border-slate-800 mb-2 font-bold uppercase">
                  Neo4j Response:
                </span>
                <pre className="text-slate-300 text-[11px] whitespace-pre-wrap">
                  {JSON.stringify(cypherOutput, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-[#161622] flex justify-between items-center text-xs text-slate-400">
          <span>Enterprise Polyglot Architecture: Neo4j (Graph) + Cassandra (Telemetry) + MongoDB (Orders)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
