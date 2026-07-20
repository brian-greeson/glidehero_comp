import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';
export const PERSONAL_TERRITORY_SOURCE_LAYER = 'personal-territory';

export function personalTerritoryTileUrl(origin = globalThis.location?.origin ?? '') {
  return `${origin}/v1/personal-territory/tiles/{z}/{x}/{y}.mvt`;
}

export function installPersonalTerritorySource(map, territoryColor, tileZoom) {
  if (map.getSource?.(PERSONAL_TERRITORY_SOURCE_ID)) return;
  map.addSource(PERSONAL_TERRITORY_SOURCE_ID, {
    type: 'vector',
    tiles: [personalTerritoryTileUrl()],
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
}
