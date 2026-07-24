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

export function installMapReplayLayer(map, { colorForPilot = () => '#1769AA', dimLayerIds = DEFAULT_DIM_TARGETS } = {}) {
  const prior = new Map();
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
  const update = (snapshot) => { if (closed) return; const data = replayGeoJson(snapshot, colorForPilot); map.getSource?.(MAP_REPLAY_TRACK_SOURCE_ID)?.setData(data.tracks); map.getSource?.(MAP_REPLAY_MARKER_SOURCE_ID)?.setData(data.markers); };
  const destroy = () => { if (closed) return; closed = true; prior.forEach(({ id, property, value }) => map.setPaintProperty?.(id, property, value === undefined ? null : value)); [MAP_REPLAY_MARKER_LAYER_ID, MAP_REPLAY_TRACK_LAYER_ID].forEach((id) => { if (map.getLayer?.(id)) map.removeLayer?.(id); }); [MAP_REPLAY_MARKER_SOURCE_ID, MAP_REPLAY_TRACK_SOURCE_ID].forEach((id) => { if (map.getSource?.(id)) map.removeSource?.(id); }); };
  return { update, close: destroy, destroy };
}
