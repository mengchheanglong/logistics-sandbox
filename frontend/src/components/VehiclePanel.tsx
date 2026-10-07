import type { Vehicle } from '../types';

interface VehiclePanelProps {
  vehicle: Vehicle;
  onClose: () => void;
  onInjectEvent?: (event: { type: string; targetId?: string; payload?: Record<string, unknown> }) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'var(--color-green)',
  en_route: 'var(--color-blue)',
  delivering: 'var(--color-orange)',
  returning: 'var(--color-blue)',
  broken_down: 'var(--color-red)',
};

export function VehiclePanel({ vehicle, onClose, onInjectEvent }: VehiclePanelProps) {
  return (
    <div className="vehicle-panel">
      <div className="panel-header">
        <h2>{vehicle.name}</h2>
        <button className="close-btn" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="panel-content">
        <div className="detail-section">
          <h3>Overview</h3>
          <DetailRow label="ID" value={vehicle.id} mono />
          <DetailRow label="Type" value={vehicle.type} />
          <DetailRow label="Driver" value={vehicle.driverId} mono />
          <DetailRow
            label="Status"
            value={vehicle.status.replace(/_/g, ' ').toUpperCase()}
            color={STATUS_COLORS[vehicle.status]}
          />
        </div>

        <div className="detail-section">
          <h3>Telemetry</h3>
          <DetailRow
            label="Position"
            value={`${vehicle.position.lat.toFixed(5)}, ${vehicle.position.lon.toFixed(5)}`}
            mono
          />
          <DetailRow
            label="Speed"
            value={`${vehicle.speed_kmh.toFixed(1)} km/h`}
            mono
          />
          <DetailRow
            label="Capacity"
            value={`${vehicle.currentLoad_kg.toFixed(0)} / ${vehicle.capacity_kg} kg`}
            mono
          />
        </div>

        {vehicle.routeGeometry.length > 1 && (
          <div className="detail-section">
            <h3>{vehicle.routeLegs && vehicle.routeLegs.length > 1 ? 'Multi-Stop Tour' : 'Current Route'}</h3>
            {vehicle.routeLegs && vehicle.routeLegs.length > 1 && (
              <>
                <DetailRow
                  label="Tour Progress"
                  value={`Leg ${(vehicle.currentLegIndex ?? 0) + 1} of ${vehicle.totalLegsCount || vehicle.routeLegs.length}`}
                  color="var(--accent-cyan)"
                  mono
                />
                <DetailRow
                  label="Current Leg Target"
                  value={
                    vehicle.routeLegs[vehicle.currentLegIndex ?? 0]?.orderId
                      ? `Drop Order ${vehicle.routeLegs[vehicle.currentLegIndex ?? 0].orderId}`
                      : `Return to Depot (${vehicle.depotId})`
                  }
                  color="var(--color-orange)"
                />
                <DetailRow
                  label="Remaining Drops"
                  value={`${vehicle.assignedOrderIds.length} order(s)`}
                  mono
                />
              </>
            )}
            <DetailRow
              label={vehicle.routeLegs && vehicle.routeLegs.length > 1 ? 'Leg Distance' : 'Distance'}
              value={`${(vehicle.routeDistanceM / 1000).toFixed(2)} km`}
              mono
            />
            <DetailRow
              label={vehicle.routeLegs && vehicle.routeLegs.length > 1 ? 'Leg Duration' : 'Duration'}
              value={`${(vehicle.routeDurationS / 60).toFixed(1)} min`}
              mono
            />
            <DetailRow
              label={vehicle.routeLegs && vehicle.routeLegs.length > 1 ? 'Leg Progress' : 'Progress'}
              value={`${(vehicle.routeProgress * 100).toFixed(1)}%`}
              mono
            />
            {vehicle.currentRouteId && (
              <DetailRow label="Route ID" value={vehicle.currentRouteId} mono />
            )}
          </div>
        )}

        {vehicle.routeLegs && vehicle.routeLegs.length > 1 && (
          <div className="detail-section">
            <h3>Tour Itinerary ({vehicle.routeLegs.length} Legs)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.8rem' }}>
              {vehicle.routeLegs.map((leg, idx) => {
                const isCurrent = idx === (vehicle.currentLegIndex ?? 0);
                const isDone = idx < (vehicle.currentLegIndex ?? 0);
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.3rem 0.5rem',
                      borderRadius: '4px',
                      background: isCurrent ? 'rgba(0, 229, 255, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      border: isCurrent ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                    }}
                  >
                    <span>
                      {isDone ? '✅' : isCurrent ? '📍' : '⏳'} {leg.orderId ? `Drop: ${leg.orderId}` : `Depot: ${vehicle.depotId}`}
                    </span>
                    <span className="mono-font" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                      {(leg.distanceM / 1000).toFixed(1)}km
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="detail-section">
          <h3>Assignments</h3>
          <DetailRow label="Depot" value={vehicle.depotId} mono />
          <div className="detail-row" style={{ flexDirection: 'column' }}>
            <span className="detail-label" style={{ marginBottom: '0.5rem' }}>
              Orders ({vehicle.assignedOrderIds.length}):
            </span>
            {vehicle.assignedOrderIds.length > 0 ? (
              <ul className="order-list mono-font">
                {vehicle.assignedOrderIds.map((orderId) => (
                  <li key={orderId}>{orderId}</li>
                ))}
              </ul>
            ) : (
              <span className="detail-value" style={{ color: 'var(--text-dim)' }}>
                None
              </span>
            )}
          </div>
        </div>

        <div className="detail-section">
          <h3>Operator Intervention</h3>
          {vehicle.status === 'broken_down' ? (
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => onInjectEvent?.({ type: 'vehicle_recover', targetId: vehicle.id })}
            >
              🛠️ Repair & Recover Vehicle
            </button>
          ) : (
            <button
              className="btn btn-danger"
              style={{ width: '100%' }}
              onClick={() => onInjectEvent?.({ type: 'vehicle_breakdown', targetId: vehicle.id })}
            >
              💥 Trigger Breakdown
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}:</span>
      <span
        className={`detail-value${mono ? ' mono-font' : ''}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
