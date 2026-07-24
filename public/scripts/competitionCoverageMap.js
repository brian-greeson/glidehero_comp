import { createTerritoryBoundaryLayer } from './mapStyles.js';

export const COVERAGE_SOURCE_ID = 'competition-coverage';
export const COVERAGE_FILL_LAYER_ID = 'competition-territory-fill';
export const COVERAGE_OUTLINE_LAYER_ID = 'competition-territory-outline';
export const COVERAGE_SOURCE_LAYER = 'competition-coverage';

const COVERAGE_OPACITY = [
  'case',
  ['has', 'pilotUserId'],
  ['case', ['get', 'isShared'], 0.22, 0.58],
  ['>', ['get', 'claimantCount'], 1],
  0.58,
  0.34,
];

export function coverageCellFeatureAtPoint(map, point) {
  if (!map.getLayer?.(COVERAGE_FILL_LAYER_ID)) return null;
  return map.queryRenderedFeatures?.(point, { layers: [COVERAGE_FILL_LAYER_ID] })?.[0] ?? null;
}

function coveragePaintColor(pilotColors = []) {
  const pilotColor = pilotColors.length > 0
    ? ['match', ['get', 'pilotUserId'], ...pilotColors.flat(), '#94a3b8']
    : '#94a3b8';
  return [
    'case',
    ['has', 'pilotUserId'],
    pilotColor,
    ['>', ['get', 'claimantCount'], 1],
    '#475569',
    '#94a3b8',
  ];
}

export function installCoverageSource(map, tileUrl, tileZoom) {
  if (map.getSource?.(COVERAGE_SOURCE_ID)) return;
  map.addSource(COVERAGE_SOURCE_ID, {
    type: 'vector',
    tiles: [tileUrl],
    minzoom: tileZoom.minimumZoom,
    maxzoom: tileZoom.maximumZoom,
  });
  const color = coveragePaintColor();
  map.addLayer({
    id: COVERAGE_FILL_LAYER_ID,
    type: 'fill',
    source: COVERAGE_SOURCE_ID,
    'source-layer': COVERAGE_SOURCE_LAYER,
    minzoom: tileZoom.minimumZoom,
    paint: { 'fill-color': color, 'fill-opacity': COVERAGE_OPACITY },
  });
  map.addLayer(createTerritoryBoundaryLayer({
    id: COVERAGE_OUTLINE_LAYER_ID,
    source: COVERAGE_SOURCE_ID,
    sourceLayer: COVERAGE_SOURCE_LAYER,
    color,
    minzoom: tileZoom.minimumZoom,
  }));
}

export function updateCoverageTiles(map, tileUrl) {
  map.getSource?.(COVERAGE_SOURCE_ID)?.setTiles?.([tileUrl]);
}

export function assignLoadedCoverageColors(map, colorRegistry) {
  const pilotIds = new Set(
    (map.querySourceFeatures?.(COVERAGE_SOURCE_ID, { sourceLayer: COVERAGE_SOURCE_LAYER }) ?? [])
      .map((feature) => feature.properties?.pilotUserId)
      .filter(Boolean),
  );
  const expression = coveragePaintColor(
    [...pilotIds].map((pilotUserId) => [pilotUserId, colorRegistry.colorFor(pilotUserId)]),
  );
  map.setPaintProperty?.(COVERAGE_FILL_LAYER_ID, 'fill-color', expression);
  map.setPaintProperty?.(COVERAGE_OUTLINE_LAYER_ID, 'line-color', expression);
}

export function visibleCoverageFeatureCount(map) {
  if (!map.getLayer?.(COVERAGE_FILL_LAYER_ID)) return 0;
  return map.queryRenderedFeatures?.({ layers: [COVERAGE_FILL_LAYER_ID] })?.length ?? 0;
}
