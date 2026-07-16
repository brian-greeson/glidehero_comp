import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';

export async function loadPersonalTerritory(map, territoryColor, fetchImpl = fetch) {
  const response = await fetchImpl('/v1/personal-territory', {
    credentials: 'same-origin',
    headers: { accept: 'application/geo+json' },
  });
  if (!response.ok) throw new Error(`Personal territory request failed with ${response.status}.`);

  const geojson = await response.json();
  map.addSource(PERSONAL_TERRITORY_SOURCE_ID, { type: 'geojson', data: geojson });
  map.addLayer(createTerritoryFillLayer({
    id: PERSONAL_TERRITORY_FILL_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    color: territoryColor,
  }));
  map.addLayer(createTerritoryBoundaryLayer({
    id: PERSONAL_TERRITORY_OUTLINE_LAYER_ID,
    source: PERSONAL_TERRITORY_SOURCE_ID,
    color: territoryColor,
  }));
}
