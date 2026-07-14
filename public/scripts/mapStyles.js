export const TERRITORY_FILL_OPACITY = 0.42;
export const TERRITORY_BOUNDARY_WIDTH = 2;

export function createTerritoryFillLayer({ id, source, color }) {
  return {
    id,
    type: 'fill',
    source,
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
    paint: {
      'line-color': color,
      'line-width': TERRITORY_BOUNDARY_WIDTH,
    },
  };
}
