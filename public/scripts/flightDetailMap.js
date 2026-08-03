import { createMapReplayTimeline } from './mapReplayTimeline.js';
import { installMapReplayLayer } from './mapReplayLayer.js';
import { createMapReplayCamera } from './mapReplayCamera.js';
import { initializeReplayControls } from './replayControlsController.js';

export const FLIGHT_DETAIL_SOURCE_IDS = Object.freeze({
  directCells: 'flight-detail-direct-cells',
  enclosedCells: 'flight-detail-enclosed-cells',
  track: 'flight-detail-track',
  scoreLegs: 'flight-detail-score-legs',
  scoreTurnpoints: 'flight-detail-score-turnpoints',
  launch: 'flight-detail-launch',
  landing: 'flight-detail-landing',
});

export const FLIGHT_DETAIL_SCORE_KEYS = Object.freeze([
  'threePoint',
  'fourPoint',
  'fivePoint',
  'sixPoint',
]);

export const GLIDEHERO_MAP_PALETTE = Object.freeze([
  '#0b1935',
  '#0869f7',
  '#2fa51e',
  '#ff681d',
  '#6b32b4',
]);

const EMPTY_FEATURE_COLLECTION = Object.freeze({
  type: 'FeatureCollection',
  features: Object.freeze([]),
});

/*
 * Endpoint JSON contract:
 * {
 *   territoryColor?: string,
 *   directCells?: GeoJSON,
 *   enclosedCells?: GeoJSON,
 *   track?: GeoJSON,
 *   launch?: GeoJSON,
 *   landing?: GeoJSON,
 *   scores?: {
 *     threePoint|fourPoint|fivePoint|sixPoint?: {
 *       legs?: GeoJSON,
 *       turnpoints?: GeoJSON
 *     }
 *   }
 * }
 *
 * Each GeoJSON value may be a Feature or FeatureCollection. Missing values are
 * normalized to empty FeatureCollections so the scoring sources can be updated
 * without recreating layers.
 */
export function normalizeFlightDetailPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const replay = source.replay && typeof source.replay === 'object' ? source.replay : null;
  const scores = {};
  for (const key of FLIGHT_DETAIL_SCORE_KEYS) {
    const score = source.scores?.[key];
    if (!score || typeof score !== 'object') continue;
    scores[key] = {
      legs: score.legs ?? EMPTY_FEATURE_COLLECTION,
      turnpoints: score.turnpoints ?? EMPTY_FEATURE_COLLECTION,
    };
  }
  return {
    territoryColor: typeof source.territoryColor === 'string' ? source.territoryColor : null,
    directCells: source.directCells ?? EMPTY_FEATURE_COLLECTION,
    enclosedCells: source.enclosedCells ?? EMPTY_FEATURE_COLLECTION,
    track: source.track ?? EMPTY_FEATURE_COLLECTION,
    launch: source.launch ?? EMPTY_FEATURE_COLLECTION,
    landing: source.landing ?? EMPTY_FEATURE_COLLECTION,
    scores,
    replay: replay ? { ...replay, points: Array.isArray(replay.points) ? replay.points : [] } : null,
  };
}

function normalizedHex(color) {
  const value = String(color ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value.slice(1).split('').map((part) => `${part}${part}`).join('')}`;
  }
  return null;
}

function relativeLuminance(color) {
  const hex = normalizedHex(color);
  if (!hex) return null;
  const channels = [1, 3, 5].map((offset) => {
    const component = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return component <= 0.04045
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function chooseContrastingTrackColor(
  territoryColor,
  palette = GLIDEHERO_MAP_PALETTE,
) {
  const territoryLuminance = relativeLuminance(territoryColor);
  if (territoryLuminance === null) return palette[0];
  let selected = palette[0];
  let bestContrast = -1;
  for (const color of palette) {
    const candidateLuminance = relativeLuminance(color);
    if (candidateLuminance === null) continue;
    const contrast = (
      Math.max(territoryLuminance, candidateLuminance) + 0.05
    ) / (
      Math.min(territoryLuminance, candidateLuminance) + 0.05
    );
    if (contrast > bestContrast) {
      selected = color;
      bestContrast = contrast;
    }
  }
  return selected;
}

function addGeoJsonSource(map, id, data) {
  map.addSource(id, { type: 'geojson', data });
}

export function installFlightDetailLayers(map, payload, territoryColor) {
  const data = normalizeFlightDetailPayload(payload);
  const ownerColor = data.territoryColor ?? territoryColor ?? '#0869f7';
  const trackColor = chooseContrastingTrackColor(ownerColor);

  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.enclosedCells, data.enclosedCells);
  map.addLayer({
    id: 'flight-detail-enclosed-cells-fill',
    type: 'fill',
    source: FLIGHT_DETAIL_SOURCE_IDS.enclosedCells,
    paint: { 'fill-color': ownerColor, 'fill-opacity': 0.2 },
  });
  map.addLayer({
    id: 'flight-detail-enclosed-cells-boundary',
    type: 'line',
    source: FLIGHT_DETAIL_SOURCE_IDS.enclosedCells,
    paint: {
      'line-color': ownerColor,
      'line-width': 2,
      'line-opacity': 0.75,
      'line-dasharray': [2, 2],
    },
  });

  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.directCells, data.directCells);
  map.addLayer({
    id: 'flight-detail-direct-cells-fill',
    type: 'fill',
    source: FLIGHT_DETAIL_SOURCE_IDS.directCells,
    paint: { 'fill-color': ownerColor, 'fill-opacity': 0.42 },
  });
  map.addLayer({
    id: 'flight-detail-direct-cells-boundary',
    type: 'line',
    source: FLIGHT_DETAIL_SOURCE_IDS.directCells,
    paint: { 'line-color': ownerColor, 'line-width': 2 },
  });

  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.track, data.track);
  map.addLayer({
    id: 'flight-detail-track',
    type: 'line',
    source: FLIGHT_DETAIL_SOURCE_IDS.track,
    paint: {
      'line-color': trackColor,
      'line-width': 3,
      'line-opacity': 0.9,
    },
  });

  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.scoreLegs, EMPTY_FEATURE_COLLECTION);
  map.addLayer({
    id: 'flight-detail-score-legs',
    type: 'line',
    source: FLIGHT_DETAIL_SOURCE_IDS.scoreLegs,
    paint: {
      'line-color': '#ff681d',
      'line-width': 4,
      'line-opacity': 0.95,
    },
  });
  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.scoreTurnpoints, EMPTY_FEATURE_COLLECTION);
  map.addLayer({
    id: 'flight-detail-score-turnpoints',
    type: 'circle',
    source: FLIGHT_DETAIL_SOURCE_IDS.scoreTurnpoints,
    paint: {
      'circle-radius': 5,
      'circle-color': '#ffffff',
      'circle-stroke-color': '#ff681d',
      'circle-stroke-width': 3,
    },
  });

  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.launch, data.launch);
  map.addLayer({
    id: 'flight-detail-launch',
    type: 'circle',
    source: FLIGHT_DETAIL_SOURCE_IDS.launch,
    paint: {
      'circle-radius': 6,
      'circle-color': '#2fa51e',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
  addGeoJsonSource(map, FLIGHT_DETAIL_SOURCE_IDS.landing, data.landing);
  map.addLayer({
    id: 'flight-detail-landing',
    type: 'circle',
    source: FLIGHT_DETAIL_SOURCE_IDS.landing,
    paint: {
      'circle-radius': 6,
      'circle-color': '#ff681d',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });

  return { data, trackColor };
}

function visitCoordinates(value, visit) {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
  ) {
    visit(value[0], value[1]);
    return;
  }
  for (const child of value) visitCoordinates(child, visit);
}

function visitGeoJsonCoordinates(geoJson, visit) {
  if (!geoJson || typeof geoJson !== 'object') return;
  if (geoJson.type === 'FeatureCollection') {
    for (const feature of geoJson.features ?? []) visitGeoJsonCoordinates(feature, visit);
    return;
  }
  if (geoJson.type === 'Feature') {
    visitGeoJsonCoordinates(geoJson.geometry, visit);
    return;
  }
  if (geoJson.type === 'GeometryCollection') {
    for (const geometry of geoJson.geometries ?? []) visitGeoJsonCoordinates(geometry, visit);
    return;
  }
  visitCoordinates(geoJson.coordinates, visit);
}

export function flightTrackBounds(track) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  visitGeoJsonCoordinates(track, (longitude, latitude) => {
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  });
  return Number.isFinite(west)
    ? [[west, south], [east, north]]
    : null;
}

function setSourceData(map, sourceId, data) {
  map.getSource?.(sourceId)?.setData?.(data);
}

export function updateFlightScoreOverlay(map, payload, key) {
  const data = normalizeFlightDetailPayload(payload);
  const score = key === 'track' ? null : data.scores[key];
  setSourceData(
    map,
    FLIGHT_DETAIL_SOURCE_IDS.scoreLegs,
    score?.legs ?? EMPTY_FEATURE_COLLECTION,
  );
  setSourceData(
    map,
    FLIGHT_DETAIL_SOURCE_IDS.scoreTurnpoints,
    score?.turnpoints ?? EMPTY_FEATURE_COLLECTION,
  );
  return score ? key : 'track';
}

/*
 * DOM contract:
 * - [data-flight-detail-map] carries data-map-style-url, data-map-data-url,
 *   data-territory-color, and data-default-distance.
 * - [data-flight-map-distance] buttons carry one approved score key or "track".
 * - [data-flight-map-status] is an aria-live status target for map failures.
 */
export function initializeFlightDetailMap({
  documentRef = document,
  maplibre = globalThis.window?.maplibregl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  const mapElement = documentRef.querySelector?.('[data-flight-detail-map]');
  const statusElement = documentRef.querySelector?.('[data-flight-map-status]');
  const buttons = [
    ...(documentRef.querySelectorAll?.('[data-flight-map-distance]') ?? []),
  ];
  const replayEntries = [
    ...(documentRef.querySelectorAll?.('[data-map-replay-open]') ?? []),
  ];
  replayEntries.forEach((entry) => { entry.disabled = true; });
  if (!mapElement) return;

  function setStatus(message = '') {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.hidden = !message;
  }

  if (!maplibre || !fetchImpl || !mapElement.dataset.mapDataUrl) {
    setStatus('Map unavailable. Check your connection and try again.');
    return;
  }

  let payload = normalizeFlightDetailPayload();
  let selectedKey = 'track';
  let ready = false;
  let map;
  let replayControls;

  function renderSelection(requestedKey) {
    const key = ready
      ? updateFlightScoreOverlay(map, payload, requestedKey)
      : requestedKey;
    selectedKey = key;
    for (const button of buttons) {
      const selected = button.dataset.flightMapDistance === key;
      button.setAttribute?.('aria-pressed', String(selected));
    }
    return key;
  }

  for (const button of buttons) {
    button.addEventListener?.('click', () => {
      renderSelection(button.dataset.flightMapDistance || 'track');
    });
  }

  try {
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: [-106.2, 39.2],
      zoom: 7,
    });
    map.addControl?.(new maplibre.NavigationControl(), 'top-right');
    map.once?.('error', () => setStatus('Map unavailable. Check your connection and try again.'));
    map.once?.('load', async () => {
      try {
        const response = await fetchImpl(mapElement.dataset.mapDataUrl, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`Flight map request failed with ${response.status}.`);
        payload = normalizeFlightDetailPayload(await response.json());
        installFlightDetailLayers(map, payload, mapElement.dataset.territoryColor);
        ready = true;
        const defaultKey = mapElement.dataset.defaultDistance || 'track';
        renderSelection(payload.scores[defaultKey] ? defaultKey : 'track');
        const bounds = flightTrackBounds(payload.track);
        if (bounds) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
        }
        replayControls = initializeReplayControls({
          documentRef,
          onOpen: ({ setTimeline, setStatus, isCurrent }) => {
            const replay = payload.replay;
            if (!replay || !Array.isArray(replay.points) || replay.points.length === 0) {
              setStatus('Replay unavailable.');
              return;
            }
            if (!isCurrent()) return;
            const layer = installMapReplayLayer(map, { dimLayerIds: [], colorForPilot: () => chooseContrastingTrackColor(payload.territoryColor ?? mapElement.dataset.territoryColor), maplibre, documentRef });
            const camera = createMapReplayCamera(map, { documentRef });
            const timeline = createMapReplayTimeline({ flights: [replay] });
            const originalDestroy = timeline.destroy;
            timeline.destroy = () => { layer.close?.(); camera.destroy?.(); originalDestroy(); };
            timeline.subscribe((state) => { layer.update(state); camera.update(state); });
            setTimeline(timeline);
            setStatus('');
          },
        });
        if (payload.replay?.points?.length) {
          replayEntries.forEach((entry) => { entry.disabled = false; });
          await replayControls.open();
        }
        setStatus('');
      } catch {
        setStatus('Unable to load this flight map. Try again.');
      }
    });
  } catch {
    setStatus('Map unavailable. Check your connection and try again.');
    return;
  }

  return {
    map,
    get selectedKey() {
      return selectedKey;
    },
    selectDistance: renderSelection,
    get replayControls() {
      return replayControls;
    },
  };
}
