export const TERRITORY_FILL_OPACITY = 0.42;
export const TERRITORY_BOUNDARY_WIDTH = 2;
export const MINIMUM_TERRITORY_ZOOM = 3;
export const MINIMUM_TERRITORY_PREFETCH_ZOOM = 9;

export function createTerritoryFillLayer({ id, source, color }) {
  return {
    id,
    type: 'fill',
    source,
    minzoom: MINIMUM_TERRITORY_ZOOM,
    paint: {
      'fill-color': color,
      'fill-opacity': TERRITORY_FILL_OPACITY,
    },
  };
}

export function createTerritoryBoundaryLayer({ id, source, color }) {
  return {
    id,
    type: 'line',
    source,
    minzoom: MINIMUM_TERRITORY_ZOOM,
    paint: {
      'line-color': color,
      'line-width': TERRITORY_BOUNDARY_WIDTH,
    },
  };
}
