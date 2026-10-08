import React, { useState, useEffect, useMemo } from 'react';
import type { GraphStatus, ImpactAnalysisResult, Warehouse, Vehicle } from '../types';

interface GraphIntelligenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: Warehouse[];
  vehicles: Vehicle[];
}

interface GraphNodeItem {
  id: string;
  label: string;
  properties: Record<string, any>;
}

interface GraphRelItem {
  id: string;
  type: string;
  from: string;
  to: string;
}

export function GraphIntelligenceModal({
  isOpen,
  onClose,
  warehouses,
  vehicles,
}: GraphIntelligenceModalProps) {
  const [activeTab, setActiveTab] = useState<'simulator' | 'topology' | 'cypher'>('simulator');
  const [graphStatus, setGraphStatus] = useState<GraphStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Tab 1: Simulator State
  const [selectedType, setSelectedType] = useState<'depot' | 'vehicle'>('depot');
  const [selectedId, setSelectedId] = useState<string>('depot-a');
  const [impactResult, setImpactResult] = useState<ImpactAnalysisResult | null>(null);
  const [simulatingImpact, setSimulatingImpact] = useState(false);
  const [copiedQuery, setCopiedQuery] = useState(false);

  // Tab 2: Topology Explorer State
  const [topologyNodes, setTopologyNodes] = useState<GraphNodeItem[]>([]);
  const [topologyRels, setTopologyRels] = useState<GraphRelItem[]>([]);
  const [loadingTopology, setLoadingTopology] = useState(false);
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Tab 3: Cypher Console State
  const [customCypher, setCustomCypher] = useState<string>(
    'MATCH (d:Depot)-[:DISPATCHES]->(v:Vehicle) RETURN d.name AS Depot, v.type AS VehicleType, count(v) AS Count'
  );
  const [cypherOutput, setCypherOutput] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [rawJsonOutput, setRawJsonOutput] = useState<any>(null);
  const [queryViewMode, setQueryViewMode] = useState<'table' | 'json'>('table');
  const [runningCypher, setRunningCypher] = useState(false);
  const [queryExecutionTimeMs, setQueryExecutionTimeMs] = useState<number | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/graph/status');
      if (res.ok) {
        const data = await res.json();
        setGraphStatus(data);
      }
    } catch {
      // Offline fallback
    }
  };

  const fetchTopology = async () => {
    setLoadingTopology(true);
    try {
      const res = await fetch('/api/graph/topology');
      if (res.ok) {
        const data = await res.json();
        setTopologyNodes(data.nodes || []);
        setTopologyRels(data.relationships || []);
      }
    } catch {
      // Offline fallback
    } finally {
      setLoadingTopology(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      handleRunImpact('depot', selectedId || 'depot-a');
      fetchTopology();
    }
  }, [isOpen]);

  const handleSyncTopology = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/graph/sync', { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
        await fetchTopology();
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
    setQueryExecutionTimeMs(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cypher: q }),
      });
      const end = performance.now();
      setQueryExecutionTimeMs(Math.round((end - start) * 10) / 10);

      if (res.ok) {
        const data = await res.json();
        setRawJsonOutput(data);
        const resultObj = data.results?.[0];
        if (resultObj) {
          const cols: string[] = resultObj.columns || [];
          const rows: any[][] = (resultObj.data || []).map((d: any) => d.row || []);
          setCypherOutput({ columns: cols, rows });
        } else {
          setCypherOutput(null);
        }
      }
    } catch (err: any) {
      setRawJsonOutput({ error: err.message });
      setCypherOutput(null);
    } finally {
      setRunningCypher(false);
    }
  };

  const filteredNodes = useMemo(() => {
    return topologyNodes.filter((node) => {
      const matchesType = nodeFilter === 'all' || node.label.toLowerCase() === nodeFilter.toLowerCase();
      const name = String(node.properties.name || node.id || '').toLowerCase();
      const id = String(node.id).toLowerCase();
      const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase()) || id.includes(searchQuery.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [topologyNodes, nodeFilter, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 sm:p-6 overflow-hidden animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[88vh] max-h-[820px] flex flex-col rounded-2xl bg-[#0d0f17] border border-slate-700/80 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_30px_rgba(168,85,247,0.15)] overflow-hidden">
        
        {/* 1. Header Bar */}
        <div className="h-16 px-6 shrink-0 border-b border-slate-800 bg-[#121420] flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold text-lg shadow-[0_0_12px_rgba(168,85,247,0.2)]">
              ☊
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Neo4j Graph Intelligence & Incident Studio
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold tracking-wider">
                  PHASE 3
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
                <span>Index-free adjacency relationship graph</span>
                <span>•</span>
                <div className="flex items-center space-x-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      graphStatus?.healthy
                        ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                        : 'bg-amber-400'
                    }`}
                  />
                  <span className="font-mono text-slate-300">
                    {graphStatus?.healthy ? 'Bolt 7687 Online' : 'Standby / Local'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center space-x-2 bg-slate-900/80 border border-slate-800 px-3 py-1.5 rounded-xl font-mono text-xs">
              <span className="text-slate-400">Topology:</span>
              <span className="font-bold text-white">{graphStatus?.nodeCount ?? topologyNodes.length}</span>
              <span className="text-slate-500">nodes</span>
              <span className="text-slate-600">/</span>
              <span className="font-bold text-purple-400">{graphStatus?.relationshipCount ?? topologyRels.length}</span>
              <span className="text-slate-500">edges</span>
            </div>

            <button
              onClick={handleSyncTopology}
              disabled={syncing}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-200 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer active:scale-95"
              title="Resynchronize simulation state into Neo4j graph"
            >
              <span className={syncing ? 'animate-spin' : ''}>↻</span>
              <span>{syncing ? 'Syncing...' : 'Sync Graph'}</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-slate-700/60"
              title="Close modal (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 2. Navigation Tabs Bar */}
        <div className="h-12 px-6 shrink-0 border-b border-slate-800/80 bg-[#10121c] flex items-center justify-between">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'simulator'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.3)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>⚡</span>
              <span>Incident Impact Simulator</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('topology');
                if (topologyNodes.length === 0) fetchTopology();
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'topology'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.3)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>🌐</span>
              <span>Supply Chain Topology ({topologyNodes.length || 62})</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('cypher');
                if (!cypherOutput && !rawJsonOutput) handleExecuteCypher();
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'cypher'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.3)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>💻</span>
              <span>Cypher Query Studio</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-500 hidden md:block">
            Bolt Protocol • Index-Free Adjacency O(1) Memory Pointers
          </div>
        </div>

        {/* 3. Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-[#0a0c13]">

          {/* ================= TAB 1: INCIDENT IMPACT SIMULATOR ================= */}
          {activeTab === 'simulator' && (
            <div className="space-y-5 animate-in fade-in duration-150">
              {/* Simulation Target Control Card */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>Target Failure Entity</span>
                    <span className="text-[11px] font-normal text-slate-400">
                      (Select asset to compute cascade disruption ripples)
                    </span>
                  </h4>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                    <button
                      onClick={() => {
                        setSelectedType('depot');
                        setSelectedId('depot-a');
                        handleRunImpact('depot', 'depot-a');
                      }}
                      className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                        selectedType === 'depot'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      🏢 Depot Hub
                    </button>
                    <button
                      onClick={() => {
                        setSelectedType('vehicle');
                        const defaultV = vehicles[0]?.id || 'TRUCK-001';
                        setSelectedId(defaultV);
                        handleRunImpact('vehicle', defaultV);
                      }}
                      className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                        selectedType === 'vehicle'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      🚚 Fleet Vehicle
                    </button>
                  </div>

                  <select
                    value={selectedId}
                    onChange={(e) => {
                      setSelectedId(e.target.value);
                      handleRunImpact(selectedType, e.target.value);
                    }}
                    className="bg-slate-950 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 font-mono focus:outline-hidden focus:border-purple-500 cursor-pointer"
                  >
                    {selectedType === 'depot' ? (
                      <>
                        <option value="depot-a">Depot A — Central Market (Daun Penh)</option>
                        <option value="depot-b">Depot B — Russian Market (Toul Tom Poung)</option>
                      </>
                    ) : (
                      vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.type.toUpperCase()} • Driver {v.driverId})
                        </option>
                      ))
                    )}
                  </select>

                  <button
                    onClick={() => handleRunImpact(selectedType, selectedId)}
                    disabled={simulatingImpact}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-[0_0_12px_rgba(244,63,94,0.3)] cursor-pointer disabled:opacity-50"
                  >
                    {simulatingImpact ? 'Traversing...' : '⚡ Run Simulation'}
                  </button>
                </div>
              </div>

              {/* 4 Impact Summary KPI Cards */}
              {impactResult && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="bg-[#131522] border border-slate-800/90 p-4 rounded-xl shadow-xs">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">
                      Graph Traversal Latency
                    </span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className="text-2xl font-bold font-mono text-emerald-400">
                        {impactResult.traversalTimeMs}
                      </span>
                      <span className="text-xs font-mono text-slate-400">ms</span>
                    </div>
                    <span className="text-[10px] text-emerald-500/90 font-medium block mt-1">
                      ⚡ O(1) Index-free adjacency
                    </span>
                  </div>

                  <div className="bg-[#131522] border border-slate-800/90 p-4 rounded-xl shadow-xs">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">
                      Stranded Fleet Vehicles
                    </span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className="text-2xl font-bold font-mono text-amber-400">
                        {impactResult.impactedVehicles.length}
                      </span>
                      <span className="text-xs text-slate-400">couriers</span>
                    </div>
                    <span className="text-[10px] text-amber-400/80 font-medium block mt-1">
                      Requires emergency re-homing
                    </span>
                  </div>

                  <div className="bg-[#131522] border border-slate-800/90 p-4 rounded-xl shadow-xs">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">
                      Deliveries At Risk
                    </span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className="text-2xl font-bold font-mono text-rose-400">
                        {impactResult.totalOrdersAtRisk}
                      </span>
                      <span className="text-xs text-slate-400">orders</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      {impactResult.totalPayloadKg} kg total cargo payload
                    </span>
                  </div>

                  <div className="bg-[#131522] border border-slate-800/90 p-4 rounded-xl shadow-xs">
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-400 block tracking-wider">
                      Revenue Exposure
                    </span>
                    <div className="flex items-baseline space-x-2 mt-1">
                      <span className="text-2xl font-bold font-mono text-purple-300">
                        ${impactResult.estimatedRevenueAtRiskUSD}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      {impactResult.impactedCustomers.length} customer recipients
                    </span>
                  </div>
                </div>
              )}

              {/* Two Column Split: Impacted Vehicles vs Impacted Orders */}
              {impactResult && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Left Column: Impacted Vehicles */}
                  <div className="bg-[#131522] border border-slate-800 rounded-xl p-4.5 space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                      <div className="flex items-center space-x-2">
                        <span className="text-amber-400">🚚</span>
                        <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                          Affected Fleet ({impactResult.impactedVehicles.length} Couriers)
                        </h5>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        Target: {impactResult.targetEntity.name}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                      {impactResult.impactedVehicles.length > 0 ? (
                        impactResult.impactedVehicles.map((v) => (
                          <div
                            key={v.id}
                            className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                          >
                            <div className="flex items-center space-x-2.5">
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                              <div>
                                <span className="font-bold text-white font-mono">{v.id}</span>
                                <span className="text-slate-400 text-[11px] block">
                                  Driver: <strong className="text-slate-200">{v.driverName || 'Assigned'}</strong>
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2 font-mono text-[11px]">
                              <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300">
                                {v.type}
                              </span>
                              <span className="text-slate-400">Load: {v.currentLoad_kg}kg</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-xs text-slate-500">
                          No vehicles directly affected by this target.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Impacted Orders & Customers */}
                  <div className="bg-[#131522] border border-slate-800 rounded-xl p-4.5 space-y-3">
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                      <div className="flex items-center space-x-2">
                        <span className="text-rose-400">📦</span>
                        <h5 className="text-xs font-bold text-white uppercase tracking-wider">
                          Delayed Orders ({impactResult.impactedOrders.length} In-Transit)
                        </h5>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {impactResult.impactedCustomers.length} Customers
                      </span>
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                      {impactResult.impactedOrders.length > 0 ? (
                        impactResult.impactedOrders.map((ord) => (
                          <div
                            key={ord.id}
                            className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs hover:border-slate-700 transition-colors"
                          >
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="font-bold text-white font-mono">{ord.id}</span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  {ord.priority || 'Express'}
                                </span>
                              </div>
                              <span className="text-slate-400 text-[11px] block mt-0.5">
                                Recipient: <strong className="text-slate-200">Customer {ord.customerId}</strong> ({ord.totalWeight_kg} kg)
                              </span>
                            </div>

                            <span className="text-[11px] font-mono text-amber-400 font-bold">
                              Status: {ord.status}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-400 space-y-1 bg-slate-900/40 rounded-lg border border-slate-800/60">
                          <span className="text-emerald-400 font-bold block">✓ Zero Active In-Transit Orders Disrupted</span>
                          <span className="text-[11px] text-slate-500 block">
                            All {impactResult.impactedVehicles.length} vehicles stationed at this depot are currently idle. Reroute fleet to secondary depot without delayed packages.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Exact Cypher Code Box */}
              {impactResult && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-2 border-b border-slate-800/80">
                    <span className="font-bold text-slate-400 flex items-center space-x-1.5">
                      <span>⚡</span>
                      <span>Real-Time Cypher Graph Traversal Query:</span>
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(impactResult.cypherQuery);
                        setCopiedQuery(true);
                        setTimeout(() => setCopiedQuery(false), 2000);
                      }}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition-colors cursor-pointer"
                    >
                      {copiedQuery ? '✓ Copied' : 'Copy Cypher'}
                    </button>
                  </div>
                  <pre className="text-emerald-300 overflow-x-auto whitespace-pre-wrap py-1 text-[11px] leading-relaxed">
                    {impactResult.cypherQuery}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 2: SUPPLY CHAIN TOPOLOGY ================= */}
          {activeTab === 'topology' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Filter & Search Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
                {/* Node type chips */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {['all', 'Warehouse', 'Depot', 'Vehicle', 'Driver', 'Customer'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setNodeFilter(type)}
                      className={`px-3 py-1.5 rounded-lg font-bold capitalize transition-all cursor-pointer ${
                        nodeFilter === type
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search node ID or name..."
                    className="w-full sm:w-64 bg-slate-950 border border-slate-800 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-purple-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Node Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredNodes.map((node) => {
                  const isDepot = node.label === 'Depot' || node.label === 'Warehouse';
                  const isVehicle = node.label === 'Vehicle';
                  const isDriver = node.label === 'Driver';
                  const isCustomer = node.label === 'Customer';

                  return (
                    <div
                      key={node.id}
                      className="bg-[#131522] border border-slate-800 hover:border-purple-500/50 p-3.5 rounded-xl space-y-2 transition-all group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`w-2.5 h-2.5 rounded-full ${
                              isDepot
                                ? 'bg-purple-400'
                                : isVehicle
                                ? 'bg-cyan-400'
                                : isDriver
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                            }`}
                          />
                          <span className="font-bold text-white font-mono text-xs group-hover:text-purple-300 transition-colors">
                            {node.id}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                          {node.label}
                        </span>
                      </div>

                      <p className="text-xs text-slate-300 font-semibold truncate">
                        {node.properties.name || node.id}
                      </p>

                      <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-1.5 text-[11px] font-mono text-slate-400">
                        {isDepot && (
                          <>
                            <span>Stock: <strong className="text-slate-200">{node.properties.currentStock}</strong></span>
                            <span>Cap: <strong className="text-slate-200">{node.properties.capacity}</strong></span>
                          </>
                        )}
                        {isVehicle && (
                          <>
                            <span>Type: <strong className="text-slate-200">{node.properties.type}</strong></span>
                            <span>Speed: <strong className="text-slate-200">{node.properties.speed_kmh}km/h</strong></span>
                          </>
                        )}
                        {isDriver && (
                          <>
                            <span>Status: <strong className="text-emerald-400">{node.properties.status}</strong></span>
                            <span>Shift: <strong className="text-slate-200">8h Active</strong></span>
                          </>
                        )}
                        {isCustomer && (
                          <>
                            <span>City: <strong className="text-slate-200">{node.properties.city || 'Phnom Penh'}</strong></span>
                            <span>Tier: <strong className="text-amber-400">{node.properties.tier || 'VIP'}</strong></span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= TAB 3: CYPHER QUERY STUDIO ================= */}
          {activeTab === 'cypher' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Presets Row */}
              <div className="space-y-1.5">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                  Quick Query Presets
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const q = 'MATCH (d:Depot)-[:DISPATCHES]->(v:Vehicle) RETURN d.name AS Depot, v.type AS VehicleType, count(v) AS FleetCount';
                      setCustomCypher(q);
                      handleExecuteCypher(q);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-slate-300 text-xs font-mono transition-all cursor-pointer"
                  >
                    📊 Fleet by Depot
                  </button>

                  <button
                    onClick={() => {
                      const q = 'MATCH (c:Customer) RETURN c.id AS CustomerID, c.name AS FullName, c.city AS City, c.tier AS Tier LIMIT 10';
                      setCustomCypher(q);
                      handleExecuteCypher(q);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-slate-300 text-xs font-mono transition-all cursor-pointer"
                  >
                    👥 Referral Customer Graph
                  </button>

                  <button
                    onClick={() => {
                      const q = 'MATCH (v:Vehicle)-[:ASSIGNED_TO]->(drv:Driver) RETURN v.id AS Vehicle, v.type AS Type, drv.name AS DriverName, drv.status AS DriverStatus';
                      setCustomCypher(q);
                      handleExecuteCypher(q);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-slate-300 text-xs font-mono transition-all cursor-pointer"
                  >
                    🚚 Vehicle to Driver Pairings
                  </button>

                  <button
                    onClick={() => {
                      const q = 'MATCH (w:Warehouse)-[:FEEDS]->(d:Depot) RETURN w.name AS CentralHub, d.name AS RegionalDepot';
                      setCustomCypher(q);
                      handleExecuteCypher(q);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 text-slate-300 text-xs font-mono transition-all cursor-pointer"
                  >
                    🏬 Warehouse Feeds Depots
                  </button>
                </div>
              </div>

              {/* Cypher Input Bar */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customCypher}
                  onChange={(e) => setCustomCypher(e.target.value)}
                  placeholder="Enter Cypher statement (e.g. MATCH (n) RETURN n LIMIT 10)"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono text-emerald-400 focus:outline-hidden focus:border-purple-500 shadow-inner"
                />
                <button
                  onClick={() => handleExecuteCypher()}
                  disabled={runningCypher}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-[0_0_12px_rgba(147,51,234,0.3)] cursor-pointer disabled:opacity-50"
                >
                  {runningCypher ? 'Executing...' : 'Run Query'}
                </button>
              </div>

              {/* Results View Card */}
              <div className="bg-[#121420] border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Query Results
                    </span>
                    {queryExecutionTimeMs !== null && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {queryExecutionTimeMs} ms
                      </span>
                    )}
                  </div>

                  {/* Table vs JSON Toggle */}
                  <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
                    <button
                      onClick={() => setQueryViewMode('table')}
                      className={`px-2.5 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                        queryViewMode === 'table' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Table View
                    </button>
                    <button
                      onClick={() => setQueryViewMode('json')}
                      className={`px-2.5 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                        queryViewMode === 'json' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {'{ }'} JSON View
                    </button>
                  </div>
                </div>

                {/* Table Presentation */}
                {queryViewMode === 'table' && cypherOutput && cypherOutput.columns.length > 0 && (
                  <div className="overflow-x-auto max-h-64 custom-scrollbar rounded-lg border border-slate-800">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 sticky top-0">
                        <tr>
                          {cypherOutput.columns.map((col, idx) => (
                            <th key={idx} className="p-2.5 font-bold uppercase tracking-wider text-[11px]">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                        {cypherOutput.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-900/40 transition-colors">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="p-2.5 text-slate-200 truncate max-w-xs">
                                {typeof cell === 'object' && cell !== null
                                  ? JSON.stringify(cell)
                                  : String(cell ?? '—')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Raw JSON Presentation */}
                {queryViewMode === 'json' && rawJsonOutput && (
                  <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto max-h-64 custom-scrollbar">
                    {JSON.stringify(rawJsonOutput, null, 2)}
                  </pre>
                )}

                {!cypherOutput && !rawJsonOutput && (
                  <div className="p-8 text-center text-xs text-slate-500 font-mono">
                    Run a query above or click a preset to inspect live Neo4j records.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* 4. Fixed Footer Bar (Never Overflowing) */}
        <div className="h-14 px-6 shrink-0 border-t border-slate-800 bg-[#121420] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="font-mono text-[11px] text-slate-400 hidden sm:inline">
              Architecture: Neo4j (Graph) • Cassandra (Telemetry) • MongoDB (Catalog/Orders)
            </span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition-all cursor-pointer active:scale-95 border border-slate-700/60"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
