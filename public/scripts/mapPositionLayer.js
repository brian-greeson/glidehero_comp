export const MAP_POSITION_SOURCE_ID = 'map-flight-aid-position';
export const MAP_POSITION_HALO_LAYER_ID = 'map-flight-aid-position-halo';
export const MAP_POSITION_DOT_LAYER_ID = 'map-flight-aid-position-dot';

export function initializeMapPositionLayers(map) {
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
