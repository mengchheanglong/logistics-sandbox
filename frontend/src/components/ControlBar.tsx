import type { SpeedSetting, EcommerceBridgeStatus } from '../types';

interface ControlBarProps {
  simTime: string;
  speed: number;
  status: 'running' | 'paused' | 'stopped';
  connected: boolean;
  ecommerceBridge?: EcommerceBridgeStatus;
  onSpeedChange: (speed: SpeedSetting) => void;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onOpenIncidents?: () => void;
}

const SPEEDS: { label: string; value: SpeedSetting }[] = [
  { label: '1×', value: 1 },
  { label: '10×', value: 10 },
  { label: '60×', value: 60 },
  { label: '600×', value: 600 },
];

export function ControlBar({
  simTime, speed, status, connected, ecommerceBridge,
  onSpeedChange, onPause, onResume, onStart, onStop, onOpenIncidents,
}: ControlBarProps) {
  return (
    <div className="control-bar">
      <div className="controls-left">
        <h1>Logistics Sandbox</h1>
        <div className={`ws-indicator ${connected ? 'ws-connected' : 'ws-disconnected'}`}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </div>
        {ecommerceBridge && (
          <div
            className={`bridge-indicator ${ecommerceBridge.connected ? 'bridge-online' : 'bridge-standby'}`}
            title={`ecommerce-hive-nosql: ${ecommerceBridge.connected ? 'Connected on :4000' : 'Standby (:4000)'}`}
          >
            {ecommerceBridge.connected ? '🛒 MARKETPLACE: LIVE' : '🛒 MARKETPLACE: STANDBY'}
          </div>
        )}
      </div>

      <div className="controls-center">
        <div className="time-display mono-font">{simTime}</div>

        <div className="speed-controls">
          <button
            className={`speed-btn ${speed === 0 || status === 'paused' ? 'active' : ''}`}
            onClick={onPause}
            title="Pause"
          >
            ⏸
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              className={`speed-btn ${speed === s.value && status === 'running' ? 'active' : ''}`}
              onClick={() => {
                if (status === 'paused') onResume();
                onSpeedChange(s.value);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="controls-right">
        {onOpenIncidents && (
          <button className="btn btn-warning" onClick={onOpenIncidents} title="Open God's-eye incident injection panel">
            ⚡ Inject Incident
          </button>
        )}

        <div className={`status-indicator status-${status}`}>
          <span className="status-dot" />
          {status.toUpperCase()}
        </div>

        {status === 'stopped' ? (
          <button className="btn btn-primary" onClick={onStart}>
            ▶ Start
          </button>
        ) : (
          <button className="btn btn-danger" onClick={onStop}>
            ■ Stop
          </button>
        )}
      </div>
    </div>
  );
}
