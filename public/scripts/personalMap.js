import {
  createTerritoryBoundaryLayer,
  createTerritoryFillLayer,
  MAXIMUM_TERRITORY_TILE_ZOOM,
  MINIMUM_PERSONAL_TERRITORY_ZOOM,
} from './mapStyles.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';
export const PERSONAL_TERRITORY_SOURCE_LAYER = 'personal-territory';

export function personalTerritoryTileUrl(origin = globalThis.location?.origin ?? '') {
  return `${origin}/v1/personal-territory/tiles/{z}/{x}/{y}.mvt`;
}

export function installPersonalTerritorySource(map, territoryColor) {
  if (map.getSource?.(PERSONAL_TERRITORY_SOURCE_ID)) return;
  map.addSource(PERSONAL_TERRITORY_SOURCE_ID, {
    type: 'vector',
    tiles: [personalTerritoryTileUrl()],
    minzoom: MINIMUM_PERSONAL_TERRITORY_ZOOM,
    maxzoom: MAXIMUM_TERRITORY_TILE_ZOOM,
  });
  map.addLayer(createTerritoryFillLayer({
    id: PERSONAL_TERRITORY_FILL_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    sourceLayer: PERSONAL_TERRITORY_SOURCE_LAYER,
    color: territoryColor,
    minzoom: MINIMUM_PERSONAL_TERRITORY_ZOOM,
  }));
  map.addLayer(createTerritoryBoundaryLayer({
    id: PERSONAL_TERRITORY_OUTLINE_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    sourceLayer: PERSONAL_TERRITORY_SOURCE_LAYER,
    color: territoryColor,
    minzoom: MINIMUM_PERSONAL_TERRITORY_ZOOM,
  }));
}
