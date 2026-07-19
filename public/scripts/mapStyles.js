export const TERRITORY_FILL_OPACITY = 0.42;
export const TERRITORY_BOUNDARY_WIDTH = 2;
export const MINIMUM_PERSONAL_TERRITORY_ZOOM = 4;
export const MINIMUM_COMPETITION_TERRITORY_ZOOM = 7;
export const MAXIMUM_TERRITORY_TILE_ZOOM = 14;

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
