export const MAP_REPLAY_TRACK_SOURCE_ID = 'map-replay-tracks';
export const MAP_REPLAY_MARKER_SOURCE_ID = 'map-replay-markers';
export const MAP_REPLAY_TRACK_LAYER_ID = 'map-replay-tracks-line';
export const MAP_REPLAY_MARKER_LAYER_ID = 'map-replay-markers-circle';

export const DEFAULT_DIM_TARGETS = [
  ['competition-territory-fill', 'fill-opacity'], ['competition-territory-outline', 'line-opacity'],
  ['personal-territory-fill', 'fill-opacity'], ['personal-territory-outline', 'line-opacity'],
  ['map-flight-aid-grid-lines', 'line-opacity'], ['selected-cell-fill', 'fill-opacity'],
  ['selected-cell-outline', 'line-opacity'], ['cell-tracks-lines', 'line-opacity'],
  ['arena-focus-boundary', 'line-opacity'],
];
const dimOwnership = new WeakMap();

function featureCollection(features) { return { type: 'FeatureCollection', features }; }

function createTelemetryElement(documentRef) {
  const element = documentRef.createElement('div');
  element.className = 'map-replay-telemetry-marker';
  element.setAttribute('aria-hidden', 'true');
  const callout = documentRef.createElement('div'); callout.className = 'map-replay-telemetry-callout';
  const speed = documentRef.createElement('span'); speed.className = 'map-replay-telemetry-value map-replay-telemetry-value--speed';
  const altitude = documentRef.createElement('span'); altitude.className = 'map-replay-telemetry-value map-replay-telemetry-value--altitude';
  const leader = documentRef.createElement('span'); leader.className = 'map-replay-telemetry-leader';
  const dot = documentRef.createElement('span'); dot.className = 'map-replay-telemetry-dot';
  callout.appendChild(speed); callout.appendChild(altitude);
  element.appendChild(callout); element.appendChild(leader); element.appendChild(dot);
  return { element, speed, altitude };
}

function roundedTelemetry(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function telemetryText(value, unit) {
  return `${value === null ? '—' : value.toLocaleString('en-US')} ${unit}`;
}

function positionTelemetryCallout(map, element, coordinate) {
  const point = map.project?.(coordinate);
  const canvas = map.getCanvas?.();
  const width = canvas?.clientWidth ?? canvas?.getBoundingClientRect?.().width;
  if (!Number.isFinite(point?.x) || !Number.isFinite(width)) return;
  element.classList?.toggle('map-replay-telemetry-marker--edge-left', point.x < 96);
  element.classList?.toggle('map-replay-telemetry-marker--edge-right', point.x > width - 96);
}

export function replayGeoJson(snapshot = {}, colorForPilot = () => '#1769AA') {
  const flights = Array.isArray(snapshot) ? snapshot : (snapshot.flights ?? []);
  const tracks = []; const markers = [];
  flights.forEach((flight) => {
    const properties = {
      trackColor: colorForPilot(flight.pilotUserId, flight) || '#1769AA',
      pilotUserId: flight.pilotUserId,
      flightId: flight.flightId,
    };
    if (Array.isArray(flight.track) && flight.track.length >= 2) tracks.push({
      type: 'Feature', properties, geometry: { type: 'LineString', coordinates: flight.track },
    });
    if (Array.isArray(flight.marker) && flight.marker.length >= 2 && flight.marker.every(Number.isFinite)) markers.push({
      type: 'Feature', properties, geometry: { type: 'Point', coordinates: flight.marker },
    });
  });
  return { tracks: featureCollection(tracks), markers: featureCollection(markers) };
}

export function installMapReplayLayer(map, { colorForPilot = () => '#1769AA', dimLayerIds = DEFAULT_DIM_TARGETS, maplibre, documentRef = globalThis.document } = {}) {
  const prior = new Map();
  const telemetryMarkers = new Map();
  const targets = (dimLayerIds ?? []).map((target) => Array.isArray(target) ? target : [target, 'fill-opacity']);
  (targets ?? []).forEach(([id, property]) => {
    if (!map.getLayer?.(id) || !map.getPaintProperty) return;
    const value = map.getPaintProperty(id, property);
    prior.set(`${id}:${property}`, { id, property, value });
    const owner = dimOwnership.get(map) ?? new Set(); owner.add(`${id}:${property}`); dimOwnership.set(map, owner);
    map.setPaintProperty?.(id, property, 0.3);
  });
  if (!map.getSource?.(MAP_REPLAY_TRACK_SOURCE_ID)) map.addSource(MAP_REPLAY_TRACK_SOURCE_ID, { type: 'geojson', data: featureCollection([]) });
  if (!map.getSource?.(MAP_REPLAY_MARKER_SOURCE_ID)) map.addSource(MAP_REPLAY_MARKER_SOURCE_ID, { type: 'geojson', data: featureCollection([]) });
  if (!map.getLayer?.(MAP_REPLAY_TRACK_LAYER_ID)) map.addLayer({ id: MAP_REPLAY_TRACK_LAYER_ID, type: 'line', source: MAP_REPLAY_TRACK_SOURCE_ID, paint: { 'line-color': ['get', 'trackColor'], 'line-width': 3, 'line-opacity': 0.9 } });
  if (!map.getLayer?.(MAP_REPLAY_MARKER_LAYER_ID)) map.addLayer({ id: MAP_REPLAY_MARKER_LAYER_ID, type: 'circle', source: MAP_REPLAY_MARKER_SOURCE_ID, paint: { 'circle-color': ['get', 'trackColor'], 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  let closed = false;
  const updateTelemetry = (snapshot) => {
    if (!maplibre?.Marker || !documentRef?.createElement) return;
    const active = new Set();
    for (const flight of snapshot?.flights ?? []) {
      if (!Array.isArray(flight.marker) || flight.marker.length < 2 || !flight.marker.every(Number.isFinite)) continue;
      active.add(flight.flightId);
      let entry = telemetryMarkers.get(flight.flightId);
      if (!entry) {
        const view = createTelemetryElement(documentRef);
        const marker = new maplibre.Marker({ element: view.element, anchor: 'center' });
        marker.setLngLat(flight.marker); marker.addTo(map);
        view.element.removeAttribute?.('role'); view.element.removeAttribute?.('tabindex');
        entry = { ...view, marker }; telemetryMarkers.set(flight.flightId, entry);
      } else entry.marker.setLngLat(flight.marker);
      entry.element.style?.setProperty?.('--map-replay-pilot-color', colorForPilot(flight.pilotUserId, flight) || '#1769AA');
      positionTelemetryCallout(map, entry.element, flight.marker);
      const speedValue = roundedTelemetry(flight.groundSpeedKph);
      const altitudeValue = roundedTelemetry(flight.altitudeMeters);
      if (entry.speedValue !== speedValue) { entry.speed.textContent = telemetryText(speedValue, 'km/h'); entry.speedValue = speedValue; }
      if (entry.altitudeValue !== altitudeValue) { entry.altitude.textContent = telemetryText(altitudeValue, 'm'); entry.altitudeValue = altitudeValue; }
    }
    telemetryMarkers.forEach((entry, flightId) => { if (!active.has(flightId)) { entry.marker.remove(); telemetryMarkers.delete(flightId); } });
  };
  const update = (snapshot) => { if (closed) return; const data = replayGeoJson(snapshot, colorForPilot); map.getSource?.(MAP_REPLAY_TRACK_SOURCE_ID)?.setData(data.tracks); map.getSource?.(MAP_REPLAY_MARKER_SOURCE_ID)?.setData(data.markers); updateTelemetry(snapshot); };
  const destroy = () => { if (closed) return; closed = true; telemetryMarkers.forEach((entry) => entry.marker.remove()); telemetryMarkers.clear(); prior.forEach(({ id, property, value }) => map.setPaintProperty?.(id, property, value === undefined ? null : value)); [MAP_REPLAY_MARKER_LAYER_ID, MAP_REPLAY_TRACK_LAYER_ID].forEach((id) => { if (map.getLayer?.(id)) map.removeLayer?.(id); }); [MAP_REPLAY_MARKER_SOURCE_ID, MAP_REPLAY_TRACK_SOURCE_ID].forEach((id) => { if (map.getSource?.(id)) map.removeSource?.(id); }); };
  return { update, close: destroy, destroy };
}
