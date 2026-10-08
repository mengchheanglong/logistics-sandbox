import { useState } from 'react';
import type { RoutingAlgorithm, DispatchStrategy, AlgorithmBenchmarkStats } from '../types';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats?: AlgorithmBenchmarkStats;
  onUpdateAlgorithms: (config: {
    routingAlgorithm?: RoutingAlgorithm;
    dispatchStrategy?: DispatchStrategy;
  }) => Promise<void>;
}

const ROUTING_ALGORITHMS: {
  id: RoutingAlgorithm;
  name: string;
  badge: string;
  description: string;
  complexity: string;
}[] = [
  {
    id: 'contraction_hierarchies',
    name: 'Contraction Hierarchies (CH)',
    badge: '⚡ Ultra Fast (<0.1ms)',
    description: 'Preprocessed node contraction shortcuts. Instantaneous shortest path queries across large road networks.',
    complexity: 'Query: O((|V| + |E|) log |V|)',
  },
  {
    id: 'astar',
    name: 'A* (A-Star)',
    badge: '🎯 Heuristic Goal-Directed',
    description: 'Uses Haversine distance heuristic to guide graph exploration towards the destination node.',
    complexity: 'Query: O(|E| + |V| log |V|)',
  },
  {
    id: 'bidirectional_astar',
    name: 'Bidirectional A*',
    badge: '🔄 Dual Frontier',
    description: 'Simultaneously searches forward from start and backward from destination until frontiers meet.',
    complexity: 'Query: ~2x faster search radius than unidirectional A*',
  },
  {
    id: 'dijkstra',
    name: 'Dijkstra',
    badge: '📊 Uniform-Cost Baseline',
    description: 'Explores radially outward from the origin node until reaching the destination. Exhaustive search baseline.',
    complexity: 'Query: Explores maximum road graph vertices',
  },
];

const DISPATCH_STRATEGIES: {
  id: DispatchStrategy;
  name: string;
  badge: string;
  description: string;
}[] = [
  {
    id: 'nearest_available',
    name: 'Nearest-Available (Greedy Proximity)',
    badge: 'Baseline Greedy',
    description: 'Assigns each order to the closest idle vehicle based on great-circle distance to the pickup depot.',
  },
  {
    id: 'route_aware',
    name: 'Route-Aware (Capacity Weighted)',
    badge: 'Load Balanced',
    description: 'Penalizes vehicles already carrying high capacity, balancing workload and wear across the entire fleet.',
  },
  {
    id: 'cluster_zone',
    name: 'Cluster-Zone (Geographic Sectoring)',
    badge: 'Sector Clustered',
    description: 'Prioritizes vehicles stationed at the depot closest to the customer address to eliminate cross-city deadheading.',
  },
  {
    id: 'multi_stop_tour',
    name: 'Multi-Stop Tour (VRP Batching)',
    badge: '📦 VRP Multi-Drop',
    description: 'Batches 3-8 packages per vehicle and optimizes drop sequence using Nearest-Neighbor TSP heuristic with depot return.',
  },
  {
    id: 'predictive_ai',
    name: 'Predictive AI (Phase 4 Equilibrium)',
    badge: '🤖 Anticipatory AI',
    description: 'Real-time district demand forecasting & anticipatory fleet repositioning to eliminate courier shortages before order surges.',
  },
];

export function BenchmarkModal({
  isOpen,
  onClose,
  stats,
  onUpdateAlgorithms,
}: BenchmarkModalProps) {
  const [selectedRouting, setSelectedRouting] = useState<RoutingAlgorithm>(
    stats?.routingAlgorithm || 'contraction_hierarchies'
  );
  const [selectedDispatch, setSelectedDispatch] = useState<DispatchStrategy>(
    stats?.dispatchStrategy || 'nearest_available'
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApply = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await onUpdateAlgorithms({
        routingAlgorithm: selectedRouting,
        dispatchStrategy: selectedDispatch,
      });
      setFeedback('Algorithm configuration applied to live simulation!');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err) {
      setFeedback(`Failed to update algorithms: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="incident-modal-backdrop" onClick={onClose}>
      <div className="benchmark-modal" onClick={(e) => e.stopPropagation()}>
        <div className="incident-header">
          <div className="header-title">
            <span className="incident-icon">🧪</span>
            <h2>Algorithm Test Bench & Performance Analytics</h2>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="benchmark-body">
          {/* Live Benchmark HUD */}
          {stats && (
            <div className="benchmark-hud">
              <div className="hud-metric">
                <span className="hud-label">Routing Engine</span>
                <span className="hud-val mono-font" style={{ color: 'var(--accent-cyan)' }}>
                  {stats.routingAlgorithm.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
              <div className="hud-metric">
                <span className="hud-label">Avg Query Latency</span>
                <span className="hud-val mono-font">
                  {stats.avgQueryTimeMs.toFixed(3)} <span className="stat-unit">ms</span>
                </span>
              </div>
              <div className="hud-metric">
                <span className="hud-label">Avg Nodes Explored</span>
                <span className="hud-val mono-font">
                  {stats.avgNodesVisited.toFixed(1)} <span className="stat-unit">nodes</span>
                </span>
              </div>
              <div className="hud-metric">
                <span className="hud-label">Queries Executed</span>
                <span className="hud-val mono-font">{stats.totalQueries}</span>
              </div>
              <div className="hud-metric">
                <span className="hud-label">Fleet Distance</span>
                <span className="hud-val mono-font">
                  {stats.totalDistanceDrivenKm.toFixed(1)} <span className="stat-unit">km</span>
                </span>
              </div>
            </div>
          )}

          {feedback && (
            <div className="incident-feedback feedback-success">
              {feedback}
            </div>
          )}

          {/* Routing Algorithm Selector */}
          <div className="benchmark-section">
            <div className="section-title">
              <h3>1. Physical Road Routing Engine (`osm-pathfinder`)</h3>
              <span className="title-desc">Controls path computation across Cambodia highway graph</span>
            </div>

            <div className="algo-cards-grid">
              {ROUTING_ALGORITHMS.map((algo) => (
                <div
                  key={algo.id}
                  className={`algo-card ${selectedRouting === algo.id ? 'algo-selected' : ''}`}
                  onClick={() => setSelectedRouting(algo.id)}
                >
                  <div className="algo-card-header">
                    <span className="algo-name">{algo.name}</span>
                    <span className="algo-badge">{algo.badge}</span>
                  </div>
                  <p className="algo-desc">{algo.description}</p>
                  <span className="algo-complexity mono-font">{algo.complexity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dispatch Strategy Selector */}
          <div className="benchmark-section">
            <div className="section-title">
              <h3>2. Fleet Dispatch Strategy</h3>
              <span className="title-desc">Controls how incoming orders are matched to vehicles</span>
            </div>

            <div className="algo-cards-grid">
              {DISPATCH_STRATEGIES.map((strat) => (
                <div
                  key={strat.id}
                  className={`algo-card ${selectedDispatch === strat.id ? 'algo-selected' : ''}`}
                  onClick={() => setSelectedDispatch(strat.id)}
                >
                  <div className="algo-card-header">
                    <span className="algo-name">{strat.name}</span>
                    <span className="algo-badge">{strat.badge}</span>
                  </div>
                  <p className="algo-desc">{strat.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="benchmark-actions">
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={handleApply}
            >
              {saving ? 'Applying Settings...' : '🚀 Apply Algorithm Configuration to Digital Twin'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
