import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';
export const PERSONAL_TERRITORY_SOURCE_LAYER = 'personal-territory';
export const PERSONAL_CELL_INTERACTION_LAYER_ID = 'personal-territory-cells-interaction';
export const PERSONAL_CELL_SOURCE_LAYER = 'personal-territory-cells';

export function personalTerritoryTileUrl(month = null, origin = globalThis.location?.origin ?? '') {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return `${origin}/v1/personal-territory/tiles/{z}/{x}/{y}.mvt${query}`;
}

export function installPersonalTerritorySource(map, territoryColor, tileZoom, month = null) {
  if (map.getSource?.(PERSONAL_TERRITORY_SOURCE_ID)) return;
  map.addSource(PERSONAL_TERRITORY_SOURCE_ID, {
    type: 'vector',
    tiles: [personalTerritoryTileUrl(month)],
    minzoom: tileZoom.minimumZoom,
    maxzoom: tileZoom.maximumZoom,
  });
  map.addLayer(createTerritoryFillLayer({
    id: PERSONAL_TERRITORY_FILL_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    sourceLayer: PERSONAL_TERRITORY_SOURCE_LAYER,
    color: territoryColor,
    minzoom: tileZoom.minimumZoom,
  }));
  map.addLayer(createTerritoryBoundaryLayer({
    id: PERSONAL_TERRITORY_OUTLINE_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    sourceLayer: PERSONAL_TERRITORY_SOURCE_LAYER,
    color: territoryColor,
    minzoom: tileZoom.minimumZoom,
  }));
  map.addLayer({
    id: PERSONAL_CELL_INTERACTION_LAYER_ID,
    type: 'fill',
    source: PERSONAL_TERRITORY_SOURCE_ID,
    'source-layer': PERSONAL_CELL_SOURCE_LAYER,
    minzoom: tileZoom.minimumZoom,
    paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
  });
}

export function updatePersonalTerritoryTiles(map, month = null) {
  map.getSource?.(PERSONAL_TERRITORY_SOURCE_ID)?.setTiles?.([personalTerritoryTileUrl(month)]);
}

export function personalCellFeatureAtPoint(map, point) {
  if (!map.getLayer?.(PERSONAL_CELL_INTERACTION_LAYER_ID)) return null;
  return map.queryRenderedFeatures?.(point, {
    layers: [PERSONAL_CELL_INTERACTION_LAYER_ID],
  })?.[0] ?? null;
}

export function personalCellTracksUrl(cell, month = null) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return `/v1/personal-cells/${encodeURIComponent(cell.x)}/${encodeURIComponent(cell.y)}/tracks${query}`;
}
