import { useMemo, useState, useCallback } from 'react';
import Map from 'react-map-gl/maplibre';
import { DeckGL } from '@deck.gl/react';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Vehicle, Warehouse, RoadIncident, Order } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

const DEFAULT_CENTER = {
  longitude: 104.9282,
  latitude: 11.5564,
  zoom: 13,
  pitch: 30,
  bearing: 0,
};

const MAP_STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
};

const STATUS_COLORS: Record<string, [number, number, number, number]> = {
  idle: [0, 230, 118, 220],       // green
  en_route: [0, 229, 255, 230],   // vibrant cyan
  delivering: [255, 145, 0, 230], // orange
  returning: [100, 181, 246, 220],// light blue
  broken_down: [255, 23, 68, 240],// red
};

interface MapViewProps {
  vehicles: Vehicle[];
  warehouses: Warehouse[];
  orders?: Order[];
  incidents?: RoadIncident[];
  selectedVehicleId: string | null;
  onVehicleClick: (id: string) => void;
  simTime?: number;
  showTrails?: boolean;
  showHeatmap?: boolean;
}

export function MapView({
  vehicles,
  warehouses,
  orders = [],
  incidents = [],
  selectedVehicleId,
  onVehicleClick,
  simTime = 0,
  showTrails = true,
  showHeatmap = true,
}: MapViewProps) {
  const [viewState, setViewState] = useState(DEFAULT_CENTER);
  const [mapTheme, setMapTheme] = useState<'dark' | 'liberty'>('dark');

  // Interactive Map Navigation Controls
  const handleZoomIn = () => setViewState((prev) => ({ ...prev, zoom: Math.min(18, prev.zoom + 1) }));
  const handleZoomOut = () => setViewState((prev) => ({ ...prev, zoom: Math.max(10, prev.zoom - 1) }));
  const handleRecenter = () => setViewState(DEFAULT_CENTER);
  const handleTogglePitch = () =>
    setViewState((prev) => ({
      ...prev,
      pitch: prev.pitch === 0 ? 45 : 0,
    }));
  const handleToggleTheme = () =>
    setMapTheme((prev) => (prev === 'dark' ? 'liberty' : 'dark'));

  // Rich Deck.gl Tooltip Renderer
  const getTooltip = useCallback(
    ({ object }: { object?: any }) => {
      if (!object) return null;

      // 1. Vehicle Tooltip
      if ('capacity_kg' in object && 'driverId' in object) {
        const v = object as Vehicle;
        const loadPercent = Math.min(100, Math.round((v.currentLoad_kg / (v.capacity_kg || 1)) * 100));
        return {
          html: `
            <div style="padding: 8px 10px; background: rgba(13, 13, 21, 0.95); border: 1px solid rgba(0, 229, 255, 0.4); border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); font-family: monospace; font-size: 11px; color: #e2e8f0; line-height: 1.4;">
              <div style="font-weight: bold; color: #00e5ff; font-size: 12px; margin-bottom: 4px;">🚚 ${v.id} (${v.type.toUpperCase()})</div>
              <div>Driver: <span style="color: #94a3b8;">${v.driverId}</span></div>
              <div>Status: <span style="font-weight: bold; color: ${v.status === 'en_route' ? '#00e5ff' : v.status === 'delivering' ? '#ff9100' : v.status === 'idle' ? '#00e676' : '#ff1744'};">${v.status.toUpperCase()}</span></div>
              <div>Speed: <span style="color: #38bdf8;">${v.speed_kmh.toFixed(1)} km/h</span></div>
              <div style="margin-top: 4px;">
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 2px;">
                  <span>Load: ${v.currentLoad_kg}/${v.capacity_kg}kg</span>
                  <span>${loadPercent}%</span>
                </div>
                <div style="height: 4px; background: #334155; border-radius: 2px; overflow: hidden;">
                  <div style="width: ${loadPercent}%; height: 100%; background: ${loadPercent > 80 ? '#f43f5e' : '#00e5ff'};"></div>
                </div>
              </div>
              ${v.assignedOrderIds.length > 0 ? `<div style="margin-top: 5px; color: #f59e0b; font-size: 10px;">📦 Assigned: ${v.assignedOrderIds.join(', ')}</div>` : ''}
            </div>
          `,
        };
      }

      // 2. Order Tooltip
      if ('deliveryLocation' in object && 'priority' in object) {
        const o = object as Order;
        const priorityColor = o.priority === 'urgent' ? '#ff1744' : o.priority === 'express' ? '#ff9100' : '#38bdf8';
        const slaColor = o.slaStatus === 'breached' ? '#ff1744' : o.slaStatus === 'at_risk' ? '#f59e0b' : '#00e676';
        return {
          html: `
            <div style="padding: 8px 10px; background: rgba(13, 13, 21, 0.95); border: 1px solid rgba(255, 145, 0, 0.4); border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); font-family: monospace; font-size: 11px; color: #e2e8f0; line-height: 1.4;">
              <div style="font-weight: bold; color: #fbbf24; font-size: 12px; margin-bottom: 4px;">📦 ${o.id}</div>
              <div>Priority: <span style="font-weight: bold; color: ${priorityColor}; text-transform: uppercase;">${o.priority} (${o.slaDurationMin || 120}m)</span></div>
              <div>SLA: <span style="font-weight: bold; color: ${slaColor}; text-transform: uppercase;">${o.slaStatus || 'ON TIME'}</span></div>
              <div>Weight: <span style="color: #94a3b8;">${o.totalWeight_kg.toFixed(1)} kg</span></div>
              <div>Status: <span style="color: #94a3b8; text-transform: uppercase;">${o.status}</span></div>
            </div>
          `,
        };
      }

      // 3. Depot Tooltip
      if ('type' in object && (object.type === 'depot' || object.type === 'warehouse')) {
        const w = object as Warehouse;
        return {
          html: `
            <div style="padding: 8px 10px; background: rgba(13, 13, 21, 0.95); border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); font-family: monospace; font-size: 11px; color: #e2e8f0; line-height: 1.4;">
              <div style="font-weight: bold; color: #c084fc; font-size: 12px; margin-bottom: 4px;">🏢 ${w.name}</div>
              <div>ID: <span style="color: #94a3b8;">${w.id}</span></div>
              <div>Status: <span style="font-weight: bold; color: ${w.status === 'closed' ? '#f43f5e' : '#10b981'};">${(w.status || 'open').toUpperCase()}</span></div>
              <div>Capacity: <span style="color: #94a3b8;">${w.capacity.toLocaleString()} units</span></div>
            </div>
          `,
        };
      }

      // 4. Incident Tooltip
      if ('radiusM' in object && 'severity' in object) {
        const inc = object as RoadIncident;
        return {
          html: `
            <div style="padding: 8px 10px; background: rgba(26, 10, 10, 0.95); border: 1px solid rgba(239, 68, 68, 0.6); border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.6); font-family: monospace; font-size: 11px; color: #fecdd3; line-height: 1.4;">
              <div style="font-weight: bold; color: #f87171; font-size: 12px; margin-bottom: 4px;">⚠️ ${inc.description}</div>
              <div>Type: <span style="text-transform: uppercase; color: #fca5a5;">${inc.type}</span></div>
              <div>Severity: <span style="font-weight: bold; text-transform: uppercase; color: #ef4444;">${inc.severity}</span></div>
              <div>Radius: <span style="color: #cbd5e1;">${inc.radiusM}m zone</span></div>
            </div>
          `,
        };
      }

      return null;
    },
    []
  );

  const layers = useMemo(() => {
    // 1. Demand Density Heatmap
    const heatmapLayer = new HeatmapLayer({
      id: 'demand-heatmap-layer',
      data: orders.filter((o) => o.status === 'pending' || o.status === 'assigned'),
      getPosition: (d: Order) => [d.deliveryLocation.lon, d.deliveryLocation.lat],
      getWeight: (d: Order) => (d.priority === 'urgent' ? 4 : d.priority === 'express' ? 2 : 1),
      radiusPixels: 45,
      intensity: 1.3,
      threshold: 0.05,
      visible: showHeatmap,
      updateTriggers: {
        getWeight: [orders.length],
      },
    });

    // 2a. Vehicle Trail Glow Halo (Neon cyan / amber glow trailing moving vehicles)
    const trailGlowLayer = new PathLayer({
      id: 'vehicle-trail-glow-layer',
      data: vehicles.filter(
        (v) =>
          (v.status === 'en_route' || v.status === 'delivering' || v.status === 'returning') &&
          v.trailHistory &&
          v.trailHistory.length > 0
      ),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 6,
      widthMaxPixels: 14,
      capRounded: true,
      jointRounded: true,
      getPath: (d: Vehicle) => {
        const pts = (d.trailHistory || []).map((p) => [p[0], p[1]] as [number, number]);
        const curr: [number, number] = [d.position.lon, d.position.lat];
        const last = pts[pts.length - 1];
        if (!last || Math.abs(last[0] - curr[0]) > 0.00001 || Math.abs(last[1] - curr[1]) > 0.00001) {
          pts.push(curr);
        }
        if (pts.length === 1) {
          pts.push([pts[0][0] + 0.00005, pts[0][1] + 0.00005]);
        }
        return pts;
      },
      getColor: (d: Vehicle) =>
        d.status === 'delivering'
          ? [255, 145, 0, 140]
          : d.status === 'returning'
          ? [59, 130, 246, 120]
          : [0, 229, 255, 150],
      getWidth: 8,
      visible: showTrails,
      updateTriggers: {
        getPath: [vehicles.map((v) => `${v.id}:${v.trailHistory?.length || 0}:${v.position.lat.toFixed(4)}`).join(',')],
        getColor: [vehicles.map((v) => v.status).join(',')],
        visible: [showTrails],
      },
    });

    // 2b. Vehicle Trail Core (Electric white/cyan focused beam inside glow)
    const trailCoreLayer = new PathLayer({
      id: 'vehicle-trail-core-layer',
      data: vehicles.filter(
        (v) =>
          (v.status === 'en_route' || v.status === 'delivering' || v.status === 'returning') &&
          v.trailHistory &&
          v.trailHistory.length > 0
      ),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2.5,
      widthMaxPixels: 6,
      capRounded: true,
      jointRounded: true,
      getPath: (d: Vehicle) => {
        const pts = (d.trailHistory || []).map((p) => [p[0], p[1]] as [number, number]);
        const curr: [number, number] = [d.position.lon, d.position.lat];
        const last = pts[pts.length - 1];
        if (!last || Math.abs(last[0] - curr[0]) > 0.00001 || Math.abs(last[1] - curr[1]) > 0.00001) {
          pts.push(curr);
        }
        if (pts.length === 1) {
          pts.push([pts[0][0] + 0.00005, pts[0][1] + 0.00005]);
        }
        return pts;
      },
      getColor: (d: Vehicle) =>
        d.status === 'delivering'
          ? [255, 235, 180, 255]
          : d.status === 'returning'
          ? [210, 235, 255, 255]
          : [230, 255, 255, 255],
      getWidth: 3,
      visible: showTrails,
      updateTriggers: {
        getPath: [vehicles.map((v) => `${v.id}:${v.trailHistory?.length || 0}:${v.position.lat.toFixed(4)}`).join(',')],
        getColor: [vehicles.map((v) => v.status).join(',')],
        visible: [showTrails],
      },
    });

    // 3. Planned Route paths for vehicles (subtle ambient paths, highlighted for selected vehicle)
    const routeLayer = new PathLayer({
      id: 'routes-layer',
      data: vehicles.filter((v) => v.routeGeometry && v.routeGeometry.length > 1),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 1.5,
      widthMaxPixels: 6,
      getPath: (d: Vehicle) => d.routeGeometry,
      getColor: (d: Vehicle) =>
        d.id === selectedVehicleId
          ? [0, 229, 255, 230]
          : [41, 121, 255, 30],
      getWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 3.5 : 1.5),
      updateTriggers: {
        getColor: [selectedVehicleId],
        getWidth: [selectedVehicleId],
      },
    });

    // 4. Road Incident Hazard Zones
    const incidentLayer = new ScatterplotLayer({
      id: 'incidents-layer',
      data: (incidents || []).filter((i) => i.active),
      pickable: true,
      opacity: 0.65,
      stroked: true,
      filled: true,
      radiusUnits: 'meters',
      getRadius: (d: RoadIncident) => d.radiusM,
      getFillColor: [255, 30, 30, 75],
      getLineColor: [255, 50, 50, 240],
      getLineWidth: 2,
      lineWidthMinPixels: 2,
      updateTriggers: {
        getRadius: [incidents.map((i) => `${i.id}-${i.radiusM}`).join(',')],
      },
    });

    // 5. Active Order Delivery Pins
    const orderLayer = new ScatterplotLayer({
      id: 'orders-layer',
      data: orders.filter((o) => o.status === 'pending' || o.status === 'assigned'),
      pickable: true,
      opacity: 0.85,
      stroked: true,
      filled: true,
      radiusMinPixels: 3.5,
      radiusMaxPixels: 8,
      lineWidthMinPixels: 1.5,
      getPosition: (d: Order) => [d.deliveryLocation.lon, d.deliveryLocation.lat],
      getFillColor: (d: Order) =>
        d.priority === 'urgent'
          ? [255, 23, 68, 230]
          : d.priority === 'express'
          ? [255, 145, 0, 210]
          : [41, 121, 255, 180],
      getLineColor: (d: Order) =>
        d.slaStatus === 'breached'
          ? [255, 23, 68, 255]
          : d.slaStatus === 'at_risk'
          ? [255, 235, 59, 255]
          : [255, 255, 255, 200],
      updateTriggers: {
        getFillColor: [orders.map((o) => o.priority).join(',')],
        getLineColor: [orders.map((o) => o.slaStatus).join(',')],
      },
    });

    // 6. Warehouse/depot markers
    const warehouseLayer = new ScatterplotLayer({
      id: 'warehouses-layer',
      data: warehouses,
      pickable: true,
      opacity: 0.9,
      stroked: true,
      filled: true,
      radiusMinPixels: 8,
      radiusMaxPixels: 20,
      lineWidthMinPixels: 2,
      getPosition: (d: Warehouse) => [d.position.lon, d.position.lat] as [number, number],
      getFillColor: [156, 39, 176, 200],
      getLineColor: [255, 255, 255, 200],
    });

    // 7. Vehicle markers
    const vehicleLayer = new ScatterplotLayer({
      id: 'vehicles-layer',
      data: vehicles,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      lineWidthMinPixels: 1.5,
      getPosition: (d: Vehicle) => [d.position.lon, d.position.lat] as [number, number],
      getFillColor: (d: Vehicle) => STATUS_COLORS[d.status] ?? [150, 150, 150, 200],
      getLineColor: (d: Vehicle) =>
        d.id === selectedVehicleId
          ? [255, 255, 255, 255]
          : d.rerouteCount && d.rerouteCount > 0
          ? [0, 229, 255, 220]
          : [0, 0, 0, 120],
      getLineWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 3.5 : d.rerouteCount && d.rerouteCount > 0 ? 2 : 1),
      onClick: (info) => {
        if (info.object) {
          onVehicleClick((info.object as Vehicle).id);
        }
      },
      updateTriggers: {
        getFillColor: [vehicles.map((v) => v.status).join(',')],
        getLineColor: [selectedVehicleId, vehicles.map((v) => v.rerouteCount || 0).join(',')],
        getLineWidth: [selectedVehicleId, vehicles.map((v) => v.rerouteCount || 0).join(',')],
      },
    });

    return [
      heatmapLayer,
      routeLayer,
      trailGlowLayer,
      trailCoreLayer,
      incidentLayer,
      orderLayer,
      warehouseLayer,
      vehicleLayer,
    ];
  }, [
    vehicles,
    warehouses,
    orders,
    incidents,
    selectedVehicleId,
    simTime,
    showTrails,
    showHeatmap,
    onVehicleClick,
  ]);

  return (
    <div className="map-container relative flex-1 h-full w-full">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }: any) => setViewState(viewState)}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        getCursor={({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : 'grab')}
      >
        <Map mapStyle={MAP_STYLES[mapTheme]} />
      </DeckGL>

      {/* Floating Ops Map HUD Controls */}
      <div className="absolute bottom-5 right-5 z-20 flex flex-col gap-1.5 bg-slate-950/85 backdrop-blur-md p-1.5 rounded-lg border border-slate-800 shadow-2xl text-xs select-none">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 flex items-center justify-center rounded bg-slate-900/90 text-slate-200 hover:text-white hover:bg-slate-800 transition-colors font-bold text-base cursor-pointer"
          title="Zoom In (+)"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 flex items-center justify-center rounded bg-slate-900/90 text-slate-200 hover:text-white hover:bg-slate-800 transition-colors font-bold text-base cursor-pointer"
          title="Zoom Out (−)"
        >
          −
        </button>
        <div className="h-px w-full bg-slate-800 my-0.5" />
        <button
          onClick={handleRecenter}
          className="w-8 h-8 flex items-center justify-center rounded bg-slate-900/90 text-cyan-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors text-sm cursor-pointer"
          title="Recenter Map to Phnom Penh Downtown"
        >
          🎯
        </button>
        <button
          onClick={handleTogglePitch}
          className={`w-8 h-8 flex items-center justify-center rounded text-[11px] font-mono font-bold transition-colors cursor-pointer ${
            viewState.pitch > 0 ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-slate-900/90 text-slate-400 hover:text-white'
          }`}
          title="Toggle 2D / 3D Pitch View"
        >
          {viewState.pitch > 0 ? '3D' : '2D'}
        </button>
        <button
          onClick={handleToggleTheme}
          className="w-8 h-8 flex items-center justify-center rounded bg-slate-900/90 text-amber-400 hover:text-amber-300 hover:bg-slate-800 transition-colors text-sm cursor-pointer"
          title={`Switch Map Theme (Current: ${mapTheme.toUpperCase()})`}
        >
          {mapTheme === 'dark' ? '🌙' : '☀️'}
        </button>
      </div>

      {/* Map Legend Chip */}
      <div className="absolute bottom-5 left-5 z-20 hidden md:flex items-center gap-3 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 shadow-xl pointer-events-none">
        <span className="text-slate-500 font-bold uppercase text-[10px]">Fleet:</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#00e5ff]"></span>En Route</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ff9100]"></span>Delivering</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#00e676]"></span>Idle</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ff1744]"></span>Broken Down</span>
        <span className="text-slate-600">|</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#a855f7]"></span>Depot</span>
      </div>
    </div>
  );
}
