# ADR-004: MapLibre GL and deck.gl for Visualization

## Status

Accepted

## Context

The control room UI needs to render:
- A geographic map of Cambodia/Phnom Penh with roads, buildings, and terrain
- Hundreds to thousands of vehicle positions updated in real-time
- Route polylines with animated trip trails
- Depot and warehouse markers
- Demand heatmaps
- Interactive vehicle inspection on click

Commercial mapping libraries (Google Maps, Mapbox GL) have usage-based pricing. We need an open-source solution that supports WebGL-accelerated rendering for large datasets.

## Decision

Use **MapLibre GL JS** as the base map renderer and **deck.gl** for high-performance geospatial data layers:

- **MapLibre GL JS**: Open-source fork of Mapbox GL JS. Renders the base map (roads, buildings, terrain) using vector tiles. Free, no API key required with OpenFreeMap or similar tile sources.
- **deck.gl**: GPU-accelerated WebGL layer system built for large-scale data visualization. Provides `TripsLayer` (animated vehicle trails), `PathLayer` (route polylines), `ScatterplotLayer` (vehicle/depot positions), and `HeatmapLayer` (demand density).

## Consequences

**Positive:**
- No API key or usage fees required
- WebGL acceleration handles thousands of animated objects
- deck.gl layers are purpose-built for geospatial time-series data
- TripsLayer natively supports animated trails along polylines
- MapLibre's open ecosystem allows custom tile sources and styles
- React bindings available for both libraries

**Negative:**
- Requires WebGL support in the browser (universal in modern browsers)
- Learning curve for deck.gl's layer composition model
- Two rendering pipelines (MapLibre's WebGL + deck.gl's WebGL) require careful integration

**Mitigation:**
- Use `@deck.gl/mapbox` overlay for seamless MapLibre + deck.gl integration
- Start with simple ScatterplotLayer + PathLayer, add TripsLayer for animations later
