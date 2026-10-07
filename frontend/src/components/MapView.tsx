import { useMemo } from 'react';
import Map from 'react-map-gl/maplibre';
import { DeckGL } from '@deck.gl/react';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import type { Vehicle, Warehouse, RoadIncident } from '../types';
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
  incidents?: RoadIncident[];
  selectedVehicleId: string | null;
  onVehicleClick: (id: string) => void;
}

export function MapView({ vehicles, warehouses, incidents, selectedVehicleId, onVehicleClick }: MapViewProps) {
  const layers = useMemo(() => {
    // Route paths for vehicles that have route geometry
    const routeLayer = new PathLayer({
      id: 'routes-layer',
      data: vehicles.filter(v => v.routeGeometry && v.routeGeometry.length > 1),
      pickable: false,
      widthScale: 1,
      widthMinPixels: 2,
      widthMaxPixels: 5,
      getPath: (d: Vehicle) => d.routeGeometry,
      getColor: (d: Vehicle) => d.id === selectedVehicleId ? [0, 200, 255, 200] : [41, 121, 255, 100],
      getWidth: (d: Vehicle) => d.id === selectedVehicleId ? 4 : 2,
    });

    // Warehouse/depot markers
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

    // Road Incident Hazard Zones
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
        getRadius: [incidents?.map((i) => `${i.id}-${i.radiusM}`).join(',')],
      },
    });

    // Vehicle markers
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
          : (d.rerouteCount && d.rerouteCount > 0)
          ? [0, 229, 255, 220]
          : [0, 0, 0, 100],
      getLineWidth: (d: Vehicle) => (d.id === selectedVehicleId ? 3 : (d.rerouteCount && d.rerouteCount > 0) ? 2 : 1),
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

    return [incidentLayer, routeLayer, warehouseLayer, vehicleLayer];
  }, [vehicles, warehouses, incidents, selectedVehicleId, onVehicleClick]);

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
