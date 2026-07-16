import { COMPETITION_COLOR_PALETTE } from './competitionColors.js';
import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const COMPETITION_TERRITORY_SOURCE_ID = 'competition-territory';
export const COMPETITION_TERRITORY_FILL_LAYER_ID = 'competition-territory-fill';
export const COMPETITION_TERRITORY_OUTLINE_LAYER_ID = 'competition-territory-outline';

const COMPETITION_COLOR_EXPRESSION = ['get', 'displayColor'];

export function createCompetitionColorRegistry(
  currentUserId,
  currentUserColor,
  random = Math.random,
) {
  const ownerColors = new Map([[currentUserId, currentUserColor]]);
  const usedColors = new Set([currentUserColor.toUpperCase()]);
  return {
    colorFor(ownerUserId) {
      let displayColor = ownerColors.get(ownerUserId);
      if (!displayColor) {
        const firstColorIndex = Math.floor(random() * COMPETITION_COLOR_PALETTE.length);
        for (let offset = 0; offset < COMPETITION_COLOR_PALETTE.length; offset += 1) {
          const index = (firstColorIndex + offset) % COMPETITION_COLOR_PALETTE.length;
          const candidate = COMPETITION_COLOR_PALETTE[index];
          if (candidate && !usedColors.has(candidate)) {
            displayColor = candidate;
            break;
          }
        }
        displayColor ??= COMPETITION_COLOR_PALETTE[firstColorIndex] ?? COMPETITION_COLOR_PALETTE[0];
        ownerColors.set(ownerUserId, displayColor);
        usedColors.add(displayColor);
      }
      return displayColor;
    },
  };
}

export function colorCompetitionTerritory(
  geojson,
  currentUserId,
  currentUserColor,
  random = Math.random,
  colorRegistry = createCompetitionColorRegistry(currentUserId, currentUserColor, random),
) {
  return {
    ...geojson,
    features: geojson.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        displayColor: colorRegistry.colorFor(feature.properties.ownerUserId),
      },
    })),
  };
}

export function competitionTerritoryUrl(month = null) {
  return month
    ? `/v1/competition-territory?month=${encodeURIComponent(month)}`
    : '/v1/competition-territory';
}

export async function loadCompetitionTerritory(
  map,
  {
    currentUserId,
    territoryColor,
    month = null,
    fetchImpl = fetch,
    signal,
    random = Math.random,
    colorRegistry = createCompetitionColorRegistry(currentUserId, territoryColor, random),
  },
) {
  const response = await fetchImpl(competitionTerritoryUrl(month), {
    credentials: 'same-origin',
    headers: { accept: 'application/geo+json' },
    signal,
  });
  if (!response.ok) throw new Error(`Competition territory request failed with ${response.status}.`);

  const geojson = colorCompetitionTerritory(
    await response.json(),
    currentUserId,
    territoryColor,
    random,
    colorRegistry,
  );
  const existingSource = map.getSource?.(COMPETITION_TERRITORY_SOURCE_ID);
  if (existingSource?.setData) {
    existingSource.setData(geojson);
  } else {
    map.addSource(COMPETITION_TERRITORY_SOURCE_ID, { type: 'geojson', data: geojson });
    map.addLayer(createTerritoryFillLayer({
      id: COMPETITION_TERRITORY_FILL_LAYER_ID,
      source: COMPETITION_TERRITORY_SOURCE_ID,
      color: COMPETITION_COLOR_EXPRESSION,
    }));
    map.addLayer(createTerritoryBoundaryLayer({
      id: COMPETITION_TERRITORY_OUTLINE_LAYER_ID,
      source: COMPETITION_TERRITORY_SOURCE_ID,
      color: COMPETITION_COLOR_EXPRESSION,
    }));
  }
  return geojson;
}

export function setCompetitionTerritoryVisibility(map, visible) {
  for (const layerId of [
    COMPETITION_TERRITORY_FILL_LAYER_ID,
    COMPETITION_TERRITORY_OUTLINE_LAYER_ID,
  ]) {
    if (!map.getLayer || map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}
