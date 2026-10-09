import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
  Gauge,
  Battery,
  MapPin,
  Clock,
  Layers,
  Database,
  Film,
  Download,
} from 'lucide-react';
import type { Vehicle, TelemetryPlaybackData, TelemetryPlaybackPing } from '../types';

interface TripPlaybackModalProps {
  isOpen: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  initialVehicleId?: string | null;
  onPlaybackUpdate?: (currentPing: TelemetryPlaybackPing | null, allPings: TelemetryPlaybackPing[]) => void;
}

export function TripPlaybackModal({
  isOpen,
  onClose,
  vehicles,
  initialVehicleId,
  onPlaybackUpdate,
}: TripPlaybackModalProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    initialVehicleId || (vehicles[0]?.id ?? 'TRUCK-001')
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tripData, setTripData] = useState<TelemetryPlaybackData | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1); // 1x, 2x, 5x, 10x

  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync selected vehicle when initialVehicleId prop changes
  useEffect(() => {
    if (initialVehicleId) {
      setSelectedVehicleId(initialVehicleId);
    }
  }, [initialVehicleId]);

  // Fetch telemetry from local simulation API whenever selected vehicle changes or modal opens
  const fetchTelemetry = useCallback(async (vId: string) => {
    setLoading(true);
    setLoadError(null);
    setIsPlaying(false);
    setTripData(null);
    setCurrentIndex(0);
    onPlaybackUpdate?.(null, []);
    try {
      const res = await fetch(`/api/telemetry/playback?vehicleId=${encodeURIComponent(vId)}&limit=300`);
      if (!res.ok) throw new Error('Telemetry history unavailable');
      if (res.ok) {
        const data: TelemetryPlaybackData = await res.json();
        if (data.schemaVersion !== 1 || data.source !== 'simulated' || data.storage !== 'in-memory' ||
            data.durable !== false || data.sinkOwner !== 'logistics-sandbox') throw new Error('Invalid telemetry source');
        setTripData(data);
        setCurrentIndex(0);
        if (onPlaybackUpdate && data.pings.length > 0) {
          onPlaybackUpdate(data.pings[0], data.pings);
        }
      }
    } catch {
      setLoadError('Telemetry history unavailable. No cached trail is shown.');
    } finally {
      setLoading(false);
    }
  }, [onPlaybackUpdate]);

  useEffect(() => {
    if (isOpen && selectedVehicleId) {
      fetchTelemetry(selectedVehicleId);
    }
  }, [isOpen, selectedVehicleId, fetchTelemetry]);

  // Clean up playback when modal is closed
  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      if (onPlaybackUpdate) onPlaybackUpdate(null, []);
    }
  }, [isOpen, onPlaybackUpdate]);

  // Playback timer loop
  useEffect(() => {
    if (isPlaying && tripData && tripData.pings.length > 0) {
      const intervalMs = Math.max(25, 200 / playbackSpeed);
      playTimerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= tripData.pings.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          const next = prev + 1;
          if (onPlaybackUpdate) {
            onPlaybackUpdate(tripData.pings[next], tripData.pings);
          }
          return next;
        });
      }, intervalMs);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, tripData, playbackSpeed, onPlaybackUpdate]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentIndex(val);
    if (tripData && tripData.pings[val] && onPlaybackUpdate) {
      onPlaybackUpdate(tripData.pings[val], tripData.pings);
    }
  };

  const togglePlay = () => {
    if (!tripData || tripData.pings.length === 0) return;
    if (currentIndex >= tripData.pings.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying((prev) => !prev);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
    if (tripData && tripData.pings[0] && onPlaybackUpdate) {
      onPlaybackUpdate(tripData.pings[0], tripData.pings);
    }
  };

  const handleStepBack = () => {
    setCurrentIndex((prev) => {
      const next = Math.max(0, prev - 1);
      if (tripData && tripData.pings[next] && onPlaybackUpdate) {
        onPlaybackUpdate(tripData.pings[next], tripData.pings);
      }
      return next;
    });
  };

  const handleStepForward = () => {
    if (!tripData) return;
    setCurrentIndex((prev) => {
      const next = Math.min(tripData.pings.length - 1, prev + 1);
      if (tripData && tripData.pings[next] && onPlaybackUpdate) {
        onPlaybackUpdate(tripData.pings[next], tripData.pings);
      }
      return next;
    });
  };

  const exportGeoJSON = () => {
    if (!tripData || tripData.pings.length === 0) return;
    const coordinates = tripData.pings.map((p) => [p.lon, p.lat]);
    const geojson = {
      type: 'FeatureCollection',
      properties: {
        schemaVersion: tripData.schemaVersion,
        source: tripData.source,
        simulationId: tripData.simulationId,
        tenantId: tripData.tenantId,
        durable: tripData.durable,
        units: tripData.units,
        vehicleId: selectedVehicleId,
        riderId: tripData.riderId,
        pingsCount: tripData.pings.length,
        summary: tripData.summary,
      },
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates,
          },
          properties: {
            source: tripData.source,
            simulationId: tripData.simulationId,
            durable: tripData.durable,
            name: `${selectedVehicleId} Trajectory`,
            durationSeconds: tripData.summary.durationSeconds,
            maxSpeedKmh: tripData.summary.maxSpeedKmh,
            avgSpeedKmh: tripData.summary.avgSpeedKmh,
          },
        },
        ...tripData.pings.map((p, idx) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [p.lon, p.lat],
          },
          properties: {
            source: tripData.source,
            simulationId: p.simulation_id,
            durable: tripData.durable,
            sequence: idx,
            timestamp: p.ping_timestamp,
            speedKmh: p.speed_kmh,
            batteryLevel: p.battery_level,
            status: p.status,
          },
        })),
      ],
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedVehicleId}_telemetry_trajectory.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (!tripData || tripData.pings.length === 0) return;
    const headers = ['source', 'simulation_id', 'sequence', 'rider_id', 'vehicle_id', 'timestamp', 'lat', 'lon', 'speed_kmh', 'battery_level', 'status'];
    const rows = tripData.pings.map((p, idx) => [
      tripData.source,
      p.simulation_id,
      idx,
      p.rider_id,
      selectedVehicleId,
      p.ping_timestamp,
      p.lat,
      p.lon,
      (p.speed_kmh || 0).toFixed(1),
      p.battery_level ?? 0,
      p.status || 'unknown',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedVehicleId}_telemetry_pings.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const currentPing: TelemetryPlaybackPing | undefined = tripData?.pings[currentIndex];
  const totalPings = tripData?.pings.length ?? 0;
  const progressPercent = totalPings > 1 ? Math.round((currentIndex / (totalPings - 1)) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden text-xs select-none">
        {/* Header */}
        <div className="h-14 px-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Film className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white tracking-wide flex items-center gap-2">
                <span>Historical Telemetry Trip Playback</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-semibold">
                  Simulated · volatile memory
                </span>
              </h3>
              <span className="text-[10px] text-slate-400 block">
                Current-run simulated history · lost on process exit
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer text-base"
          >
            ×
          </button>
        </div>

        {/* Vehicle Selection & Summary Bar */}
        <div className="p-5 space-y-4">
          {loadError && <p role="alert" className="text-amber-300">{loadError}</p>}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 font-mono font-bold">Vehicle:</span>
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className="bg-slate-950 text-cyan-300 border border-slate-800 rounded-lg px-2.5 py-1 text-xs font-mono font-semibold outline-hidden cursor-pointer"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.type}) • Driver: {v.driverId}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2.5 font-mono text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <Database className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-bold text-slate-200">{totalPings}</span> GPS Pings
              </span>
              <span>•</span>
              <button
                onClick={exportGeoJSON}
                disabled={!tripData || tripData.pings.length === 0}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 hover:text-white border border-slate-700/80 flex items-center gap-1 cursor-pointer transition-colors text-[10px]"
                title="Download trajectory as standard GeoJSON FeatureCollection"
              >
                <Download className="w-2.5 h-2.5 text-cyan-400" />
                <span>GeoJSON</span>
              </button>
              <button
                onClick={exportCSV}
                disabled={!tripData || tripData.pings.length === 0}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 hover:text-white border border-slate-700/80 flex items-center gap-1 cursor-pointer transition-colors text-[10px]"
                title="Download GPS telemetry points as CSV"
              >
                <Download className="w-2.5 h-2.5 text-amber-400" />
                <span>CSV</span>
              </button>
            </div>
          </div>

          {/* Live Scrubber Inspector Card */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-900/90 to-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
              <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                <span className="text-[9px] text-slate-500 uppercase block font-sans">Timestamp</span>
                <span className="font-bold text-cyan-300 text-xs">
                  {currentPing ? new Date(currentPing.ping_timestamp).toLocaleTimeString() : '--:--:--'}
                </span>
              </div>

              <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                <span className="text-[9px] text-slate-500 uppercase block font-sans">Instant Speed</span>
                <span className="font-bold text-sky-400 text-xs">
                  {currentPing ? currentPing.speed_kmh.toFixed(1) : 0} km/h
                </span>
              </div>

              <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                <span className="text-[9px] text-slate-500 uppercase block font-sans">Battery</span>
                <span className="font-bold text-emerald-400 text-xs">
                  {currentPing ? `${Math.round(currentPing.battery_level)}%` : '--'}
                </span>
              </div>

              <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                <span className="text-[9px] text-slate-500 uppercase block font-sans">Coordinates</span>
                <span className="font-bold text-slate-200 text-[10px]">
                  {currentPing ? `${currentPing.lat.toFixed(4)}, ${currentPing.lon.toFixed(4)}` : '--'}
                </span>
              </div>
            </div>

            {/* Scrubber Range Slider */}
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between font-mono text-[10px] text-slate-400">
                <span>
                  Ping Index: <span className="font-bold text-white">{currentIndex + 1}</span> / {totalPings || 1}
                </span>
                <span>{progressPercent}% Complete</span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, totalPings - 1)}
                value={currentIndex}
                onChange={handleSliderChange}
                disabled={totalPings <= 1 || loading}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
              />
            </div>

            {/* Playback Controls */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleReset}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Reset to beginning"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleStepBack}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Previous ping"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={togglePlay}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(6,182,212,0.3)] cursor-pointer active:scale-95"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  <span>{isPlaying ? 'Pause' : 'Play Replay'}</span>
                </button>
                <button
                  onClick={handleStepForward}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Next ping"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Speed Buttons */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 font-mono text-[10px]">
                {[1, 2, 5, 10].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                      playbackSpeed === spd
                        ? 'bg-cyan-400 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {spd}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 px-5 border-t border-slate-800 bg-slate-900/60 font-mono text-[10px] text-slate-400 flex items-center justify-between">
          <span>Map viewport synchronizes with scrubbed vehicle coordinate trail</span>
          <button
            onClick={onClose}
            className="hover:text-white transition-colors cursor-pointer"
          >
            Close Scrubber
          </button>
        </div>
      </div>
    </div>
  );
}
