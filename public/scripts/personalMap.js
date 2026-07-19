import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';
import { viewportSearchParams } from './viewportQuery.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';

export function personalTerritoryUrl(bounds) {
  return `/v1/personal-territory?${viewportSearchParams(bounds)}`;
}

export async function fetchPersonalTerritory(bounds, fetchImpl = fetch, signal) {
  const response = await fetchImpl(personalTerritoryUrl(bounds), {
    credentials: 'same-origin',
    headers: { accept: 'application/geo+json' },
    signal,
  });
  if (!response.ok) throw new Error(`Personal territory request failed with ${response.status}.`);
  return response.json();
}

export function setPersonalTerritoryData(map, territoryColor, geojson) {
  const source = map.getSource?.(PERSONAL_TERRITORY_SOURCE_ID);
  if (source?.setData) {
    source.setData(geojson);
    return;
  }
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

export async function loadPersonalTerritory(map, territoryColor, bounds, fetchImpl = fetch) {
  setPersonalTerritoryData(map, territoryColor, await fetchPersonalTerritory(bounds, fetchImpl));
}
