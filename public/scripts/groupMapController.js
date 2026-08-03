import {
  COVERAGE_FILL_LAYER_ID,
  assignLoadedCoverageColors,
  installCoverageSource,
  updateCoverageTiles,
} from './competitionCoverageMap.js';

export const GROUP_TRACK_SOURCE_ID = 'group-selected-flight-track';
export const GROUP_TRACK_LAYER_ID = 'group-selected-flight-track-line';

const emptyTrack = () => ({ type: 'FeatureCollection', features: [] });

/** Install the group tile source and the selected-flight orange overlay. */
export function installGroupMapLayers(map, {
  tileUrl,
  minimumZoom = 0,
  maximumZoom = 22,
} = {}) {
  installCoverageSource(map, tileUrl, { minimumZoom, maximumZoom });
  if (!map.getSource?.(GROUP_TRACK_SOURCE_ID)) {
    map.addSource(GROUP_TRACK_SOURCE_ID, { type: 'geojson', data: emptyTrack() });
    map.addLayer({
      id: GROUP_TRACK_LAYER_ID,
      type: 'line',
      source: GROUP_TRACK_SOURCE_ID,
      paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.95 },
    });
  }
}

export function setGroupTrack(map, track) {
  map.getSource?.(GROUP_TRACK_SOURCE_ID)?.setData?.(track ?? emptyTrack());
}

export function clearGroupTrack(map) {
  setGroupTrack(map, null);
}

/**
 * Wire a members-only group map to pilot/filter and paginated flight controls.
 * The host page owns rendering; callbacks receive the selected IDs and data.
 */
export function initializeGroupMapController({
  map,
  mapElement,
  documentRef = document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  groupId = mapElement?.dataset.groupId,
  month = mapElement?.dataset.groupMonth,
  tileUrl = ({ pilotUserId } = {}) => {
    const params = new URLSearchParams({ month });
    if (pilotUserId) params.set('pilot', pilotUserId);
    return `/v1/groups/${encodeURIComponent(groupId)}/competition-territory/tiles/{z}/{x}/{y}.mvt?${params}`;
  },
  trackUrl = (flightId) => `/v1/groups/${encodeURIComponent(groupId)}/flights/${encodeURIComponent(flightId)}/track?month=${encodeURIComponent(month)}`,
  pilotColors = {},
  colorForPilot,
  onPilotChange = () => undefined,
  onFlightTrackChange = () => undefined,
  onFlightsReplace = () => undefined,
  enablePilotControls = true,
  enableFlightControls = true,
} = {}) {
  if (!map || !mapElement || !groupId || !fetchImpl) return null;
  if (!Object.keys(pilotColors).length && mapElement.dataset.groupPilotColors) {
    try { pilotColors = JSON.parse(mapElement.dataset.groupPilotColors); } catch { pilotColors = {}; }
  }
  colorForPilot ??= (pilotUserId) => pilotColors[pilotUserId] ?? mapElement.dataset.territoryColor ?? '#1769AA';
  let selectedPilotId = null;
  let selectedFlightId = null;

  function refreshTiles() {
    updateCoverageTiles(map, tileUrl({ pilotUserId: selectedPilotId }));
  }

  async function selectPilot(pilotUserId) {
    selectedPilotId = pilotUserId || null;
    selectedFlightId = null;
    clearGroupTrack(map);
    refreshTiles();
    onPilotChange(selectedPilotId);
    onFlightTrackChange(null);
    const flightsUrl = mapElement.dataset.groupFlightsUrl;
    if (flightsUrl) {
      const url = new URL(flightsUrl, globalThis.location?.origin ?? 'http://localhost');
      if (selectedPilotId) url.searchParams.set('pilot', selectedPilotId);
      url.searchParams.set('month', month);
      const response = await fetchImpl(url.pathname + url.search, { credentials: 'same-origin', headers: { accept: 'application/json' } });
      if (response.ok) onFlightsReplace(await response.json());
    }
  }

  async function selectFlight(flightId) {
    selectedFlightId = flightId || null;
    if (!selectedFlightId) {
      clearGroupTrack(map);
      onFlightTrackChange(null);
      return;
    }
    const response = await fetchImpl(trackUrl(selectedFlightId), { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Group flight track request failed with ${response.status}.`);
    const track = await response.json();
    setGroupTrack(map, track);
    const coordinates = track?.geometry?.coordinates ?? track?.features?.flatMap?.((feature) => feature?.geometry?.coordinates ?? []) ?? [];
    const points = coordinates.flat?.(Math.max(0, coordinates.length > 0 && Array.isArray(coordinates[0]?.[0]) ? 1 : 0)) ?? coordinates;
    const valid = points.filter?.((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])) ?? [];
    if (valid.length) {
      const longitudes = valid.map((point) => point[0]);
      const latitudes = valid.map((point) => point[1]);
      map.fitBounds?.(
        [[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]],
        { padding: 60, maxZoom: 12, duration: 600 },
      );
    }
    onFlightTrackChange(selectedFlightId, track);
  }

  if (enablePilotControls) for (const element of documentRef.querySelectorAll?.('[data-group-pilot-filter]') ?? []) {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      void selectPilot(element.dataset.groupPilotId);
    });
  }
  if (enableFlightControls) for (const element of documentRef.querySelectorAll?.('[data-group-flight-track]') ?? []) {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      void selectFlight(element.dataset.groupFlightId);
    });
  }
  if (enablePilotControls) for (const element of documentRef.querySelectorAll?.('[data-group-clear-pilot]') ?? []) {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      void selectPilot(null);
    });
  }

  installGroupMapLayers(map, {
    tileUrl: tileUrl(),
    minimumZoom: Number(mapElement.dataset.territoryTileMinimumZoom ?? 0),
    maximumZoom: Number(mapElement.dataset.territoryTileMaximumZoom ?? 22),
  });
  const colorRegistry = { colorFor: colorForPilot };
  const applyPilotColors = () => assignLoadedCoverageColors(map, colorRegistry);
  map.on?.('sourcedata', (event) => {
    if (event?.sourceId === 'competition-coverage' && event?.isSourceLoaded !== false) applyPilotColors();
  });
  applyPilotColors();
  return {
    refreshTiles,
    selectPilot,
    selectFlight,
    clearFlight: () => selectFlight(null),
    get selectedPilotId() { return selectedPilotId; },
    get selectedFlightId() { return selectedFlightId; },
  };
}

export { COVERAGE_FILL_LAYER_ID };
