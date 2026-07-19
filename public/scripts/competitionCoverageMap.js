import { createTerritoryBoundaryLayer } from './mapStyles.js';

export const COVERAGE_SOURCE_ID = 'competition-coverage';
export const COVERAGE_FILL_LAYER_ID = 'competition-territory-fill';
export const COVERAGE_HOVER_LAYER_ID = 'competition-territory-hover';
export const COVERAGE_HOVER_OUTLINE_LAYER_ID = 'competition-territory-hover-outline';
export const COVERAGE_OUTLINE_LAYER_ID = 'competition-territory-outline';

const EMPTY_HOVER_FILTER = ['==', ['get', 'cellId'], ''];

const COVERAGE_COLOR = [
  'case',
  ['has', 'pilotUserId'],
  ['get', 'displayColor'],
  ['>', ['get', 'claimantCount'], 1],
  '#475569',
  '#94a3b8',
];
const COVERAGE_OPACITY = [
  'case',
  ['has', 'pilotUserId'],
  ['case', ['get', 'isShared'], 0.22, 0.58],
  ['>', ['get', 'claimantCount'], 1],
  0.58,
  0.34,
];

export function colorCoverageTerritory(geojson, colorRegistry) {
  return {
    ...geojson,
    features: geojson.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        ...(feature.properties.pilotUserId
          ? { displayColor: colorRegistry.colorFor(feature.properties.pilotUserId) }
          : {}),
      },
    })),
  };
}

export function coverageCellFeatureAtPoint(map, point) {
  return map.queryRenderedFeatures?.(point, { layers: [COVERAGE_FILL_LAYER_ID] })?.[0] ?? null;
}

export function isExclusiveCoverageFeature(feature) {
  const properties = feature?.properties;
  return Boolean(
    properties?.pilotUserId &&
      Number(properties.claimantCount) === 1 &&
      properties.isShared !== true,
  );
}

export function setCoverageHoveredCell(map, cellId = null) {
  if (!map.setFilter) return;
  const filter = cellId ? ['==', ['get', 'cellId'], cellId] : EMPTY_HOVER_FILTER;
  for (const layerId of [COVERAGE_HOVER_LAYER_ID, COVERAGE_HOVER_OUTLINE_LAYER_ID]) {
    if (map.getLayer?.(layerId)) map.setFilter(layerId, filter);
  }
}

export function positionCoverageCellPopup(popup, point, containerWidth) {
  const edgePadding = 8;
  const halfWidth = popup.offsetWidth / 2;
  const minimumX = halfWidth + edgePadding;
  const maximumX = containerWidth - halfWidth - edgePadding;
  const centeredX =
    maximumX >= minimumX ? Math.min(Math.max(point.x, minimumX), maximumX) : containerWidth / 2;
  popup.style.left = `${centeredX}px`;
  popup.style.top = `${point.y}px`;
  popup.dataset.placement = point.y < popup.offsetHeight + 12 ? 'below' : 'above';
}

export function setCoverageData(map, geojson) {
  const source = map.getSource?.(COVERAGE_SOURCE_ID);
  if (source?.setData) {
    source.setData(geojson);
    return;
  }
  map.addSource(COVERAGE_SOURCE_ID, { type: 'geojson', data: geojson });
  map.addLayer({
    id: COVERAGE_FILL_LAYER_ID,
    type: 'fill',
    source: COVERAGE_SOURCE_ID,
    paint: { 'fill-color': COVERAGE_COLOR, 'fill-opacity': COVERAGE_OPACITY },
  });
  map.addLayer({
    id: COVERAGE_HOVER_LAYER_ID,
    type: 'fill',
    source: COVERAGE_SOURCE_ID,
    filter: EMPTY_HOVER_FILTER,
    paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.18 },
  });
  map.addLayer(
    createTerritoryBoundaryLayer({
      id: COVERAGE_OUTLINE_LAYER_ID,
      source: COVERAGE_SOURCE_ID,
      color: COVERAGE_COLOR,
    }),
  );
  map.addLayer({
    id: COVERAGE_HOVER_OUTLINE_LAYER_ID,
    type: 'line',
    source: COVERAGE_SOURCE_ID,
    filter: EMPTY_HOVER_FILTER,
    paint: { 'line-color': '#ffffff', 'line-width': 3 },
  });
}
