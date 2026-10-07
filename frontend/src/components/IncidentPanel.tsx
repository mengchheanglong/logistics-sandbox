import { useState } from 'react';
import type { Vehicle, Warehouse, RoadIncident } from '../types';

interface IncidentPanelProps {
  vehicles: Vehicle[];
  warehouses: Warehouse[];
  incidents?: RoadIncident[];
  currentTrafficMultiplier?: number;
  isOpen: boolean;
  onClose: () => void;
  onInject: (event: { type: string; targetId?: string; payload?: Record<string, unknown> }) => Promise<{ success: boolean; message: string }>;
}

type TabType = 'vehicles' | 'depots' | 'demand' | 'traffic' | 'hazards';

const HAZARD_PRESETS = [
  {
    name: 'Monivong Bridge Bottleneck',
    type: 'congestion' as const,
    description: 'Choke point congestion at Monivong Bridge approach',
    position: { lat: 11.532, lon: 104.935 },
    radiusM: 600,
    severity: 'critical' as const,
  },
  {
    name: 'Norodom Blvd Vehicle Crash',
    type: 'accident' as const,
    description: 'Multi-vehicle collision blocking Norodom Blvd',
    position: { lat: 11.557, lon: 104.928 },
    radiusM: 450,
    severity: 'high' as const,
  },
  {
    name: 'Russian Market Flash Flood',
    type: 'flooding' as const,
    description: 'Monsoon street waterlogging near Russian Market',
    position: { lat: 11.543, lon: 104.915 },
    radiusM: 500,
    severity: 'high' as const,
  },
  {
    name: 'Wat Phnom Roadwork Closure',
    type: 'road_work' as const,
    description: 'Pavement resurfacing near Wat Phnom roundabout',
    position: { lat: 11.576, lon: 104.923 },
    radiusM: 350,
    severity: 'medium' as const,
  },
];

export function IncidentPanel({
  vehicles,
  warehouses,
  incidents = [],
  currentTrafficMultiplier = 1.0,
  isOpen,
  onClose,
  onInject,
}: IncidentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('vehicles');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(vehicles[0]?.id || '');
  const [selectedDepotId, setSelectedDepotId] = useState<string>(warehouses[0]?.id || '');
  const [demandCount, setDemandCount] = useState<number>(25);
  const [trafficFactor, setTrafficFactor] = useState<number>(currentTrafficMultiplier);
  const [selectedHazardPreset, setSelectedHazardPreset] = useState<number>(0);
  const [autoRerouteFleet, setAutoRerouteFleet] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAction = async (event: { type: string; targetId?: string; payload?: Record<string, unknown> }) => {
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const res = await onInject(event);
      setStatusMessage({ text: res.message, isError: !res.success });
    } catch (err) {
      setStatusMessage({ text: (err as Error).message, isError: true });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);
  const selectedDepot = warehouses.find((w) => w.id === selectedDepotId);

  return (
    <div className="incident-modal-backdrop" onClick={onClose}>
      <div className="incident-modal" onClick={(e) => e.stopPropagation()}>
        <div className="incident-header">
          <div className="header-title">
            <span className="incident-icon">⚡</span>
            <h2>God's-Eye Incident Injection</h2>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="incident-tabs">
          <button
            className={`incident-tab ${activeTab === 'vehicles' ? 'active' : ''}`}
            onClick={() => setActiveTab('vehicles')}
          >
            🚛 Vehicle Fleet
          </button>
          <button
            className={`incident-tab ${activeTab === 'depots' ? 'active' : ''}`}
            onClick={() => setActiveTab('depots')}
          >
            🏢 Depots
          </button>
          <button
            className={`incident-tab ${activeTab === 'demand' ? 'active' : ''}`}
            onClick={() => setActiveTab('demand')}
          >
            📦 Demand Spike
          </button>
          <button
            className={`incident-tab ${activeTab === 'traffic' ? 'active' : ''}`}
            onClick={() => setActiveTab('traffic')}
          >
            🚦 Traffic Conditions
          </button>
          <button
            className={`incident-tab ${activeTab === 'hazards' ? 'active' : ''}`}
            onClick={() => setActiveTab('hazards')}
          >
            🚧 Road Hazards
          </button>
        </div>

        <div className="incident-body">
          {statusMessage && (
            <div className={`incident-feedback ${statusMessage.isError ? 'feedback-error' : 'feedback-success'}`}>
              {statusMessage.text}
            </div>
          )}

          {activeTab === 'vehicles' && (
            <div className="tab-pane">
              <p className="pane-desc">
                Simulate mechanical failures or maintenance events. When a vehicle breaks down, any in-transit orders are automatically returned to the dispatch queue for re-routing to healthy vehicles.
              </p>

              <div className="form-group">
                <label>Select Target Vehicle:</label>
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="incident-select mono-font"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id} ({v.type.toUpperCase()}) — {v.status.replace('_', ' ').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {selectedVehicle && (
                <div className="target-summary">
                  <div><strong>Driver:</strong> {selectedVehicle.driverId}</div>
                  <div><strong>Speed:</strong> {selectedVehicle.speed_kmh.toFixed(1)} km/h</div>
                  <div><strong>Active Orders:</strong> {selectedVehicle.assignedOrderIds.length}</div>
                </div>
              )}

              <div className="action-buttons">
                {selectedVehicle?.status === 'broken_down' ? (
                  <button
                    className="btn btn-primary"
                    disabled={submitting}
                    onClick={() => handleAction({ type: 'vehicle_recover', targetId: selectedVehicleId })}
                  >
                    🛠️ Repair & Recover Vehicle
                  </button>
                ) : (
                  <button
                    className="btn btn-danger"
                    disabled={submitting}
                    onClick={() => handleAction({ type: 'vehicle_breakdown', targetId: selectedVehicleId })}
                  >
                    💥 Trigger Mechanical Breakdown
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'depots' && (
            <div className="tab-pane">
              <p className="pane-desc">
                Simulate warehouse/depot emergency closures (e.g. monsoon flooding, structural safety). Stationed idle vehicles are evacuated to alternative operating depots.
              </p>

              <div className="form-group">
                <label>Select Distribution Depot:</label>
                <select
                  value={selectedDepotId}
                  onChange={(e) => setSelectedDepotId(e.target.value)}
                  className="incident-select"
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.id}) — {(w.status || 'open').toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {selectedDepot && (
                <div className="target-summary">
                  <div><strong>Current Status:</strong> {(selectedDepot.status || 'open').toUpperCase()}</div>
                  <div><strong>Capacity:</strong> {selectedDepot.capacity} units</div>
                  <div><strong>Stationed Fleet:</strong> {vehicles.filter((v) => v.depotId === selectedDepot.id).length} vehicles</div>
                </div>
              )}

              <div className="action-buttons">
                {selectedDepot?.status === 'closed' ? (
                  <button
                    className="btn btn-primary"
                    disabled={submitting}
                    onClick={() => handleAction({ type: 'depot_reopen', targetId: selectedDepotId })}
                  >
                    🔓 Reopen Depot
                  </button>
                ) : (
                  <button
                    className="btn btn-danger"
                    disabled={submitting}
                    onClick={() => handleAction({ type: 'depot_closure', targetId: selectedDepotId, payload: { reason: 'monsoon_flooding' } })}
                  >
                    🌊 Trigger Emergency Closure (Flooding)
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab === 'demand' && (
            <div className="tab-pane">
              <p className="pane-desc">
                Inject a sudden surge of delivery orders into the digital twin network. Test how quickly the dispatcher scales and whether vehicle utilization bottlenecks occur.
              </p>

              <div className="form-group">
                <label>Surge Magnitude:</label>
                <div className="pill-group">
                  {[10, 25, 50, 100].map((num) => (
                    <button
                      key={num}
                      type="button"
                      className={`pill-btn ${demandCount === num ? 'active' : ''}`}
                      onClick={() => setDemandCount(num)}
                    >
                      +{num} Orders
                    </button>
                  ))}
                </div>
              </div>

              <div className="action-buttons">
                <button
                  className="btn btn-warning"
                  disabled={submitting}
                  onClick={() => handleAction({ type: 'demand_spike', payload: { count: demandCount } })}
                >
                  ⚡ Inject {demandCount} Urgent Orders
                </button>
              </div>
            </div>
          )}

          {activeTab === 'traffic' && (
            <div className="tab-pane">
              <p className="pane-desc">
                Apply real-time traffic congestion multipliers across the road network. Vehicles will move slower along their polyline geometry and delivery ETAs will elongate.
              </p>

              <div className="form-group">
                <label>Traffic Congestion Preset:</label>
                <div className="pill-group">
                  {[
                    { label: 'Normal (1.0×)', val: 1.0 },
                    { label: 'Heavy Peak (1.8×)', val: 1.8 },
                    { label: 'Rain / Flood (2.5×)', val: 2.5 },
                    { label: 'Gridlock (4.0×)', val: 4.0 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      className={`pill-btn ${trafficFactor === p.val ? 'active' : ''}`}
                      onClick={() => setTrafficFactor(p.val)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={autoRerouteFleet}
                    onChange={(e) => setAutoRerouteFleet(e.target.checked)}
                  />
                  <span>Auto-reroute en-route vehicles when traffic level changes</span>
                </label>
              </div>

              <div className="action-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <button
                  className="btn btn-primary"
                  disabled={submitting}
                  onClick={() =>
                    handleAction({
                      type: 'traffic_congestion',
                      payload: { multiplier: trafficFactor, autoReroute: autoRerouteFleet },
                    })
                  }
                >
                  🚦 Apply {trafficFactor.toFixed(1)}× Traffic Multiplier
                </button>

                <button
                  className="btn btn-secondary"
                  disabled={submitting}
                  onClick={() =>
                    handleAction({
                      type: 'reroute_fleet',
                      payload: { reason: `manual_fleet_optimization` },
                    })
                  }
                >
                  🔄 Re-Route All In-Flight Vehicles ({vehicles.filter((v) => v.status === 'en_route' || v.status === 'returning').length} Active)
                </button>
              </div>
            </div>
          )}

          {activeTab === 'hazards' && (
            <div className="tab-pane">
              <p className="pane-desc">
                Spawn localized road incidents (accidents, construction, floods). Affected en-route vehicles will dynamically detect the obstacle and recalculate an avoidance detour via <code>osm-pathfinder</code>.
              </p>

              <div className="form-group">
                <label>Select Hazard Choke Point Preset:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {HAZARD_PRESETS.map((preset, idx) => (
                    <div
                      key={preset.name}
                      style={{
                        padding: '0.6rem 0.8rem',
                        borderRadius: '6px',
                        border: selectedHazardPreset === idx ? '1px solid var(--accent-cyan)' : '1px solid rgba(255,255,255,0.1)',
                        background: selectedHazardPreset === idx ? 'rgba(0, 229, 255, 0.1)' : 'rgba(255,255,255,0.02)',
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedHazardPreset(idx)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <strong>{preset.name}</strong>
                        <span className="mono-font" style={{ color: 'var(--color-orange)', fontSize: '0.8rem' }}>
                          Radius: {preset.radiusM}m
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{preset.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={autoRerouteFleet}
                    onChange={(e) => setAutoRerouteFleet(e.target.checked)}
                  />
                  <span>Auto-reroute intersecting vehicles around hazard</span>
                </label>
              </div>

              <div className="action-buttons">
                <button
                  className="btn btn-danger"
                  style={{ width: '100%' }}
                  disabled={submitting}
                  onClick={() => {
                    const preset = HAZARD_PRESETS[selectedHazardPreset];
                    handleAction({
                      type: 'road_incident',
                      payload: {
                        incidentType: preset.type,
                        description: preset.name,
                        position: preset.position,
                        radiusM: preset.radiusM,
                        severity: preset.severity,
                        autoReroute: autoRerouteFleet,
                      },
                    });
                  }}
                >
                  🚧 Spawn Road Hazard & Trigger Dynamic Re-Route
                </button>
              </div>

              {incidents && incidents.length > 0 && (
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--accent-cyan)' }}>
                    Active Road Hazards ({incidents.filter((i) => i.active).length}):
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {incidents
                      .filter((i) => i.active)
                      .map((inc) => (
                        <div
                          key={inc.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0.75rem',
                            borderRadius: '4px',
                            background: 'rgba(255, 60, 60, 0.1)',
                            border: '1px solid rgba(255, 60, 60, 0.3)',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{inc.description}</div>
                            <div className="mono-font" style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                              {inc.type.toUpperCase()} • Radius: {inc.radiusM}m
                            </div>
                          </div>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => handleAction({ type: 'clear_incident', targetId: inc.id })}
                          >
                            ✅ Clear
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
