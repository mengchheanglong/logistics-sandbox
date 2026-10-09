import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Network,
  RefreshCw,
  X,
  Zap,
  Globe,
  Terminal,
  Database,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ImpactSimulatorTab } from '../features/graph/ImpactSimulatorTab';
import { TopologyExplorerTab } from '../features/graph/TopologyExplorerTab';
import { CypherStudioTab } from '../features/graph/CypherStudioTab';
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

  // Tab 2: Topology Explorer State
  const [topologyNodes, setTopologyNodes] = useState<GraphNodeItem[]>([]);
  const [topologyRels, setTopologyRels] = useState<GraphRelItem[]>([]);
  const [loadingTopology, setLoadingTopology] = useState(false);

  // Tab 3: Cypher Console State
  const [customCypher, setCustomCypher] = useState<string>(
    'MATCH (d:Depot)-[:DISPATCHES]->(v:Vehicle) RETURN d.name AS Depot, v.type AS VehicleType, count(v) AS Count'
  );
  const [cypherOutput, setCypherOutput] = useState<{ columns: string[]; rows: any[][] } | null>(null);
  const [rawJsonOutput, setRawJsonOutput] = useState<any>(null);
  const [queryViewMode, setQueryViewMode] = useState<'table' | 'json'>('table');
  const [runningCypher, setRunningCypher] = useState(false);
  const [queryExecutionTimeMs, setQueryExecutionTimeMs] = useState<number | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // Fetch status of the local simulation relationship graph
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/graph/status');
      if (res.ok) {
        const data = await res.json();
        setGraphStatus(data);
      }
    } catch {
      // Offline fallback
    }
  }, []);

  // Fetch topology graph nodes and relationships
  const fetchTopology = useCallback(async () => {
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
  }, []);

  // Run impact traversal
  const handleRunImpact = useCallback(async (type: 'depot' | 'vehicle', id: string) => {
    setSimulatingImpact(true);
    try {
      const res = await fetch(`/api/graph/impact/${type}/${id}`);
      if (res.ok) {
        const data = await res.json();
        setImpactResult(data);
      }
    } catch {
      // Offline fallback
    } finally {
      setSimulatingImpact(false);
    }
  }, []);

  // Execute Cypher statement
  const handleExecuteCypher = useCallback(async (queryText?: string) => {
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
  }, [customCypher]);

  // Sync graph state
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

  // Setup on modal open
  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      handleRunImpact('depot', selectedId || 'depot-a');
      fetchTopology();
    }
  }, [isOpen, fetchStatus, handleRunImpact, selectedId, fetchTopology]);

  // Keyboard accessibility: Escape key closes modal (modern web guidance)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Light-dismiss click on backdrop (modern web guidance)
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const nodeCount = graphStatus?.nodeCount ?? (topologyNodes.length || 69);
  const relCount = graphStatus?.relationshipCount ?? (topologyRels.length || 68);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="graph-intelligence-title"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 sm:p-6 overflow-hidden animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-5xl h-[88vh] max-h-[820px] flex flex-col rounded-2xl bg-[#0d0f17] border border-slate-700/80 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_35px_rgba(168,85,247,0.18)] overflow-hidden"
      >
        {/* 1. Header Bar (Fixed Height, Never Shrinks) */}
        <div className="h-16 px-6 shrink-0 border-b border-slate-800 bg-[#121420] flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold shadow-[0_0_12px_rgba(168,85,247,0.2)]">
              <Network className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3
                  id="graph-intelligence-title"
                  className="text-base font-bold text-white tracking-wide"
                >
                  Simulation Graph & Incident Studio
                </h3>
                <Badge variant="purple">PHASE 3</Badge>
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
                    {graphStatus?.healthy ? 'Local Graph Ready' : 'Local Graph Unavailable'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-xl font-mono text-xs">
              <span className="text-slate-400">Topology:</span>
              <span className="font-bold text-white">{nodeCount}</span>
              <span className="text-slate-500">nodes</span>
              <span className="text-slate-600">/</span>
              <span className="font-bold text-purple-400">{relCount}</span>
              <span className="text-slate-500">edges</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncTopology}
              disabled={syncing}
              className="flex items-center gap-1.5 border-purple-500/40 text-purple-200 hover:bg-purple-950/40"
              title="Resynchronize the local simulation relationship graph"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Graph'}</span>
            </Button>

            <button
              onClick={onClose}
              aria-label="Close modal"
              className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-slate-700/60 active:scale-95"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Navigation Tabs Bar (Fixed Height, Never Shrinks) */}
        <div className="h-12 px-6 shrink-0 border-b border-slate-800/80 bg-[#10121c] flex items-center justify-between">
          <div className="flex space-x-1.5">
            <button
              onClick={() => setActiveTab('simulator')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'simulator'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.35)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Incident Impact Simulator</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('topology');
                if (topologyNodes.length === 0) fetchTopology();
              }}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'topology'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.35)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Supply Chain Topology ({nodeCount})</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('cypher');
                if (!cypherOutput && !rawJsonOutput) handleExecuteCypher();
              }}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'cypher'
                  ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(147,51,234,0.35)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Cypher Query Studio</span>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-500 hidden md:flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500/80" />
            <span>Bolt Protocol • O(1) Index-Free Adjacency Traversal</span>
          </div>
        </div>

        {/* 3. Tab Content Area (Flex-1, Scrollable with Custom Scrollbar) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-[#0a0c13]">
          {activeTab === 'simulator' && (
            <ImpactSimulatorTab
              vehicles={vehicles}
              impactResult={impactResult}
              simulatingImpact={simulatingImpact}
              selectedType={selectedType}
              selectedId={selectedId}
              onSelectType={setSelectedType}
              onSelectId={setSelectedId}
              onRunImpact={handleRunImpact}
            />
          )}

          {activeTab === 'topology' && (
            <TopologyExplorerTab
              nodes={topologyNodes}
              loading={loadingTopology}
            />
          )}

          {activeTab === 'cypher' && (
            <CypherStudioTab
              customCypher={customCypher}
              onChangeCypher={setCustomCypher}
              onExecuteCypher={handleExecuteCypher}
              runningCypher={runningCypher}
              queryExecutionTimeMs={queryExecutionTimeMs}
              cypherOutput={cypherOutput}
              rawJsonOutput={rawJsonOutput}
              queryViewMode={queryViewMode}
              onToggleViewMode={setQueryViewMode}
            />
          )}
        </div>

        {/* 4. Fixed Footer Bar (Never Overflowing) */}
        <div className="h-14 px-6 shrink-0 border-t border-slate-800 bg-[#121420] flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-2">
            <Database className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-mono text-[11px] text-slate-400 hidden sm:inline">
              Simulation storage: in-memory graph, telemetry and orders • Marketplace: read-only
            </span>
          </div>

          <Button
            variant="default"
            size="md"
            onClick={onClose}
            className="px-5 py-2 font-bold"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
