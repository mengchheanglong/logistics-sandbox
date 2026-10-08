import type { Vehicle, Order } from '../types';

interface VehiclePanelProps {
  vehicle: Vehicle;
  orders?: Order[];
  simTime?: number;
  onClose: () => void;
  onInjectEvent?: (event: { type: string; targetId?: string; payload?: Record<string, unknown> }) => void;
  isChaseMode?: boolean;
  onToggleChaseMode?: () => void;
  onOpenTripPlayback?: (vehicleId: string) => void;
}

export function VehiclePanel({
  vehicle,
  orders = [],
  simTime = 0,
  onClose,
  onInjectEvent,
  isChaseMode = false,
  onToggleChaseMode,
  onOpenTripPlayback,
}: VehiclePanelProps) {
  const loadPercent = Math.min(100, Math.round((vehicle.currentLoad_kg / (vehicle.capacity_kg || 1)) * 100));
  const progressPercent = Math.min(100, Math.round(vehicle.routeProgress * 100));

  const statusStyle =
    vehicle.status === 'en_route'
      ? 'bg-cyan-950/70 text-cyan-300 border-cyan-500/40'
      : vehicle.status === 'delivering'
      ? 'bg-orange-950/70 text-orange-300 border-orange-500/40'
      : vehicle.status === 'idle'
      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
      : vehicle.status === 'returning'
      ? 'bg-sky-950/70 text-sky-300 border-sky-500/40'
      : 'bg-rose-950/70 text-rose-300 border-rose-500/40';

  return (
    <aside className="w-84 bg-slate-950/95 backdrop-blur-md border-l border-slate-800 text-xs shadow-2xl flex flex-col z-20 select-none animate-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🚚</span>
          <div>
            <h2 className="font-bold text-sm text-slate-100 font-mono tracking-wide">{vehicle.name}</h2>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">{vehicle.type} • Depot: {vehicle.depotId}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-base"
        >
          ×
        </button>
      </div>

      {/* Body content */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* Status & Driver Badge */}
        <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Status:</span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${statusStyle}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${vehicle.status === 'en_route' || vehicle.status === 'delivering' ? 'bg-cyan-400 animate-pulse' : 'bg-slate-400'}`} />
              {vehicle.status.replace(/_/g, ' ').toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Driver:</span>
            <span className="font-mono text-cyan-300 font-semibold">{vehicle.driverId}</span>
          </div>
          {vehicle.rerouteCount && vehicle.rerouteCount > 0 ? (
            <div className="flex items-center justify-between text-slate-300">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">In-Flight Reroutes:</span>
              <span className="font-mono text-cyan-400 font-bold">{vehicle.rerouteCount}×</span>
            </div>
          ) : null}
        </div>

        {/* Telemetry & Gauges */}
        <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2.5">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Live Telemetry</span>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block font-sans">Speed</span>
              <span className="font-bold text-sky-400 text-sm">{vehicle.speed_kmh.toFixed(1)} <span className="text-[10px] text-slate-400">km/h</span></span>
            </div>
            <div className="bg-slate-950/70 p-2 rounded border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block font-sans">Coordinates</span>
              <span className="text-slate-300 text-[10px]">{vehicle.position.lat.toFixed(4)}, {vehicle.position.lon.toFixed(4)}</span>
            </div>
          </div>

          {/* Capacity Gauge */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Capacity Load ({vehicle.currentLoad_kg.toFixed(0)} / {vehicle.capacity_kg} kg)</span>
              <span className="font-mono">{loadPercent}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${loadPercent > 80 ? 'bg-rose-500' : 'bg-cyan-400'}`}
                style={{ width: `${loadPercent}%` }}
              />
            </div>
          </div>

          {/* 3D Chase Camera Toggle Button */}
          {onToggleChaseMode && (
            <button
              onClick={onToggleChaseMode}
              className={`w-full py-2 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border ${
                isChaseMode
                  ? 'bg-rose-600/30 text-rose-200 border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                  : 'bg-slate-950/80 hover:bg-slate-800 text-cyan-400 border-cyan-500/40 hover:border-cyan-400'
              }`}
            >
              <span>{isChaseMode ? '✕' : '🎥'}</span>
              <span>{isChaseMode ? 'EXIT 3D CHASE CAM (ESC)' : 'ENGAGE 3D CHASE CAM'}</span>
            </button>
          )}

          {onOpenTripPlayback && (
            <button
              onClick={() => onOpenTripPlayback(vehicle.id)}
              className="w-full py-2 px-3 rounded-lg font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer border bg-slate-950/80 hover:bg-cyan-950/40 text-cyan-300 border-cyan-500/40 hover:border-cyan-400 shadow-sm"
              title="Open Cassandra Historical Telemetry Scrubber"
            >
              <span>📼</span>
              <span>REPLAY TRIP HISTORY (CASSANDRA)</span>
            </button>
          )}
        </div>

        {/* Route / Tour Progress */}
        {vehicle.routeGeometry.length > 1 && (
          <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
                {vehicle.routeLegs && vehicle.routeLegs.length > 1 ? 'Multi-Stop Tour' : 'Current Route'}
              </span>
              <span className="font-mono text-cyan-300 font-bold text-[11px]">{progressPercent}%</span>
            </div>

            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 text-slate-300">
              <div>
                <span className="text-[9px] text-slate-500 uppercase block font-sans">Distance</span>
                {(vehicle.routeDistanceM / 1000).toFixed(2)} km
              </div>
              <div>
                <span className="text-[9px] text-slate-500 uppercase block font-sans">Duration</span>
                {(vehicle.routeDurationS / 60).toFixed(1)} min
              </div>
            </div>

            {vehicle.routeLegs && vehicle.routeLegs.length > 1 && (
              <div className="pt-2 border-t border-slate-800 space-y-1">
                <span className="text-[9px] text-slate-400 uppercase font-bold block">Itinerary</span>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {vehicle.routeLegs.map((leg, idx) => {
                    const isDone = idx < (vehicle.currentLegIndex ?? 0);
                    const isCurrent = idx === (vehicle.currentLegIndex ?? 0);
                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between p-1.5 rounded text-[10px] font-mono ${
                          isCurrent
                            ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-200'
                            : isDone
                            ? 'text-slate-500'
                            : 'bg-slate-950/40 text-slate-400'
                        }`}
                      >
                        <span>
                          {isDone ? '✓' : isCurrent ? '📍' : '○'} {leg.orderId ? `Drop: ${leg.orderId}` : `Depot Return`}
                        </span>
                        <span>{(leg.distanceM / 1000).toFixed(1)}km</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VRPTW Assigned Orders */}
        <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Assigned Orders</span>
            <span className="font-mono text-xs font-bold text-slate-300">{vehicle.assignedOrderIds.length}</span>
          </div>

          {vehicle.assignedOrderIds.length > 0 ? (
            <div className="space-y-1.5">
              {vehicle.assignedOrderIds.map((orderId) => {
                const order = orders.find((o) => o.id === orderId);
                const priority = order?.priority || 'standard';
                const slaStatus = order?.slaStatus || 'on_time';
                const remainingMs = order?.slaDeadline ? order.slaDeadline - simTime : null;
                const remainingMin = remainingMs !== null ? Math.round(remainingMs / 60000) : null;

                const priorityBadge =
                  priority === 'urgent'
                    ? 'bg-rose-950/70 text-rose-300 border-rose-500/40'
                    : priority === 'express'
                    ? 'bg-amber-950/70 text-amber-300 border-amber-500/40'
                    : 'bg-blue-950/70 text-blue-300 border-blue-500/40';

                return (
                  <div key={orderId} className="p-2 rounded bg-slate-950/60 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between font-mono">
                      <span className="font-bold text-slate-200 text-[11px]">{orderId}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${priorityBadge}`}>
                        {priority} {order?.slaDurationMin ? `(${order.slaDurationMin}m)` : ''}
                      </span>
                    </div>

                    {order?.slaDeadline && (
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>SLA Status:</span>
                        <span
                          className={`font-bold ${
                            slaStatus === 'breached'
                              ? 'text-rose-400'
                              : slaStatus === 'at_risk'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {slaStatus === 'breached'
                            ? `⚠️ Breached (${Math.abs(remainingMin || 0)}m late)`
                            : slaStatus === 'at_risk'
                            ? `⚡ At Risk (${remainingMin}m left)`
                            : `✓ On Time (${remainingMin}m left)`}
                        </span>
                      </div>
                    )}

                    {order?.items && order.items.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-800/70 space-y-1">
                        <span className="text-[9px] uppercase font-bold text-slate-500 block">E-Commerce Items:</span>
                        <div className="space-y-0.5">
                          {order.items.map((item, itemIdx) => (
                            <div key={itemIdx} className="flex items-center justify-between text-[10px] text-slate-300">
                              <span className="truncate max-w-[160px]" title={item.name}>
                                📦 {item.quantity}x {item.name}
                              </span>
                              {item.price !== undefined && (
                                <span className="font-mono text-emerald-400 font-bold text-[9px]">
                                  ${(item.price * item.quantity).toFixed(2)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic">No packages assigned.</p>
          )}
        </div>

        {/* Operator Interventions */}
        <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-2">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Operator Interventions</span>
          {(vehicle.status === 'en_route' || vehicle.status === 'returning') && (
            <button
              onClick={() => onInjectEvent?.({ type: 'reroute_vehicle', targetId: vehicle.id, payload: { reason: 'operator_dispatch' } })}
              className="w-full py-1.5 px-2 bg-cyan-950/70 hover:bg-cyan-900/70 text-cyan-300 border border-cyan-500/40 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              🔄 In-Flight Re-Route Fleet
            </button>
          )}

          {vehicle.status === 'broken_down' ? (
            <button
              onClick={() => onInjectEvent?.({ type: 'vehicle_recover', targetId: vehicle.id })}
              className="w-full py-1.5 px-2 bg-emerald-950/70 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-500/40 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              🛠️ Repair & Recover Vehicle
            </button>
          ) : (
            <button
              onClick={() => onInjectEvent?.({ type: 'vehicle_breakdown', targetId: vehicle.id })}
              className="w-full py-1.5 px-2 bg-rose-950/70 hover:bg-rose-900/70 text-rose-300 border border-rose-500/40 rounded font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              💥 Trigger Breakdown
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
