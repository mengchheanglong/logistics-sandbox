import { useMemo } from 'react';
import Map from 'react-map-gl/maplibre';
import { DeckGL } from '@deck.gl/react';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { Vehicle, Warehouse, RoadIncident, Order } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

const INITIAL_VIEW_STATE = {
  longitude: 104.9282,
  latitude: 11.5564,
  zoom: 13,
  pitch: 30,
  bearing: 0,
};

/** Map from vehicle status to RGBA color */
const STATUS_COLORS: Record<string, [number, number, number, number]> = {
  idle: [0, 230, 118, 220],       // green
  en_route: [41, 121, 255, 220],  // blue
  delivering: [255, 145, 0, 220], // orange
  returning: [100, 181, 246, 220],// light blue
  broken_down: [255, 23, 68, 220],// red
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
  const layers = useMemo(() => {
    // 1. Demand Density Heatmap (orders weighted by priority)
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

    // 2. Animated Light Trails (TripsLayer)
    const tripsLayer = new TripsLayer({
      id: 'vehicle-trips-layer',
      data: vehicles.filter((v) => v.trailHistory && v.trailHistory.length > 1),
      getPath: (d: Vehicle) => (d.trailHistory || []).map((p) => [p[0], p[1]]) as any,
      getTimestamps: (d: Vehicle) => (d.trailHistory || []).map((p) => p[2] / 1000),
      getColor: (d: Vehicle) =>
        d.status === 'en_route'
          ? [0, 240, 255]
          : d.status === 'delivering'
          ? [255, 170, 0]
          : [100, 180, 255],
      opacity: 0.9,
      widthMinPixels: 3.5,
      trailLength: 90, // 90 simulated seconds trail
      currentTime: simTime / 1000,
      visible: showTrails,
      updateTriggers: {
        currentTime: [simTime],
        getPath: [vehicles.map((v) => v.trailHistory?.length || 0).join(',')],
      },
    });

    // 3. Route paths for vehicles that have route geometry
    const routeLayer = new PathLayer({
      id: 'routes-layer',
      data: vehicles.filter((v) => v.routeGeometry && v.routeGeometry.length > 1),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2,
      widthMaxPixels: 5,
      getPath: (d: Vehicle) => d.routeGeometry,
      getColor: (d: Vehicle) => (d.id === selectedVehicleId ? [0, 200, 255, 200] : [41, 121, 255, 100]),
      getWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 4 : 2),
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

    // 5. Active Order Delivery Pins (VRPTW Priority & SLA Status)
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
      getFillColor: [156, 39, 176, 200], // purple
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
      lineWidthMinPixels: 1,
      getPosition: (d: Vehicle) => [d.position.lon, d.position.lat] as [number, number],
      getFillColor: (d: Vehicle) => STATUS_COLORS[d.status] ?? [150, 150, 150, 200],
      getLineColor: (d: Vehicle) =>
        d.id === selectedVehicleId
          ? [255, 255, 255, 255]
          : d.rerouteCount && d.rerouteCount > 0
          ? [0, 229, 255, 220]
          : [0, 0, 0, 100],
      getLineWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 3 : d.rerouteCount && d.rerouteCount > 0 ? 2 : 1),
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
      tripsLayer,
      incidentLayer,
      routeLayer,
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
    <div className="map-container">
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }: { isHovering: boolean }) => (isHovering ? 'pointer' : 'grab')}
      >
        <Map mapStyle="https://tiles.openfreemap.org/styles/liberty" />
      </DeckGL>
    </div>
  );
}
