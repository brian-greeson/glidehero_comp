export const MAP_TRAIL_SOURCE_ID = 'map-flight-aid-trail';
export const MAP_TRAIL_LAYER_ID = 'map-flight-aid-trail-line';
export const MAP_POSITION_SOURCE_ID = 'map-flight-aid-position';
export const MAP_POSITION_HALO_LAYER_ID = 'map-flight-aid-position-halo';
export const MAP_POSITION_DOT_LAYER_ID = 'map-flight-aid-position-dot';

export function trailGeoJson(snapshot) {
  return {
    type: 'FeatureCollection',
    features: snapshot.segments
      .filter((segment) => segment.length >= 2)
      .map((segment, index) => ({
        type: 'Feature',
        properties: { segment: index },
        geometry: {
          type: 'LineString',
          coordinates: segment.map((point) => [point.longitude, point.latitude]),
        },
      })),
  };
}
export function initializeTrailLayers(map, snapshot) {
  map.addSource(MAP_TRAIL_SOURCE_ID, { type: 'geojson', data: trailGeoJson(snapshot) });
  map.addLayer({
    id: MAP_TRAIL_LAYER_ID,
    type: 'line',
    source: MAP_TRAIL_SOURCE_ID,
    paint: { 'line-color': '#1769AA', 'line-width': 4, 'line-opacity': 0.9 },
  });
  map.addSource(MAP_POSITION_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: MAP_POSITION_HALO_LAYER_ID,
    type: 'circle',
    source: MAP_POSITION_SOURCE_ID,
    paint: { 'circle-radius': 12, 'circle-color': '#1769AA', 'circle-opacity': 0.18 },
  });
  map.addLayer({
    id: MAP_POSITION_DOT_LAYER_ID,
    type: 'circle',
    source: MAP_POSITION_SOURCE_ID,
    paint: {
      'circle-radius': 6,
      'circle-color': '#1769AA',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
}

export function renderTrail(map, snapshot) {
  map.getSource?.(MAP_TRAIL_SOURCE_ID)?.setData(trailGeoJson(snapshot));
}

export function setCurrentPosition(map, point = null) {
  map.getSource?.(MAP_POSITION_SOURCE_ID)?.setData({
    type: 'FeatureCollection',
    features: point ? [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    }] : [],
  });
}
