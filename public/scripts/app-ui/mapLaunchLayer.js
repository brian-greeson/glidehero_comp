import { normalizeViewportBounds, viewportSearchParams } from '../viewportQuery.js';

export const LAUNCH_SOURCE_ID = 'flight-map-launches';
export const LAUNCH_CLUSTER_LAYER_ID = 'flight-map-launch-clusters';
export const LAUNCH_CLUSTER_COUNT_LAYER_ID = 'flight-map-launch-cluster-count';
export const LAUNCH_MARKER_LAYER_ID = 'flight-map-launch-markers';

const LAYER_IDS = [LAUNCH_CLUSTER_LAYER_ID, LAUNCH_CLUSTER_COUNT_LAYER_ID, LAUNCH_MARKER_LAYER_ID];

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedLaunch(row) {
  const launchId = Number(row?.launchId ?? row?.id);
  const longitude = finiteCoordinate(row?.longitude);
  const latitude = finiteCoordinate(row?.latitude);
  if (!Number.isSafeInteger(launchId) || launchId < 1 || longitude === null || latitude === null) return null;
  return { launchId, name: String(row?.name ?? 'Launch'), longitude, latitude, visited: row?.visited === true };
}

export function normalizeLaunchMarkerPayload(payload) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.launches) ? payload.launches : Array.isArray(payload?.markers) ? payload.markers : [];
  return rows.map(normalizedLaunch).filter(Boolean);
}

export function normalizeLaunchDetailPayload(payload) {
  const row = payload?.launch ?? payload;
  const marker = normalizedLaunch(row);
  if (!marker) return null;
  const elevationMeters = Number(row?.elevationMeters);
  const matchingFlightCount = Number(row?.matchingFlightCount);
  return {
    ...marker,
    city: String(row?.city ?? ''),
    state: String(row?.state ?? ''),
    country: String(row?.country ?? ''),
    elevationMeters: Number.isFinite(elevationMeters) ? elevationMeters : null,
    description: typeof row?.description === 'string' && row.description.trim() ? row.description.trim() : null,
    matchingFlightCount: Number.isSafeInteger(matchingFlightCount) && matchingFlightCount >= 0 ? matchingFlightCount : 0,
    visited: row?.visited === true,
  };
}

export function launchLocationLabel(launch) {
  return [launch?.city, launch?.state, launch?.country].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
}

export function launchLayerVisibleFromSearch(search = '') {
  return new URLSearchParams(search).get('launches') !== 'off';
}

export function selectedLaunchIdFromSearch(search = '') {
  const value = Number(new URLSearchParams(search).get('selectedLaunch'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function mapLaunchRequestUrl(endpoint, bounds, { scope, groupId, period, launch }) {
  const values = { scope, period: period.period };
  if (scope === 'group' && groupId) values.group = groupId;
  if (period.anchor) values.anchor = period.anchor;
  if (period.startDate) values.start = period.startDate;
  if (period.endDate) values.end = period.endDate;
  if (launch) values.launch = String(launch);
  return `${endpoint}?${viewportSearchParams(normalizeViewportBounds(bounds), values)}`;
}

export function mapLaunchDetailRequestUrl(endpointTemplate, launchId, { scope, groupId, period, launch }) {
  const endpoint = endpointTemplate.replace('{launchId}', encodeURIComponent(String(launchId)));
  const query = new URLSearchParams({ scope });
  if (scope === 'group' && groupId) query.set('group', groupId);
  query.set('period', period.period);
  if (period.anchor) query.set('anchor', period.anchor);
  if (period.startDate ?? period.start) query.set('start', period.startDate ?? period.start);
  if (period.endDate ?? period.end) query.set('end', period.endDate ?? period.end);
  if (launch) query.set('launch', String(launch));
  return `${endpoint}?${query}`;
}

export function launchFeatureCollection(launches, selectedLaunchId = null) {
  return {
    type: 'FeatureCollection',
    features: launches.map((launch) => ({
      type: 'Feature',
      id: launch.launchId,
      properties: {
        launchId: launch.launchId,
        name: launch.name,
        selected: launch.launchId === selectedLaunchId,
        visited: launch.visited === true,
      },
      geometry: { type: 'Point', coordinates: [launch.longitude, launch.latitude] },
    })),
  };
}

export function installLaunchLayers(map, { visible = true } = {}) {
  const visibility = visible ? 'visible' : 'none';
  if (!map.getSource?.(LAUNCH_SOURCE_ID)) map.addSource(LAUNCH_SOURCE_ID, {
    type: 'geojson',
    data: launchFeatureCollection([]),
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 44,
  });
  if (!map.getLayer?.(LAUNCH_CLUSTER_LAYER_ID)) map.addLayer({
    id: LAUNCH_CLUSTER_LAYER_ID,
    type: 'circle',
    source: LAUNCH_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: { visibility },
    paint: {
      'circle-color': '#1769aa',
      'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 40, 25],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  if (!map.getLayer?.(LAUNCH_CLUSTER_COUNT_LAYER_ID)) map.addLayer({
    id: LAUNCH_CLUSTER_COUNT_LAYER_ID,
    type: 'symbol',
    source: LAUNCH_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: { visibility, 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
    paint: { 'text-color': '#ffffff' },
  });
  if (!map.getLayer?.(LAUNCH_MARKER_LAYER_ID)) map.addLayer({
    id: LAUNCH_MARKER_LAYER_ID,
    type: 'circle',
    source: LAUNCH_SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    layout: { visibility },
    paint: {
      'circle-color': ['case',
        ['boolean', ['get', 'selected'], false], '#ff8a00',
        ['boolean', ['get', 'visited'], false], '#17a66a',
        '#7b8b99'],
      'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 10, 7],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
}

export function setLaunchLayerVisibility(map, visible) {
  for (const layerId of LAYER_IDS) {
    if (map.getLayer?.(layerId)) map.setLayoutProperty?.(layerId, 'visibility', visible ? 'visible' : 'none');
  }
}
