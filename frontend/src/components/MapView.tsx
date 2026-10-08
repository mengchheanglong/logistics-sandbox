import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import Map from 'react-map-gl/maplibre';
import { DeckGL } from '@deck.gl/react';
import { ScatterplotLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Vehicle, Warehouse, RoadIncident, Order, Coordinate, TelemetryPlaybackPing } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface DestinationInfo {
  id: string;
  vehicleId: string;
  type: 'order_drop' | 'depot_return';
  label: string;
  position: Coordinate;
  distanceKm: number;
  priority?: string;
  slaStatus?: string;
  orderId?: string;
}

/**
 * Calculates forward azimuth bearing (degrees 0-360) between two coordinates.
 */
export function calculateBearing(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number
): number {
  const startLatRad = (startLat * Math.PI) / 180;
  const startLonRad = (startLon * Math.PI) / 180;
  const endLatRad = (endLat * Math.PI) / 180;
  const endLonRad = (endLon * Math.PI) / 180;

  const dLon = endLonRad - startLonRad;
  const y = Math.sin(dLon) * Math.cos(endLatRad);
  const x =
    Math.cos(startLatRad) * Math.sin(endLatRad) -
    Math.sin(startLatRad) * Math.cos(endLatRad) * Math.cos(dLon);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Calculates great-circle haversine distance between two coordinates in kilometers.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Extracts remaining route path along road network from vehicle position to destination.
 */
export function getRemainingPath(
  currentPos: Coordinate,
  fullPath: [number, number][],
  progress: number
): [number, number][] {
  if (!fullPath || fullPath.length < 2) return [];

  const targetIndex = Math.min(
    fullPath.length - 1,
    Math.max(0, Math.floor(progress * (fullPath.length - 1)))
  );

  const remaining: [number, number][] = [
    [currentPos.lon, currentPos.lat],
    ...fullPath.slice(targetIndex + 1),
  ];

  if (remaining.length === 1 && fullPath.length > 0) {
    remaining.push(fullPath[fullPath.length - 1]);
  }

  return remaining;
}

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

// 🚚 FLEET VEHICLE STATUS PALETTE (High-contrast electric colors)
export const FLEET_STATUS_PALETTE: Record<
  string,
  { fill: [number, number, number, number]; hex: string; label: string; icon: string }
> = {
  en_route: {
    fill: [0, 240, 255, 240], // Electric Cyan
    hex: '#00f0ff',
    label: 'En Route (Moving)',
    icon: '⚡',
  },
  delivering: {
    fill: [245, 158, 11, 240], // Bright Amber
    hex: '#f59e0b',
    label: 'Delivering (At Stop)',
    icon: '📦',
  },
  returning: {
    fill: [96, 165, 250, 240], // Cobalt Sky Blue
    hex: '#60a5fa',
    label: 'Returning to Depot',
    icon: '🏢',
  },
  idle: {
    fill: [16, 185, 129, 230], // Emerald Green
    hex: '#10b981',
    label: 'Idle at Depot',
    icon: '🟢',
  },
  broken_down: {
    fill: [239, 68, 68, 250], // Crimson Red
    hex: '#ef4444',
    label: 'Broken Down',
    icon: '🔴',
  },
};

// 📦 CUSTOMER ORDER PRIORITY PALETTE (Soft drop pins distinct from vehicle beacons)
export const ORDER_PRIORITY_PALETTE: Record<
  string,
  { fill: [number, number, number, number]; stroke: [number, number, number, number]; hex: string; label: string }
> = {
  urgent: {
    fill: [244, 63, 94, 220], // Rose Pink
    stroke: [255, 255, 255, 250],
    hex: '#f43f5e',
    label: 'Urgent (<30m SLA)',
  },
  express: {
    fill: [249, 115, 22, 200], // Tangerine
    stroke: [254, 215, 170, 220],
    hex: '#f97316',
    label: 'Express (<60m SLA)',
  },
  standard: {
    fill: [56, 189, 248, 160], // Soft Sky Blue
    stroke: [186, 230, 253, 180],
    hex: '#38bdf8',
    label: 'Standard (<120m SLA)',
  },
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
  showOrders?: boolean;
  showLegend?: boolean;
  onToggleLegend?: () => void;
  chaseMode?: boolean;
  onToggleChaseMode?: () => void;
  playbackCurrentPing?: TelemetryPlaybackPing | null;
  playbackTrailPings?: TelemetryPlaybackPing[];
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
  showHeatmap = false,
  showOrders = true,
  showLegend = true,
  onToggleLegend,
  chaseMode = false,
  onToggleChaseMode,
  playbackCurrentPing,
  playbackTrailPings = [],
}: MapViewProps) {
  const [viewState, setViewState] = useState(DEFAULT_CENTER);
  const [mapTheme, setMapTheme] = useState<'dark' | 'liberty'>('dark');
  const [legendCollapsed, setLegendCollapsed] = useState<boolean>(false);

  // 3D Chase Cam Tracker: lock camera to vehicle position and align bearing with heading
  useEffect(() => {
    if (!chaseMode || !selectedVehicleId) return;

    const targetVehicle = vehicles.find((v) => v.id === selectedVehicleId);
    if (!targetVehicle) return;

    let targetBearing: number | null = null;
    const history = targetVehicle.trailHistory || [];
    if (history.length >= 2) {
      const pPrev = history[history.length - 2];
      const pCurr = history[history.length - 1];
      targetBearing = calculateBearing(pPrev[1], pPrev[0], pCurr[1], pCurr[0]);
    } else if (targetVehicle.routeGeometry && targetVehicle.routeGeometry.length >= 2) {
      const p0 = targetVehicle.routeGeometry[0];
      const p1 = targetVehicle.routeGeometry[1];
      targetBearing = calculateBearing(p0[1], p0[0], p1[1], p1[0]);
    }

    setViewState((prev) => ({
      ...prev,
      longitude: targetVehicle.position.lon,
      latitude: targetVehicle.position.lat,
      zoom: Math.max(prev.zoom, 16.5),
      pitch: 52,
      bearing: targetBearing !== null && !isNaN(targetBearing) ? targetBearing : prev.bearing,
    }));
  }, [chaseMode, selectedVehicleId, vehicles]);

  // Smoothly restore natural camera angle when chase mode disengages
  const prevChaseModeRef = useRef(chaseMode);
  useEffect(() => {
    if (prevChaseModeRef.current && !chaseMode) {
      setViewState((prev) => ({
        ...prev,
        pitch: 30,
        bearing: 0,
      }));
    }
    prevChaseModeRef.current = chaseMode;
  }, [chaseMode]);

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

  // Focus View: when a vehicle is selected, default to showing ONLY its destinations
  const [focusDestinationOnly, setFocusDestinationOnly] = useState<boolean>(true);

  // Automatically reset to focused destination view whenever vehicle selection changes
  useEffect(() => {
    if (selectedVehicleId) {
      setFocusDestinationOnly(true);
    }
  }, [selectedVehicleId]);

  const selectedVehicle = useMemo(
    () => (selectedVehicleId ? vehicles.find((v) => v.id === selectedVehicleId) : null),
    [vehicles, selectedVehicleId]
  );

  // Extract all forward destinations for the selected vehicle
  const selectedDestinations = useMemo(() => {
    if (!selectedVehicle) return [];
    const list: DestinationInfo[] = [];

    // 1. Multi-stop route legs
    if (selectedVehicle.routeLegs && selectedVehicle.routeLegs.length > 0) {
      selectedVehicle.routeLegs.forEach((leg, idx) => {
        const isPending = idx >= (selectedVehicle.currentLegIndex ?? 0);
        if (!isPending) return;

        if (leg.orderId) {
          const ord = orders.find((o) => o.id === leg.orderId);
          const distKm = haversineDistanceKm(
            selectedVehicle.position.lat,
            selectedVehicle.position.lon,
            leg.destination.lat,
            leg.destination.lon
          );
          list.push({
            id: `dest-${selectedVehicle.id}-${leg.orderId}-${idx}`,
            vehicleId: selectedVehicle.id,
            type: 'order_drop',
            label: `Drop #${idx + 1}: ${leg.orderId}`,
            position: leg.destination,
            distanceKm: distKm,
            priority: ord?.priority || 'standard',
            slaStatus: ord?.slaStatus,
            orderId: leg.orderId,
          });
        } else {
          const depot = warehouses.find((w) => w.id === selectedVehicle.depotId);
          const distKm = haversineDistanceKm(
            selectedVehicle.position.lat,
            selectedVehicle.position.lon,
            leg.destination.lat,
            leg.destination.lon
          );
          list.push({
            id: `dest-${selectedVehicle.id}-depot-${idx}`,
            vehicleId: selectedVehicle.id,
            type: 'depot_return',
            label: `Return to ${depot?.name || 'Depot'}`,
            position: leg.destination,
            distanceKm: distKm,
          });
        }
      });
    } else {
      // 2. Assigned orders or return to depot
      if (selectedVehicle.assignedOrderIds && selectedVehicle.assignedOrderIds.length > 0) {
        selectedVehicle.assignedOrderIds.forEach((orderId, idx) => {
          const ord = orders.find((o) => o.id === orderId);
          if (ord) {
            const distKm = haversineDistanceKm(
              selectedVehicle.position.lat,
              selectedVehicle.position.lon,
              ord.deliveryLocation.lat,
              ord.deliveryLocation.lon
            );
            list.push({
              id: `dest-${selectedVehicle.id}-${orderId}-${idx}`,
              vehicleId: selectedVehicle.id,
              type: 'order_drop',
              label: `Order ${orderId}`,
              position: ord.deliveryLocation,
              distanceKm: distKm,
              priority: ord.priority || 'standard',
              slaStatus: ord.slaStatus,
              orderId,
            });
          }
        });
      }

      if (selectedVehicle.status === 'returning' || (list.length === 0 && selectedVehicle.depotId)) {
        const depot = warehouses.find((w) => w.id === selectedVehicle.depotId);
        if (depot) {
          const distKm = haversineDistanceKm(
            selectedVehicle.position.lat,
            selectedVehicle.position.lon,
            depot.position.lat,
            depot.position.lon
          );
          list.push({
            id: `dest-${selectedVehicle.id}-depot`,
            vehicleId: selectedVehicle.id,
            type: 'depot_return',
            label: `Return to ${depot.name} Depot`,
            position: depot.position,
            distanceKm: distKm,
          });
        }
      }
    }

    // Fallback: If routeGeometry exists but no order was mapped, use endpoint of route geometry
    if (list.length === 0 && selectedVehicle.routeGeometry && selectedVehicle.routeGeometry.length > 1) {
      const lastPoint = selectedVehicle.routeGeometry[selectedVehicle.routeGeometry.length - 1];
      const distKm = haversineDistanceKm(
        selectedVehicle.position.lat,
        selectedVehicle.position.lon,
        lastPoint[1],
        lastPoint[0]
      );
      list.push({
        id: `dest-${selectedVehicle.id}-endpoint`,
        vehicleId: selectedVehicle.id,
        type: 'order_drop',
        label: `Destination Terminal`,
        position: { lat: lastPoint[1], lon: lastPoint[0] },
        distanceKm: distKm,
      });
    }

    return list;
  }, [selectedVehicle, orders, warehouses]);

  // Live Entity Counts for Legend HUD
  const fleetCounts = useMemo(() => {
    const counts: Record<string, number> = { en_route: 0, delivering: 0, returning: 0, idle: 0, broken_down: 0 };
    for (const v of vehicles) {
      if (counts[v.status] !== undefined) counts[v.status]++;
    }
    return counts;
  }, [vehicles]);

  const orderCounts = useMemo(() => {
    const counts: Record<string, number> = { urgent: 0, express: 0, standard: 0 };
    for (const o of orders) {
      if (o.status === 'pending' || o.status === 'assigned') {
        const p = o.priority || 'standard';
        if (counts[p] !== undefined) counts[p]++;
      }
    }
    return counts;
  }, [orders]);

  // High-Clarity Tooltip Renderer
  const getTooltip = useCallback(
    ({ object }: { object?: any }) => {
      if (!object) return null;

      // 1. Fleet Vehicle Tooltip
      if ('capacity_kg' in object && 'driverId' in object) {
        const v = object as Vehicle;
        const loadPercent = Math.min(100, Math.round((v.currentLoad_kg / (v.capacity_kg || 1)) * 100));
        const statusMeta = FLEET_STATUS_PALETTE[v.status] || FLEET_STATUS_PALETTE.idle;
        return {
          html: `
            <div style="padding: 10px 12px; background: rgba(10, 15, 30, 0.96); border: 1px solid rgba(0, 240, 255, 0.5); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.8); font-family: monospace; font-size: 11px; color: #e2e8f0; line-height: 1.45; min-width: 180px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
                <span style="font-weight: bold; color: #00f0ff; font-size: 13px;">🚚 ${v.id}</span>
                <span style="font-size: 10px; background: rgba(0,240,255,0.15); color: #00f0ff; padding: 2px 5px; border-radius: 4px;">${v.type.toUpperCase()}</span>
              </div>
              <div>Status: <span style="font-weight: bold; color: ${statusMeta.hex};">${statusMeta.label.toUpperCase()}</span></div>
              <div>Driver: <span style="color: #cbd5e1;">${v.driverId}</span></div>
              <div>Speed: <span style="color: #38bdf8; font-weight: bold;">${v.speed_kmh.toFixed(1)} km/h</span></div>
              <div style="margin-top: 6px;">
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-bottom: 2px;">
                  <span>Capacity Load</span>
                  <span>${v.currentLoad_kg}/${v.capacity_kg} kg (${loadPercent}%)</span>
                </div>
                <div style="height: 5px; background: #1e293b; border-radius: 3px; overflow: hidden;">
                  <div style="width: ${loadPercent}%; height: 100%; background: ${loadPercent > 80 ? '#f43f5e' : '#00f0ff'};"></div>
                </div>
              </div>
              ${v.assignedOrderIds.length > 0 ? `<div style="margin-top: 6px; color: #fbbf24; font-size: 10px;">📦 Carrying Orders: ${v.assignedOrderIds.join(', ')}</div>` : ''}
              <div style="margin-top: 6px; font-size: 9px; color: #64748b; text-align: right;">Click vehicle to trace corridor</div>
            </div>
          `,
        };
      }

      // 2. Customer Order Destination Tooltip
      if ('deliveryLocation' in object && 'priority' in object) {
        const o = object as Order;
        const priorityMeta = ORDER_PRIORITY_PALETTE[o.priority || 'standard'] || ORDER_PRIORITY_PALETTE.standard;
        const slaColor = o.slaStatus === 'breached' ? '#ef4444' : o.slaStatus === 'at_risk' ? '#f59e0b' : '#10b981';
        return {
          html: `
            <div style="padding: 10px 12px; background: rgba(15, 10, 25, 0.96); border: 1px solid rgba(244, 63, 94, 0.5); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.8); font-family: monospace; font-size: 11px; color: #e2e8f0; line-height: 1.45; min-width: 170px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
                <span style="font-weight: bold; color: #fbbf24; font-size: 13px;">📦 ${o.id}</span>
                <span style="font-size: 10px; background: rgba(244,63,94,0.15); color: ${priorityMeta.hex}; padding: 2px 5px; border-radius: 4px; font-weight: bold;">${o.priority?.toUpperCase()}</span>
              </div>
              <div>Entity: <span style="color: #a855f7; font-weight: bold;">Customer Drop Point</span></div>
              <div>Target SLA: <span style="color: #cbd5e1;">${o.slaDurationMin || 120} min</span></div>
              <div>SLA Health: <span style="font-weight: bold; color: ${slaColor};">${(o.slaStatus || 'on_time').toUpperCase()}</span></div>
              <div>Package Weight: <span style="color: #cbd5e1;">${o.totalWeight_kg.toFixed(1)} kg</span></div>
              <div>State: <span style="color: ${o.status === 'assigned' ? '#00f0ff' : '#94a3b8'}; text-transform: uppercase; font-weight: bold;">${o.status}</span></div>
            </div>
          `,
        };
      }

      // 3. Distribution Depot Tooltip
      if ('type' in object && (object.type === 'depot' || object.type === 'warehouse')) {
        const w = object as Warehouse;
        return {
          html: `
            <div style="padding: 10px 12px; background: rgba(25, 12, 38, 0.96); border: 1px solid rgba(168, 85, 247, 0.6); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.8); font-family: monospace; font-size: 11px; color: #e2e8f0; line-height: 1.45; min-width: 170px;">
              <div style="font-weight: bold; color: #d8b4fe; font-size: 13px; margin-bottom: 4px;">🏢 ${w.name} Hub</div>
              <div>Entity: <span style="color: #c084fc; font-weight: bold;">Primary Fleet Base</span></div>
              <div>Hub ID: <span style="color: #94a3b8;">${w.id}</span></div>
              <div>Status: <span style="font-weight: bold; color: ${w.status === 'closed' ? '#ef4444' : '#10b981'};">${(w.status || 'open').toUpperCase()}</span></div>
              <div>Hub Capacity: <span style="color: #cbd5e1;">${w.capacity.toLocaleString()} packages</span></div>
            </div>
          `,
        };
      }

      // 4. Incident Tooltip
      if ('radiusM' in object && 'severity' in object) {
        const inc = object as RoadIncident;
        return {
          html: `
            <div style="padding: 10px 12px; background: rgba(30, 10, 15, 0.96); border: 1px solid rgba(239, 68, 68, 0.7); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.8); font-family: monospace; font-size: 11px; color: #fecdd3; line-height: 1.45;">
              <div style="font-weight: bold; color: #f87171; font-size: 13px; margin-bottom: 4px;">⚠️ ${inc.description}</div>
              <div>Hazard: <span style="text-transform: uppercase; color: #fca5a5;">${inc.type}</span></div>
              <div>Severity: <span style="font-weight: bold; text-transform: uppercase; color: #ef4444;">${inc.severity}</span></div>
              <div>Block Zone: <span style="color: #cbd5e1;">${inc.radiusM}m road perimeter</span></div>
            </div>
          `,
        };
      }

      // 5. Destination Beacon Tooltip
      if ('distanceKm' in object && 'label' in object) {
        const dest = object as DestinationInfo;
        return {
          html: `
            <div style="padding: 10px 12px; background: rgba(15, 23, 42, 0.98); border: 1px solid rgba(245, 158, 11, 0.7); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.85); font-family: monospace; font-size: 11px; color: #fef08a; line-height: 1.45; min-width: 180px;">
              <div style="font-weight: bold; font-size: 12px; color: #fbbf24; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
                🎯 ${dest.label}
              </div>
              <div>Target Type: <span style="color: #f59e0b; font-weight: bold;">${dest.type === 'order_drop' ? 'Customer Delivery Drop' : 'Depot Hub Return'}</span></div>
              <div>Distance from Courier: <span style="color: #38bdf8; font-weight: bold;">${dest.distanceKm.toFixed(2)} km</span></div>
              ${dest.priority ? `<div>Priority: <span style="color: #fb923c; text-transform: uppercase;">${dest.priority}</span></div>` : ''}
              ${dest.slaStatus ? `<div>SLA: <span style="color: ${dest.slaStatus === 'breached' ? '#ef4444' : dest.slaStatus === 'at_risk' ? '#f59e0b' : '#10b981'}; font-weight: bold;">${dest.slaStatus.toUpperCase()}</span></div>` : ''}
            </div>
          `,
        };
      }

      return null;
    },
    []
  );

  const layers = useMemo(() => {
    // 1. Demand Density Heatmap (Sleek dark operations density gradient)
    const heatmapLayer = new HeatmapLayer({
      id: 'demand-heatmap-layer',
      data: orders.filter((o) => o.status === 'pending' || o.status === 'assigned'),
      getPosition: (d: Order) => [d.deliveryLocation.lon, d.deliveryLocation.lat],
      getWeight: (d: Order) => (d.priority === 'urgent' ? 4 : d.priority === 'express' ? 2 : 1),
      radiusPixels: 32,
      intensity: 0.85,
      threshold: 0.08,
      colorRange: [
        [30, 27, 75, 40],   // subtle indigo
        [79, 70, 229, 120], // royal violet
        [6, 182, 212, 160], // vivid cyan
        [245, 158, 11, 200],// amber
        [239, 68, 68, 240], // crimson hotspot
      ],
      visible: showHeatmap,
      updateTriggers: {
        getWeight: [orders.length],
      },
    });

    // 2. Planned Route paths for vehicles (subtle ambient paths, bold highlight for selected)
    const routeLayer = new PathLayer({
      id: 'routes-layer',
      data: vehicles.filter((v) => v.routeGeometry && v.routeGeometry.length > 1),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 1.5,
      widthMaxPixels: 5,
      getPath: (d: Vehicle) => d.routeGeometry,
      getColor: (d: Vehicle) =>
        d.id === selectedVehicleId
          ? [0, 240, 255, 180] // Cyan corridor for full planned tour
          : [70, 130, 210, 25], // Faint subtle ambient road network
      getWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 2.5 : 1.2),
      updateTriggers: {
        getColor: [selectedVehicleId],
        getWidth: [selectedVehicleId],
      },
    });

    // 2b. Luminous Sunburst Halo for Remaining Path to Active Destination (Forward Route)
    const destinationHaloLayer = new PathLayer({
      id: 'destination-halo-layer',
      data: vehicles.filter(
        (v) =>
          (v.id === selectedVehicleId || v.status === 'en_route' || v.status === 'returning') &&
          v.routeGeometry &&
          v.routeGeometry.length > 1
      ),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 4,
      widthMaxPixels: 14,
      capRounded: true,
      jointRounded: true,
      getPath: (v: Vehicle) => getRemainingPath(v.position, v.routeGeometry, v.routeProgress),
      getColor: (v: Vehicle) =>
        v.id === selectedVehicleId
          ? [245, 158, 11, 175] // Radiant Amber halo glow
          : [245, 158, 11, 45], // Subtle ambient forward path
      getWidth: (v: Vehicle) => (v.id === selectedVehicleId ? 7.5 : 2),
      updateTriggers: {
        getPath: [vehicles.map((v) => `${v.id}:${v.routeProgress.toFixed(3)}:${v.position.lat.toFixed(4)}`).join(',')],
        getColor: [selectedVehicleId],
        getWidth: [selectedVehicleId],
      },
    });

    // 2c. Crisp Forward Corridor to Target Destination (Distinct Electric Sunburst Gold Line)
    const destinationRemainingPathLayer = new PathLayer({
      id: 'destination-remaining-path-layer',
      data: vehicles.filter(
        (v) =>
          (v.id === selectedVehicleId || v.status === 'en_route' || v.status === 'returning') &&
          v.routeGeometry &&
          v.routeGeometry.length > 1
      ),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2,
      widthMaxPixels: 7,
      capRounded: true,
      jointRounded: true,
      getPath: (v: Vehicle) => getRemainingPath(v.position, v.routeGeometry, v.routeProgress),
      getColor: (v: Vehicle) =>
        v.id === selectedVehicleId
          ? [254, 240, 138, 255] // Electric Sunburst Gold core
          : [251, 191, 36, 120],
      getWidth: (v: Vehicle) => (v.id === selectedVehicleId ? 3.5 : 1.5),
      updateTriggers: {
        getPath: [vehicles.map((v) => `${v.id}:${v.routeProgress.toFixed(3)}:${v.position.lat.toFixed(4)}`).join(',')],
        getColor: [selectedVehicleId],
        getWidth: [selectedVehicleId],
      },
    });

    // 2d. Direct Line-of-Sight Bearing Beam (Direct Vector from Courier to Immediate Destination)
    const directVectorData =
      selectedVehicle && selectedDestinations.length > 0
        ? [
            {
              path: [
                [selectedVehicle.position.lon, selectedVehicle.position.lat] as [number, number],
                [selectedDestinations[0].position.lon, selectedDestinations[0].position.lat] as [number, number],
              ],
            },
          ]
        : [];

    const destinationBearingVectorLayer = new PathLayer({
      id: 'destination-bearing-vector-layer',
      data: directVectorData,
      pickable: false,
      widthScale: 1,
      widthMinPixels: 1.5,
      widthMaxPixels: 3.5,
      getPath: (d: { path: [number, number][] }) => d.path,
      getColor: [251, 191, 36, 200],
      getWidth: 2,
      updateTriggers: {
        getPath: [
          selectedVehicle?.position.lat,
          selectedVehicle?.position.lon,
          selectedDestinations[0]?.position.lat,
          selectedDestinations[0]?.position.lon,
        ],
      },
    });

    // 3a. Vehicle Animated Glowing Trail Halo (Neon wake trailing behind moving vehicles)
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
          ? [245, 158, 11, 140]
          : d.status === 'returning'
          ? [96, 165, 250, 120]
          : [0, 240, 255, 150],
      getWidth: 8,
      visible: showTrails,
      updateTriggers: {
        getPath: [vehicles.map((v) => `${v.id}:${v.trailHistory?.length || 0}:${v.position.lat.toFixed(4)}`).join(',')],
        getColor: [vehicles.map((v) => v.status).join(',')],
        visible: [showTrails],
      },
    });

    // 3b. Vehicle Trail Core Beam (Crisp electric white/cyan core running through the halo)
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
      getFillColor: [239, 68, 68, 75],
      getLineColor: [248, 113, 113, 240],
      getLineWidth: 2,
      lineWidthMinPixels: 2,
      updateTriggers: {
        getRadius: [incidents.map((i) => `${i.id}-${i.radiusM}`).join(',')],
      },
    });

    // 5. Customer Delivery Order Drop Pins (Filtered in Focus Mode)
    const filteredOrders =
      selectedVehicleId && focusDestinationOnly
        ? orders.filter(
            (o) =>
              o.assignedVehicleId === selectedVehicleId ||
              selectedVehicle?.assignedOrderIds?.includes(o.id)
          )
        : orders.filter((o) => o.status === 'pending' || o.status === 'assigned');

    const orderLayer = new ScatterplotLayer({
      id: 'orders-layer',
      data: filteredOrders,
      pickable: true,
      opacity: 0.85,
      stroked: true,
      filled: true,
      radiusMinPixels: 3,
      radiusMaxPixels: 6.5,
      lineWidthMinPixels: 1.5,
      getPosition: (d: Order) => [d.deliveryLocation.lon, d.deliveryLocation.lat],
      getFillColor: (d: Order) => {
        const meta = ORDER_PRIORITY_PALETTE[d.priority || 'standard'] || ORDER_PRIORITY_PALETTE.standard;
        if (d.status === 'assigned') {
          return [meta.fill[0], meta.fill[1], meta.fill[2], 140];
        }
        return meta.fill;
      },
      getLineColor: (d: Order) => {
        if (d.status === 'assigned') {
          return [0, 240, 255, 220]; // Cyan ring for assigned
        }
        const meta = ORDER_PRIORITY_PALETTE[d.priority || 'standard'] || ORDER_PRIORITY_PALETTE.standard;
        return meta.stroke;
      },
      visible: showOrders,
      updateTriggers: {
        getFillColor: [filteredOrders.map((o) => `${o.id}:${o.status}:${o.priority}`).join(',')],
        getLineColor: [filteredOrders.map((o) => `${o.id}:${o.status}`).join(',')],
        visible: [showOrders],
      },
    });

    // 6a. Distribution Hub Glowing Base Halo (Large distinct purple beacon)
    const warehouseHaloLayer = new ScatterplotLayer({
      id: 'warehouses-halo-layer',
      data: warehouses,
      pickable: false,
      opacity: 0.9,
      stroked: true,
      filled: true,
      radiusMinPixels: 13,
      radiusMaxPixels: 26,
      lineWidthMinPixels: 2.5,
      getPosition: (d: Warehouse) => [d.position.lon, d.position.lat],
      getFillColor: [147, 51, 234, 90],
      getLineColor: [216, 180, 254, 240],
    });

    // 6b. Distribution Hub Center Core Dot
    const warehouseCoreLayer = new ScatterplotLayer({
      id: 'warehouses-core-layer',
      data: warehouses,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 5,
      radiusMaxPixels: 9,
      lineWidthMinPixels: 1.5,
      getPosition: (d: Warehouse) => [d.position.lon, d.position.lat],
      getFillColor: [255, 255, 255, 255],
      getLineColor: [168, 85, 247, 240],
    });

    // 6c. Distribution Hub On-Map Text Labels
    const depotLabelLayer = new TextLayer({
      id: 'depot-labels-layer',
      data: warehouses,
      getPosition: (d: Warehouse) => [d.position.lon, d.position.lat],
      getText: (d: Warehouse) => `🏢 ${d.name} Hub`,
      getSize: 11,
      getColor: [243, 232, 255, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'top',
      getPixelOffset: [0, 18],
      backgroundColor: [15, 23, 42, 230],
      backgroundPadding: [6, 3, 6, 3],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      characterSet: 'auto',
    });

    // 6d. Destination Target Bullseye Halo (Pulsing Target Ring for Focus View)
    const destinationTargetBeaconLayer = new ScatterplotLayer({
      id: 'destination-target-beacon-layer',
      data: selectedDestinations,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 14,
      radiusMaxPixels: 26,
      lineWidthMinPixels: 2.5,
      getPosition: (d: DestinationInfo) => [d.position.lon, d.position.lat],
      getFillColor: [245, 158, 11, 75],
      getLineColor: [251, 191, 36, 255],
      updateTriggers: {
        getPosition: [selectedDestinations.map((d) => `${d.position.lon},${d.position.lat}`).join(',')],
      },
    });

    // 6e. Destination Target Pin Core
    const destinationTargetCoreLayer = new ScatterplotLayer({
      id: 'destination-target-core-layer',
      data: selectedDestinations,
      pickable: false,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 4.5,
      radiusMaxPixels: 8,
      lineWidthMinPixels: 2,
      getPosition: (d: DestinationInfo) => [d.position.lon, d.position.lat],
      getFillColor: [255, 255, 255, 255],
      getLineColor: [245, 158, 11, 255],
      updateTriggers: {
        getPosition: [selectedDestinations.map((d) => `${d.position.lon},${d.position.lat}`).join(',')],
      },
    });

    // 6f. Destination Floating HUD Callout Tag
    const destinationTagLayer = new TextLayer({
      id: 'destination-tag-layer',
      data: selectedDestinations,
      getPosition: (d: DestinationInfo) => [d.position.lon, d.position.lat],
      getText: (d: DestinationInfo) => `🎯 ${d.label} • ${d.distanceKm.toFixed(1)} km`,
      getSize: 11,
      getColor: [254, 240, 138, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      getPixelOffset: [0, -20],
      backgroundColor: [15, 23, 42, 240],
      backgroundPadding: [6, 3, 6, 3],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      characterSet: 'auto',
      updateTriggers: {
        getText: [selectedDestinations.map((d) => `${d.label}:${d.distanceKm.toFixed(1)}`).join(',')],
        getPosition: [selectedDestinations.map((d) => `${d.position.lat},${d.position.lon}`).join(',')],
      },
    });

    // 7a. Vehicle Beacon Outer Status Halo (Double-ring Navigation Transponder)
    const vehicleBeaconLayer = new ScatterplotLayer({
      id: 'vehicles-beacon-layer',
      data: vehicles,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 6.5,
      radiusMaxPixels: 14,
      lineWidthMinPixels: 2,
      getPosition: (d: Vehicle) => [d.position.lon, d.position.lat],
      getFillColor: (d: Vehicle) => FLEET_STATUS_PALETTE[d.status]?.fill ?? [150, 150, 150, 200],
      getLineColor: (d: Vehicle) =>
        d.id === selectedVehicleId
          ? [255, 255, 255, 255]
          : d.rerouteCount && d.rerouteCount > 0
          ? [0, 240, 255, 240]
          : [15, 23, 42, 240],
      getLineWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 3.5 : 2),
      onClick: (info) => {
        if (info.object) {
          onVehicleClick((info.object as Vehicle).id);
        }
      },
      updateTriggers: {
        getFillColor: [vehicles.map((v) => v.status).join(',')],
        getLineColor: [selectedVehicleId, vehicles.map((v) => v.rerouteCount || 0).join(',')],
        getLineWidth: [selectedVehicleId],
      },
    });

    // 7b. Vehicle Transponder Core (Bright white center dot giving GPS Rover appearance)
    const vehicleCoreLayer = new ScatterplotLayer({
      id: 'vehicles-core-layer',
      data: vehicles,
      pickable: false,
      opacity: 1,
      stroked: true,
      filled: true,
      radiusMinPixels: 2.5,
      radiusMaxPixels: 5,
      lineWidthMinPixels: 1,
      getPosition: (d: Vehicle) => [d.position.lon, d.position.lat],
      getFillColor: [255, 255, 255, 255],
      getLineColor: [15, 23, 42, 180],
      updateTriggers: {
        getPosition: [vehicles.map((v) => `${v.position.lon.toFixed(4)},${v.position.lat.toFixed(4)}`).join(',')],
      },
    });

    // 7c. Selected Vehicle Floating Tag
    const selectedVehicleLabelLayer = new TextLayer({
      id: 'selected-vehicle-label-layer',
      data: vehicles.filter((v) => v.id === selectedVehicleId),
      getPosition: (d: Vehicle) => [d.position.lon, d.position.lat],
      getText: (d: Vehicle) => `🚚 ${d.id} • ${d.status.toUpperCase()} (${d.speed_kmh.toFixed(0)} km/h)`,
      getSize: 11,
      getColor: [0, 240, 255, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      getPixelOffset: [0, -18],
      backgroundColor: [6, 18, 36, 240],
      backgroundPadding: [6, 3, 6, 3],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      characterSet: 'auto',
      updateTriggers: {
        getText: [vehicles.find((v) => v.id === selectedVehicleId)?.status, vehicles.find((v) => v.id === selectedVehicleId)?.speed_kmh],
        getPosition: [vehicles.find((v) => v.id === selectedVehicleId)?.position.lat],
      },
    });

    // Phase 4: Historical Cassandra Telemetry Breadcrumb Trail
    const playbackPathLayer = new PathLayer({
      id: 'playback-breadcrumb-trail-layer',
      data: playbackTrailPings && playbackTrailPings.length > 1 ? [{
        path: playbackTrailPings.map((p) => [p.lon, p.lat] as [number, number]),
      }] : [],
      pickable: false,
      widthMinPixels: 4,
      widthMaxPixels: 9,
      getPath: (d: any) => d.path,
      getColor: [245, 158, 11, 230], // Amber Gold Cassandra GPS Trail
      visible: !!(playbackTrailPings && playbackTrailPings.length > 1),
    });

    const playbackMarkerHaloLayer = new ScatterplotLayer({
      id: 'playback-vehicle-halo-layer',
      data: playbackCurrentPing ? [playbackCurrentPing] : [],
      pickable: true,
      stroked: true,
      filled: true,
      radiusMinPixels: 14,
      radiusMaxPixels: 28,
      lineWidthMinPixels: 3,
      getPosition: (d: TelemetryPlaybackPing) => [d.lon, d.lat],
      getFillColor: [245, 158, 11, 130],
      getLineColor: [255, 255, 255, 255],
      visible: !!playbackCurrentPing,
    });

    const playbackMarkerCoreLayer = new ScatterplotLayer({
      id: 'playback-vehicle-core-layer',
      data: playbackCurrentPing ? [playbackCurrentPing] : [],
      pickable: false,
      stroked: true,
      filled: true,
      radiusMinPixels: 6,
      radiusMaxPixels: 10,
      lineWidthMinPixels: 2,
      getPosition: (d: TelemetryPlaybackPing) => [d.lon, d.lat],
      getFillColor: [0, 240, 255, 255],
      getLineColor: [15, 23, 42, 255],
      visible: !!playbackCurrentPing,
    });

    const playbackLabelLayer = new TextLayer({
      id: 'playback-vehicle-label-layer',
      data: playbackCurrentPing ? [playbackCurrentPing] : [],
      getPosition: (d: TelemetryPlaybackPing) => [d.lon, d.lat],
      getText: (d: TelemetryPlaybackPing) => `📼 PLAYBACK: ${d.speed_kmh.toFixed(1)} km/h • Bat ${Math.round(d.battery_level)}%`,
      getSize: 11,
      getColor: [254, 240, 138, 255],
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      getPixelOffset: [0, -22],
      backgroundColor: [15, 23, 42, 240],
      backgroundPadding: [6, 3, 6, 3],
      fontFamily: 'monospace',
      fontWeight: 'bold',
      characterSet: 'auto',
      visible: !!playbackCurrentPing,
    });

    return [
      heatmapLayer,
      routeLayer,
      destinationHaloLayer,
      destinationRemainingPathLayer,
      destinationBearingVectorLayer,
      trailGlowLayer,
      trailCoreLayer,
      incidentLayer,
      orderLayer,
      warehouseHaloLayer,
      warehouseCoreLayer,
      depotLabelLayer,
      destinationTargetBeaconLayer,
      destinationTargetCoreLayer,
      destinationTagLayer,
      vehicleBeaconLayer,
      vehicleCoreLayer,
      selectedVehicleLabelLayer,
      playbackPathLayer,
      playbackMarkerHaloLayer,
      playbackMarkerCoreLayer,
      playbackLabelLayer,
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
    showOrders,
    onVehicleClick,
    selectedVehicle,
    selectedDestinations,
    focusDestinationOnly,
    playbackCurrentPing,
    playbackTrailPings,
  ]);

  return (
    <div className="map-container relative flex-1 h-full w-full">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState, interactionState }: any) => {
          // If the operator manually drags, pans, or rotates while chase mode is active, disengage immediately
          if (
            chaseMode &&
            (interactionState?.isDragging || interactionState?.isPanning || interactionState?.isRotating) &&
            onToggleChaseMode
          ) {
            onToggleChaseMode();
          }
          setViewState(viewState);
        }}
        controller={true}
        layers={layers}
        getTooltip={getTooltip}
        getCursor={({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : 'grab')}
      >
        <Map mapStyle={MAP_STYLES[mapTheme]} />
      </DeckGL>

      {/* 3D Chase Camera Active Tracker Banner */}
      {chaseMode && selectedVehicle && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-slate-950/95 backdrop-blur-md px-4 py-2 rounded-full border border-cyan-400/80 shadow-[0_0_30px_rgba(0,240,255,0.4)] text-xs font-mono select-none animate-in fade-in zoom-in-95 duration-150">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
          <span className="font-bold text-cyan-300">
            CHASE CAM: {selectedVehicle.name} ({selectedVehicle.id})
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-sky-300 font-bold">{selectedVehicle.speed_kmh.toFixed(0)} KM/H</span>
          <span className="text-slate-600">|</span>
          <span className={`font-bold ${FLEET_STATUS_PALETTE[selectedVehicle.status]?.hex || 'text-cyan-400'}`}>
            {selectedVehicle.status.replace(/_/g, ' ').toUpperCase()}
          </span>
          <button
            onClick={() => setFocusDestinationOnly((prev) => !prev)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-all border ${
              focusDestinationOnly
                ? 'bg-amber-500/25 text-amber-200 border-amber-400/80'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Toggle focus view: show only this vehicle destination or all orders"
          >
            {focusDestinationOnly ? 'ONLY DESTINATIONS ✓' : 'SHOW ALL ORDERS'}
          </button>
          {onToggleChaseMode && (
            <button
              onClick={onToggleChaseMode}
              className="ml-2 px-3 py-1 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/50 cursor-pointer transition-all flex items-center gap-1 active:scale-95"
              title="Exit Chase Camera (Esc or Drag Map)"
            >
              <span>✕</span> EXIT 3D (ESC)
            </button>
          )}
        </div>
      )}

      {/* Vehicle Destination Focus View HUD Banner (When in standard 2D view) */}
      {!chaseMode && selectedVehicle && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 bg-slate-950/95 backdrop-blur-md px-4 py-2 rounded-full border border-amber-500/70 shadow-[0_0_25px_rgba(245,158,11,0.35)] text-xs font-mono select-none animate-in fade-in zoom-in-95 duration-150">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
          <span className="font-bold text-amber-300">
            🎯 FOCUS: {selectedVehicle.name} ({selectedVehicle.id})
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-300">
            {selectedDestinations.length > 0
              ? `${selectedDestinations.length} Target Stop${selectedDestinations.length > 1 ? 's' : ''}`
              : selectedVehicle.status === 'returning'
              ? 'Returning to Depot'
              : 'En Route'}
          </span>
          <button
            onClick={() => setFocusDestinationOnly((prev) => !prev)}
            className={`ml-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-all border ${
              focusDestinationOnly
                ? 'bg-amber-500/25 text-amber-200 border-amber-400/80 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Toggle between showing only this vehicle's destinations or all map drop points"
          >
            {focusDestinationOnly ? 'ONLY DESTINATIONS ✓' : 'SHOW ALL ORDERS'}
          </button>
          {onToggleChaseMode && (
            <button
              onClick={onToggleChaseMode}
              className="px-2.5 py-0.5 rounded-full bg-slate-900 text-cyan-400 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500/50 text-[10px] font-bold cursor-pointer transition-colors"
              title="Engage 3D Chase Camera"
            >
              🎥 3D VIEW
            </button>
          )}
          <button
            onClick={() => onVehicleClick('')}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-rose-300 hover:bg-slate-700 text-[11px] cursor-pointer"
            title="Exit Focus View (Esc)"
          >
            ✕
          </button>
        </div>
      )}

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
        {selectedVehicleId && onToggleChaseMode && (
          <button
            onClick={onToggleChaseMode}
            className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors cursor-pointer ${
              chaseMode
                ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.4)] animate-pulse'
                : 'bg-slate-900/90 text-slate-400 hover:text-cyan-300 hover:bg-slate-800'
            }`}
            title={chaseMode ? 'Exit 3D Chase Camera' : `Engage 3D Chase Cam for ${selectedVehicleId}`}
          >
            🎥
          </button>
        )}
        <button
          onClick={handleToggleTheme}
          className="w-8 h-8 flex items-center justify-center rounded bg-slate-900/90 text-amber-400 hover:text-amber-300 hover:bg-slate-800 transition-colors text-sm cursor-pointer"
          title={`Switch Map Theme (Current: ${mapTheme.toUpperCase()})`}
        >
          {mapTheme === 'dark' ? '🌙' : '☀️'}
        </button>
      </div>

      {/* Comprehensive Tactical Symbology Legend HUD */}
      {showLegend && (
        <div className="absolute bottom-5 left-5 z-20 bg-slate-950/92 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-3 max-w-[340px] text-xs font-mono select-none transition-all">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-200 text-xs">
              <span className="text-cyan-400">🎯</span> Tactical Map Legend
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                {vehicles.length} Units
              </span>
              <button
                onClick={() => setLegendCollapsed((prev) => !prev)}
                className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 text-[10px] cursor-pointer"
                title={legendCollapsed ? 'Expand Legend' : 'Collapse Legend'}
              >
                {legendCollapsed ? '▲' : '▼'}
              </button>
              {onToggleLegend && (
                <button
                  onClick={onToggleLegend}
                  className="w-5 h-5 flex items-center justify-center rounded bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-slate-800 text-[10px] cursor-pointer"
                  title="Close Legend HUD"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {!legendCollapsed ? (
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {/* Category 1: Fleet Transponders */}
              <div>
                <div className="text-[10px] uppercase font-bold text-cyan-400 mb-1.5 flex items-center justify-between">
                  <span>🚚 Fleet Transponders (Vehicles)</span>
                  <span className="text-slate-500 text-[9px]">Double Ring</span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#00f0ff] ring-1 ring-white/50 shrink-0"></span>
                    <span className="truncate">En Route ({fleetCounts.en_route})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] ring-1 ring-white/50 shrink-0"></span>
                    <span className="truncate">Delivering ({fleetCounts.delivering})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#60a5fa] ring-1 ring-white/50 shrink-0"></span>
                    <span className="truncate">Returning ({fleetCounts.returning})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#10b981] ring-1 ring-white/50 shrink-0"></span>
                    <span className="truncate">Idle ({fleetCounts.idle})</span>
                  </div>
                  <div className="flex items-center gap-1.5 col-span-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444] ring-1 ring-white/50 shrink-0"></span>
                    <span className="truncate">Broken Down ({fleetCounts.broken_down})</span>
                  </div>
                </div>
              </div>

              {/* Category 2: Customer Delivery Orders */}
              <div className="border-t border-slate-800/80 pt-2">
                <div className="text-[10px] uppercase font-bold text-amber-400 mb-1.5 flex items-center justify-between">
                  <span>📦 Customer Drop Points (Orders)</span>
                  <span className="text-slate-500 text-[9px]">Small Pin</span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-[11px] text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#f43f5e] shrink-0"></span>
                      <span>Urgent SLA (&lt;30m)</span>
                    </span>
                    <span className="text-[10px] text-rose-400 font-bold">{orderCounts.urgent}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#f97316] shrink-0"></span>
                      <span>Express SLA (&lt;60m)</span>
                    </span>
                    <span className="text-[10px] text-orange-400 font-bold">{orderCounts.express}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#38bdf8] shrink-0"></span>
                      <span>Standard SLA (&lt;120m)</span>
                    </span>
                    <span className="text-[10px] text-sky-400 font-bold">{orderCounts.standard}</span>
                  </div>
                </div>
              </div>

              {/* Category 3: Infrastructure & Visual Layers */}
              <div className="border-t border-slate-800/80 pt-2 text-[10px] text-slate-400 space-y-1">
                <div className="text-[10px] uppercase font-bold text-purple-400 mb-1">
                  🏢 Infrastructure & Visual Layers
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#a855f7] ring-2 ring-purple-300 shrink-0"></span>
                  <span className="text-slate-300">Depot Hubs (Depot A & Depot B)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-gradient-to-r from-cyan-400 to-transparent shrink-0"></span>
                  <span>Vehicle Motion Comet Trails (Speed vectors)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-cyan-400 shrink-0"></span>
                  <span>Selected Vehicle Planned Route Corridor</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-amber-400 shrink-0 shadow-[0_0_8px_rgba(251,191,36,0.8)]"></span>
                  <span className="text-amber-200 font-bold">Forward Route to Destination (Gold Line)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-amber-300/80 shrink-0"></span>
                  <span className="text-amber-200 font-bold">Target Drop Bullseye (Focus Mode)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-amber-500 to-rose-500 shrink-0"></span>
                  <span>Demand Heatmap Density Clusters</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500/40 border border-red-500 shrink-0"></span>
                  <span>Monsoon Flooding / Road Hazard Perimeter</span>
                </div>
              </div>

              {/* Bottom Quick Tip */}
              <div className="border-t border-slate-800/80 pt-1.5 text-[9px] text-slate-500 flex justify-between">
                <span>Tip: Click vehicle to track</span>
                <span>[O] Orders • [T] Trails • [H] Heat</span>
              </div>
            </div>
          ) : (
            <div className="text-[10px] text-slate-400 flex items-center justify-between">
              <span>Fleet: <b className="text-cyan-400">{fleetCounts.en_route} Active</b></span>
              <span>Orders: <b className="text-amber-400">{orders.length}</b></span>
              <span className="text-[9px] text-slate-500">Click ▲ to expand</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
