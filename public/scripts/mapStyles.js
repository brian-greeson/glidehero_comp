export const TERRITORY_FILL_OPACITY = 0.42;
export const TERRITORY_BOUNDARY_WIDTH = 2;

export function createTerritoryFillLayer({ id, source, color, minzoom, sourceLayer }) {
  return {
    id,
    type: 'fill',
    source,
    ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
    ...(minzoom === undefined ? {} : { minzoom }),
    paint: {
      'fill-color': color,
      'fill-opacity': TERRITORY_FILL_OPACITY,
    },
  };
}

export function createTerritoryBoundaryLayer({ id, source, color, minzoom, sourceLayer }) {
  return {
    id,
    type: 'line',
    source,
    ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
    ...(minzoom === undefined ? {} : { minzoom }),
    paint: {
      'line-color': color,
      'line-width': TERRITORY_BOUNDARY_WIDTH,
    },
  };
}
