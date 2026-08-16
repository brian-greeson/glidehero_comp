import { createMapReplayTimeline } from '../mapReplayTimeline.js';
import { installMapReplayLayer } from '../mapReplayLayer.js';
import { createMapReplayCamera, isMapReplayCameraMoveEvent } from '../mapReplayCamera.js';
import { initializeReplayControls } from '../replayControlsController.js';
import { normalizeViewportBounds, viewportSearchParams } from '../viewportQuery.js';
import { mapViewportFromSearch } from '../mapViewportUrl.js';
import { initializePersonalHistory } from './personalHistory.js';
import { initializeLaunchSelector } from './launchSelector.js';
import {
  LAUNCH_CLUSTER_LAYER_ID,
  LAUNCH_MARKER_LAYER_ID,
  LAUNCH_SOURCE_ID,
  installLaunchLayers,
  launchFeatureCollection,
  launchLayerVisibleFromSearch,
  launchLocationLabel,
  mapLaunchDetailRequestUrl,
  mapLaunchRequestUrl,
  normalizeLaunchDetailPayload,
  normalizeLaunchMarkerPayload,
  selectedLaunchIdFromSearch,
  setLaunchLayerVisibility,
} from './mapLaunchLayer.js';

export const FLIGHT_TRACK_SOURCE_ID = 'flight-map-tracks';
export const FLIGHT_TRACK_LAYER_ID = 'flight-map-tracks-line';
export const FLIGHT_TRACK_HIT_LAYER_ID = 'flight-map-tracks-hit';

const PERIODS = new Set(['day', 'month', 'year', 'custom', 'all-time']);
const SCOPES = new Set(['personal', 'following', 'all']);
const SORTS = new Set(['distance', 'latest', 'duration']);

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validAnchor(period, value) {
  if (period !== 'all-time') return validIsoDate(value);
  return period === 'all-time';
}

export function defaultPeriodAnchor(period, now = new Date()) {
  const date = localIsoDate(now);
  if (period === 'all-time') return '';
  if (period === 'year') return `${date.slice(0, 4)}-01-01`;
  if (period === 'month') return `${date.slice(0, 7)}-01`;
  return date;
}

export function periodStateFromSearch(search = '', now = new Date(), initialPeriod = 'month') {
  const query = new URLSearchParams(search);
  const requested = query.get('period');
  const period = PERIODS.has(requested) && !(initialPeriod === 'all-time' && requested === 'day') ? requested : (initialPeriod === 'all-time' ? 'all-time' : 'month');
  const legacyMonth = query.get('month') ? `${query.get('month')}-01` : null;
  if (period === 'custom') {
    const startDate = query.get('start'); const endDate = query.get('end');
    if (validIsoDate(startDate) && validIsoDate(endDate) && startDate <= endDate) {
      return { period, startDate, endDate };
    }
    const today = localIsoDate(now);
    return { period, startDate: today, endDate: today };
  }
  if (period === 'all-time') return { period, anchor: '' };
  const anchor = query.get('anchor') ?? (period === 'month' ? legacyMonth : null);
  return { period, anchor: validAnchor(period, anchor) ? (anchor ?? '') : defaultPeriodAnchor(period, now) };
}

export function stepPeriod(state, direction) {
  const { period, anchor } = state;
  if (period === 'all-time' || period === 'custom') return period === 'custom' ? state : { period, anchor: '' };
  const sign = direction === 'previous' ? -1 : 1;
  const parts = anchor.split('-').map(Number);
  const date = period === 'year'
    ? new Date(parts[0], 0, 1)
    : new Date(parts[0], (parts[1] ?? 1) - 1, period === 'day' ? (parts[2] ?? 1) : 1);
  if (period === 'day') date.setDate(date.getDate() + sign);
  if (period === 'month') date.setMonth(date.getMonth() + sign);
  if (period === 'year') date.setFullYear(date.getFullYear() + sign);
  return { period, anchor: defaultPeriodAnchor(period, date) };
}

export function periodLabel({ period, anchor }) {
  if (period === 'all-time') return 'All Time';
  if (period === 'custom') return 'Custom range';
  const [year, month = 1, day = 1] = anchor.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (period === 'day') return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  if (period === 'month') return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
  return String(year);
}

function normalizedScope(value) { return SCOPES.has(value) ? value : 'following'; }
function normalizedSort(value) { return SORTS.has(value) ? value : 'distance'; }

function requestPeriodValues(state) {
  if (state.period === 'all-time') return { period: 'all-time' };
  if (state.period === 'custom') return { period: 'custom', start: state.startDate, end: state.endDate };
  return { period: state.period, anchor: state.anchor };
}

export function mapTrackRequestUrl(endpoint, { scope, period, bounds, zoom, launch }) {
  const query = viewportSearchParams(bounds, {
    scope: normalizedScope(scope),
    ...requestPeriodValues(period),
    zoom: String(Math.max(0, Number(zoom) || 0)),
    ...(launch ? { launch } : {}),
  });
  return `${endpoint}?${query}`;
}

export function mapFlightListRequestUrl(endpoint, { scope, period, geography, sort, bounds, cursor, launch }) {
  const values = {
    scope: normalizedScope(scope),
    ...requestPeriodValues(period),
    geography: geography === 'map-area' ? 'map-area' : 'global',
    sort: normalizedSort(sort),
    ...(launch ? { launch } : {}),
    ...(cursor ? { cursor } : {}),
  };
  const query = geography === 'map-area' && bounds
    ? viewportSearchParams(bounds, values)
    : new URLSearchParams(values);
  return `${endpoint}?${query}`;
}

export function mapFlightSelectionRequestUrl(endpointTemplate, flightId, { scope, period, geography, bounds, launch }) {
  const endpoint = endpointTemplate.replace('{flightId}', encodeURIComponent(String(flightId)));
  const values = {
    scope: normalizedScope(scope),
    ...requestPeriodValues(period),
    geography: geography === 'map-area' ? 'map-area' : 'global',
    ...(launch ? { launch } : {}),
  };
  const query = geography === 'map-area' && bounds ? viewportSearchParams(bounds, values) : new URLSearchParams(values);
  return `${endpoint}?${query}`;
}

function pilotFor(item) {
  const pilot = item?.pilot ?? {};
  return {
    id: String(pilot.id ?? item?.pilotUserId ?? ''),
    displayName: String(pilot.displayName ?? item?.pilotDisplayName ?? 'Pilot'),
    initials: String(pilot.initials ?? '').slice(0, 2),
    color: String(pilot.color ?? item?.pilotColor ?? item?.color ?? '#087cf0'),
    avatarUrl: pilot.avatarUrl ?? item?.avatarUrl ?? null,
  };
}

function distanceLabel(item) {
  const meters = Number(item?.fivePointDistanceMeters);
  return Number.isFinite(meters) ? `${(meters / 1000).toFixed(1)} km` : String(item?.distanceLabel ?? item?.distance ?? '—');
}

function durationLabel(item) {
  const seconds = Number(item?.durationSeconds);
  if (!Number.isFinite(seconds)) return String(item?.durationLabel ?? item?.duration ?? '—');
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function dateLabel(item) {
  if (item?.dateLabel || item?.flightDate) return String(item.dateLabel ?? item.flightDate);
  const date = new Date(item?.startedAt);
  if (!Number.isFinite(date.getTime())) return '';
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(item.launchTimezone ? { timeZone: item.launchTimezone } : {}) }).format(date); }
  catch { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date); }
}

function locationLabel(item) {
  if (item?.location || item?.launchName) return String(item.location ?? item.launchName);
  return 'Unknown launch';
}

function normalizeFlight(item) {
  const id = String(item.id ?? item.flightId ?? '');
  return {
    ...item,
    id,
    href: String(item.href ?? `/flights/${id}`),
    pilot: pilotFor(item),
    location: locationLabel(item),
    dateLabel: dateLabel(item),
    distanceLabel: distanceLabel(item),
    durationLabel: durationLabel(item),
    thumbnailUrl: item.thumbnailUrl ?? item.thumbnail?.squareUrl ?? null,
  };
}

export function normalizeFlightListPayload(payload) {
  const rows = Array.isArray(payload?.flights) ? payload.flights : Array.isArray(payload?.items) ? payload.items : [];
  return {
    flights: rows.map(normalizeFlight).filter((item) => item.id),
    nextCursor: typeof payload?.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : null,
  };
}

export function normalizeTrackPayload(payload) {
  const rows = Array.isArray(payload?.flights) ? payload.flights : Array.isArray(payload?.tracks) ? payload.tracks : [];
  return rows.map((item) => {
    const geometry = item.geometry ?? item.trajectory ?? item.track;
    return {
      ...normalizeFlight(item),
      geometry: Array.isArray(geometry)
        ? { type: 'LineString', coordinates: geometry }
        : geometry,
    };
  }).filter((item) => item.id && ['LineString', 'MultiLineString'].includes(item.geometry?.type));
}

export function trackStatusMessage(tracks, truncated = false) {
  if (truncated) return 'Some flights are hidden. Zoom in to see all flights in this area.';
  return tracks.length ? '' : 'No flights in this map area.';
}

function featureCollection(tracks, selectedId) {
  return {
    type: 'FeatureCollection',
    features: tracks.map((track) => ({
      type: 'Feature',
      id: track.id,
      properties: {
        flightId: track.id,
        pilotId: track.pilot.id,
        trackColor: track.pilot.color,
        selected: track.id === selectedId,
      },
      geometry: track.geometry,
    })),
  };
}

export function installFlightTrackLayers(map) {
  if (!map.getSource?.(FLIGHT_TRACK_SOURCE_ID)) map.addSource(FLIGHT_TRACK_SOURCE_ID, { type: 'geojson', data: featureCollection([], null) });
  if (!map.getLayer?.(FLIGHT_TRACK_LAYER_ID)) map.addLayer({
    id: FLIGHT_TRACK_LAYER_ID,
    type: 'line',
    source: FLIGHT_TRACK_SOURCE_ID,
    paint: {
      'line-color': ['get', 'trackColor'],
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 5, 2.5],
      'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 1, 0.82],
    },
  });
  if (!map.getLayer?.(FLIGHT_TRACK_HIT_LAYER_ID)) map.addLayer({
    id: FLIGHT_TRACK_HIT_LAYER_ID,
    type: 'line',
    source: FLIGHT_TRACK_SOURCE_ID,
    paint: { 'line-color': 'rgba(0,0,0,0)', 'line-width': 18 },
  });
}

function text(documentRef, tag, className, value) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function flightCard(documentRef, flight) {
  const item = documentRef.createElement('li');
  item.className = 'flight-browser-card'; item.dataset.flightId = flight.id;
  const select = documentRef.createElement('button');
  select.className = 'flight-browser-card__select'; select.type = 'button';
  select.setAttribute('aria-label', `Show ${flight.pilot.displayName}'s flight on the map`);
  const avatar = documentRef.createElement(flight.pilot.avatarUrl ? 'img' : 'span');
  avatar.className = 'flight-browser-card__avatar';
  if (flight.pilot.avatarUrl) { avatar.src = flight.pilot.avatarUrl; avatar.alt = ''; }
  else avatar.textContent = flight.pilot.initials || flight.pilot.displayName.slice(0, 2).toUpperCase();
  const main = documentRef.createElement('span'); main.className = 'flight-browser-card__main';
  const pilot = text(documentRef, 'strong', 'flight-browser-card__pilot', flight.pilot.displayName);
  pilot.style.setProperty('--pilot-color', flight.pilot.color);
  const when = text(documentRef, 'span', '', [flight.timeAgo, flight.dateLabel].filter(Boolean).join(' · '));
  const location = text(documentRef, 'span', 'flight-browser-card__location', flight.location);
  main.append(pilot, when, location);
  if (flight.thumbnailUrl) { const image = documentRef.createElement('img'); image.className = 'flight-browser-card__thumbnail'; image.src = flight.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; select.append(avatar, main, image); }
  else select.append(avatar, main);
  const metrics = documentRef.createElement('span'); metrics.className = 'flight-browser-card__metrics';
  metrics.innerHTML = `<span><span>Distance</span><strong></strong></span><span><span>Duration</span><strong></strong></span>`;
  const values = metrics.querySelectorAll('strong'); values[0].textContent = flight.distanceLabel; values[1].textContent = flight.durationLabel;
  const link = documentRef.createElement('a'); link.className = 'flight-browser-card__review'; link.href = flight.href;
  link.setAttribute('aria-label', `Open ${flight.pilot.displayName}'s flight review`); link.textContent = '›';
  select.append(metrics); item.append(select, link);
  return item;
}

function fitBoundsValue(bounds) {
  if (!bounds) return null;
  const west = Number(bounds.west); const south = Number(bounds.south); const east = Number(bounds.east); const north = Number(bounds.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return [[west, south], [east < west ? east + 360 : east, north]];
}

function replayFlights(payload, selected) {
  if (Array.isArray(payload?.flights)) return payload.flights.map((flight) => ({
    ...flight,
    track: flight.track ?? flight.points,
  }));
  const row = payload?.flight ?? payload;
  const track = row?.track ?? row?.points;
  if (!Array.isArray(track)) return [];
  return [{ ...row, track, flightId: row.flightId ?? selected.id, pilotUserId: row.pilotUserId ?? selected.pilot.id }];
}

export function initializeFlightMap({ documentRef = document, maplibre = globalThis.window?.maplibregl, fetchImpl = globalThis.fetch?.bind(globalThis), locationRef = globalThis.location, historyRef = globalThis.history, now = () => new Date() } = {}) {
  const root = documentRef.querySelector?.('[data-map-page]');
  const mapNode = documentRef.querySelector?.('[data-map-canvas]');
  const list = documentRef.querySelector?.('[data-flight-list]');
  if (!root || !mapNode || !list || !maplibre || !fetchImpl) return null;

  const scope = documentRef.querySelector('[data-map-scope]');
  const sort = documentRef.querySelector('[data-map-sort]');
  const periodSelect = documentRef.querySelector('[data-map-period]');
  const periodValueNode = documentRef.querySelector('.flight-map-period [data-styled-select-value]');
  const periodLabelNode = documentRef.querySelector('[data-map-period-label]');
  const periodSteps = [...documentRef.querySelectorAll('[data-map-period-step]')];
  const customRange = documentRef.querySelector('[data-map-custom-range]');
  const customStart = documentRef.querySelector('[data-map-custom-start]');
  const customEnd = documentRef.querySelector('[data-map-custom-end]');
  const customApply = documentRef.querySelector('[data-map-custom-apply]');
  const geographyButtons = [...documentRef.querySelectorAll('[data-map-geography]')];
  const loadMore = documentRef.querySelector('[data-flight-load-more]');
  const listStatus = documentRef.querySelector('[data-flight-list-status]');
  const mapStatus = documentRef.querySelector('[data-map-status]');
  const replayRoot = documentRef.querySelector('[data-selected-flight-replay]');
  const browser = documentRef.querySelector('[data-flight-browser]');
  const launchToggle = documentRef.querySelector('[data-map-launch-toggle]');
  const launchPanel = documentRef.querySelector('[data-launch-info-panel]');
  const launchPanelStatus = documentRef.querySelector('[data-launch-info-status]');
  const launchPanelContent = documentRef.querySelector('[data-launch-info-content]');
  const launchPanelName = documentRef.querySelector('[data-launch-info-name]');
  const launchPanelLocation = documentRef.querySelector('[data-launch-info-location]');
  const launchPanelElevation = documentRef.querySelector('[data-launch-info-elevation]');
  const launchPanelFlightCount = documentRef.querySelector('[data-launch-info-flight-count]');
  const launchPanelVisitedRow = documentRef.querySelector('[data-launch-info-visited-row]');
  const launchPanelVisited = documentRef.querySelector('[data-launch-info-visited]');
  const launchPanelDescription = documentRef.querySelector('[data-launch-info-description]');
  const launchPanelFilter = documentRef.querySelector('[data-launch-info-filter]');
  const launchPanelClose = documentRef.querySelector('[data-launch-info-close]');
  let period = periodStateFromSearch(locationRef?.search ?? '', now(), root.dataset.initialPeriod);
  let currentPath = locationRef?.pathname ?? '/following';
  let urlState = new URLSearchParams(locationRef?.search ?? '');
  const initialLaunchFilter = urlState.get('launch');
  let launchFilter = initialLaunchFilter === 'unknown' || (Number.isSafeInteger(Number(initialLaunchFilter)) && Number(initialLaunchFilter) > 0) ? initialLaunchFilter : null;
  let launchLayerVisible = launchLayerVisibleFromSearch(locationRef?.search ?? '');
  let selectedLaunchId = selectedLaunchIdFromSearch(locationRef?.search ?? '');
  const initialSelectedFlight = urlState.get('selectedFlight');
  let selectedFlightId = selectedLaunchId ? null : (/^[0-9a-f-]{36}$/i.test(initialSelectedFlight ?? '') ? initialSelectedFlight : null);
  let geography = urlState.get('geography') === 'map-area' ? 'map-area' : 'global'; let cursor = null; let tracks = []; let flights = new Map(); let selected = null;
  const initialSort = urlState.get('sort');
  if (sort && SORTS.has(initialSort)) sort.value = initialSort;
  geographyButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mapGeography === geography)));
  let launches = [];
  let personalHistory = null;
  let launchSelector = null;
  let selectedLaunchDetail = null;
  let trackAbort = null; let listAbort = null; let launchAbort = null; let launchDetailAbort = null; let launchFilterDetailAbort = null; let selectionAbort = null; let replayLayer = null; let replayCamera = null;

  const initialViewport = mapViewportFromSearch(locationRef?.search ?? '');
  const map = new maplibre.Map({ container: mapNode, style: mapNode.dataset.mapStyleUrl, center: initialViewport?.center ?? [-106.2, 39.2], zoom: initialViewport?.zoom ?? 7, maxPitch: 0 });
  map.addControl?.(new maplibre.NavigationControl(), 'top-right');

  const show = (node, message) => { if (!node) return; node.textContent = message; node.hidden = !message; };
  const parameters = () => ({ scope: scope?.value ?? root.dataset.initialScope, period, geography, sort: sort?.value ?? 'distance', bounds: map.getBounds?.(), zoom: map.getZoom?.(), launch: launchFilter });
  const updatePeriodUi = () => {
    if (periodSelect) periodSelect.value = period.period;
    periodSelect?.dispatchEvent?.(new Event('styled-select-sync'));
    if (periodValueNode) periodValueNode.textContent = periodLabel(period);
    if (periodLabelNode) periodLabelNode.textContent = periodLabel(period);
    periodSteps.forEach((button) => { button.disabled = period.period === 'all-time' || period.period === 'custom'; });
    if (customRange) customRange.hidden = period.period !== 'custom';
    if (period.period === 'custom') {
      if (customStart) customStart.value = period.startDate;
      if (customEnd) customEnd.value = period.endDate;
    }
  };
  const syncUrl = ({ push = false } = {}) => {
    if (!historyRef?.replaceState || !locationRef) return;
    const query = new URLSearchParams(urlState); query.delete('month');
    query.set('period', period.period);
    if (period.anchor) query.set('anchor', period.anchor); else query.delete('anchor');
    if (period.period === 'custom') { query.set('start', period.startDate); query.set('end', period.endDate); }
    else { query.delete('start'); query.delete('end'); }
    if (launchFilter) query.set('launch', launchFilter); else query.delete('launch');
    query.set('sort', sort?.value ?? 'distance');
    query.set('geography', geography);
    if (launchLayerVisible) query.delete('launches'); else query.set('launches', 'off');
    if (selectedLaunchId) query.set('selectedLaunch', String(selectedLaunchId)); else query.delete('selectedLaunch');
    if (selectedFlightId) query.set('selectedFlight', selectedFlightId); else query.delete('selectedFlight');
    const center = map.getCenter?.(); const zoom = map.getZoom?.();
    if (center && Number.isFinite(zoom)) { query.set('lat', Number(center.lat).toFixed(5)); query.set('lng', Number(center.lng).toFixed(5)); query.set('zoom', Number(zoom).toFixed(2)); }
    const method = push && historyRef.pushState ? 'pushState' : 'replaceState';
    historyRef[method](null, '', `${currentPath}?${query}`);
    urlState = query;
  };
  const setTrackData = () => map.getSource?.(FLIGHT_TRACK_SOURCE_ID)?.setData(featureCollection(tracks, selected?.id));
  const setLaunchData = () => map.getSource?.(LAUNCH_SOURCE_ID)?.setData(launchFeatureCollection(launches, selectedLaunchId));

  const clearLaunchSelection = ({ sync = false, push = false } = {}) => {
    launchDetailAbort?.abort(); launchDetailAbort = null; selectedLaunchId = null; selectedLaunchDetail = null;
    if (launchPanel) launchPanel.hidden = true;
    setLaunchData();
    if (sync) syncUrl({ push });
  };

  const renderLaunchDetail = (launch) => {
    if (!launchPanel || !launchPanelContent) return;
    selectedLaunchDetail = launch;
    launchPanel.hidden = false; launchPanelContent.hidden = false;
    if (launchPanelStatus) launchPanelStatus.textContent = '';
    if (launchPanelName) launchPanelName.textContent = launch.name;
    if (launchPanelLocation) launchPanelLocation.textContent = launchLocationLabel(launch) || 'Location unavailable';
    if (launchPanelElevation) launchPanelElevation.textContent = launch.elevationMeters === null ? 'Unavailable' : `${Math.round(launch.elevationMeters).toLocaleString()} m`;
    if (launchPanelFlightCount) launchPanelFlightCount.textContent = String(launch.matchingFlightCount);
    if (launchPanelVisitedRow) launchPanelVisitedRow.hidden = parameters().scope !== 'personal';
    if (launchPanelVisited) launchPanelVisited.textContent = launch.visited ? 'Visited' : 'Not visited';
    if (launchPanelDescription) { launchPanelDescription.textContent = launch.description ?? ''; launchPanelDescription.hidden = !launch.description; }
    if (String(launchFilter) === String(launch.launchId)) launchSelector?.setSelection({ type: 'launch', launch });
  };

  const selectLaunch = async (launchId, { push = true } = {}) => {
    if (!Number.isSafeInteger(Number(launchId)) || Number(launchId) < 1) return;
    replayControls.close(); selected = null; selectedFlightId = null; if (replayRoot) replayRoot.hidden = true;
    for (const card of list.querySelectorAll('[data-flight-id]')) card.classList.remove('is-selected');
    setTrackData(); selectedLaunchId = Number(launchId); setLaunchData();
    if (launchPanel) launchPanel.hidden = false;
    if (launchPanelContent) launchPanelContent.hidden = true;
    if (launchPanelName) launchPanelName.textContent = 'Launch information';
    if (launchPanelStatus) launchPanelStatus.textContent = 'Loading launch information…';
    syncUrl({ push });
    launchDetailAbort?.abort(); launchDetailAbort = new AbortController();
    try {
      const response = await fetchImpl(mapLaunchDetailRequestUrl(root.dataset.launchDetailEndpointTemplate, selectedLaunchId, parameters()), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: launchDetailAbort.signal });
      if (!response.ok) throw new Error(`Launch detail request failed (${response.status})`);
      const detail = normalizeLaunchDetailPayload(await response.json());
      if (!detail || detail.launchId !== selectedLaunchId) throw new Error('Launch detail response is invalid.');
      renderLaunchDetail(detail);
    } catch (error) {
      if (error?.name !== 'AbortError' && selectedLaunchId === Number(launchId)) {
        if (launchPanelStatus) launchPanelStatus.textContent = 'Unable to load launch information.';
      }
    }
  };

  const hydrateLaunchFilter = async () => {
    launchFilterDetailAbort?.abort(); launchFilterDetailAbort = null;
    const launchId = Number(launchFilter);
    if (!Number.isSafeInteger(launchId) || launchId < 1) return;
    const controller = new AbortController(); launchFilterDetailAbort = controller;
    try {
      const response = await fetchImpl(mapLaunchDetailRequestUrl(root.dataset.launchDetailEndpointTemplate, launchId, parameters()), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Launch detail request failed (${response.status})`);
      const detail = normalizeLaunchDetailPayload(await response.json());
      if (!detail || detail.launchId !== launchId) throw new Error('Launch detail response is invalid.');
      if (launchFilterDetailAbort === controller && String(launchFilter) === String(launchId)) launchSelector?.setSelection({ type: 'launch', launch: detail });
    } catch (error) {
      if (error?.name !== 'AbortError' && launchFilterDetailAbort === controller) show(mapStatus, 'Unable to restore the launch filter label.');
    } finally {
      if (launchFilterDetailAbort === controller) launchFilterDetailAbort = null;
    }
  };

  const replayControls = initializeReplayControls({ documentRef, root: replayRoot, onClose: () => {
    replayLayer?.close?.(); replayLayer = null; replayCamera?.destroy?.(); replayCamera = null;
  }, onOpen: async ({ setTimeline, setStatus, isCurrent }) => {
    if (!selected) return;
    const endpoint = root.dataset.replayEndpointTemplate.replace('{flightId}', encodeURIComponent(selected.id));
    const response = await fetchImpl(endpoint, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Replay request failed (${response.status})`);
    const payload = await response.json(); const replayRows = replayFlights(payload, selected);
    if (!isCurrent()) return;
    if (!replayRows.length) { setStatus('Replay unavailable for this flight.'); return; }
    replayLayer = installMapReplayLayer(map, { colorForPilot: () => selected.pilot.color, dimLayerIds: [[FLIGHT_TRACK_LAYER_ID, 'line-opacity']], maplibre, documentRef });
    replayCamera = createMapReplayCamera(map, { documentRef });
    const timeline = createMapReplayTimeline({ flights: replayRows });
    timeline.subscribe((state) => { replayLayer?.update(state); replayCamera?.update(state); });
    setTimeline(timeline); setStatus('');
  } });

  const clearFlightSelection = ({ sync = false } = {}) => {
    selectionAbort?.abort(); selectionAbort = null;
    replayControls.close(); selected = null; selectedFlightId = null;
    if (replayRoot) replayRoot.hidden = true;
    for (const card of list.querySelectorAll('[data-flight-id]')) card.classList.remove('is-selected');
    setTrackData();
    if (sync) syncUrl();
  };

  const applySelection = (flight, { fit = true, scroll = true, push = true } = {}) => {
    if (!flight?.id) return;
    selectionAbort?.abort(); selectionAbort = null;
    clearLaunchSelection();
    flights.set(flight.id, flight);
    replayControls.close(); selected = flight; selectedFlightId = flight.id; if (replayRoot) replayRoot.hidden = false;
    setTrackData();
    for (const card of list.querySelectorAll('[data-flight-id]')) card.classList.toggle('is-selected', card.dataset.flightId === flight.id);
    let card = list.querySelector(`[data-flight-id="${globalThis.CSS?.escape?.(flight.id) ?? flight.id}"]`);
    if (!card) { card = flightCard(documentRef, flight); list.prepend(card); bindCard(card); }
    if (scroll) card?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    const fitted = fitBoundsValue(flight.bounds);
    if (fit && fitted) {
      const mobile = globalThis.matchMedia?.('(max-width: 900px)')?.matches;
      const padding = mobile ? { top: 96, right: 28, bottom: Math.min(browser?.offsetHeight ?? 280, 360) + 24, left: 28 } : { top: 40, right: 40, bottom: 40, left: (browser?.offsetWidth ?? 360) + 40 };
      map.fitBounds?.(fitted, { padding, duration: 500, maxZoom: 13 });
    }
    syncUrl({ push });
    void replayControls.open();
  };

  function bindCard(card) {
    const select = card.querySelector('.flight-browser-card__select');
    select?.addEventListener('click', () => {
      const flight = flights.get(card.dataset.flightId); if (flight) applySelection(flight);
    });
  }

  const renderFlights = (rows, append) => {
    if (!append) { list.replaceChildren(); flights = new Map(); }
    for (const flight of rows) {
      flights.set(flight.id, flight);
      if (list.querySelector(`[data-flight-id="${globalThis.CSS?.escape?.(flight.id) ?? flight.id}"]`)) continue;
      const card = flightCard(documentRef, flight); bindCard(card); list.append(card);
      card.classList.toggle('is-selected', flight.id === selectedFlightId);
    }
  };

  const refreshTracks = async () => {
    const bounds = map.getBounds?.(); if (!bounds) return;
    trackAbort?.abort(); trackAbort = new AbortController();
    try {
      const response = await fetchImpl(mapTrackRequestUrl(root.dataset.trackEndpoint, { ...parameters(), bounds }), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: trackAbort.signal });
      if (!response.ok) throw new Error(`Flight tracks request failed (${response.status})`);
      const payload = await response.json();
      tracks = normalizeTrackPayload(payload); setTrackData(); show(mapStatus, trackStatusMessage(tracks, payload?.truncated === true));
    } catch (error) { if (error?.name !== 'AbortError') show(mapStatus, 'Unable to load flights for this map area.'); }
  };

  const refreshList = async ({ append = false } = {}) => {
    listAbort?.abort(); listAbort = new AbortController();
    if (!append) cursor = null;
    if (loadMore) { loadMore.disabled = true; loadMore.hidden = true; }
    show(listStatus, append ? 'Loading more flights…' : 'Loading flights…');
    try {
      const response = await fetchImpl(mapFlightListRequestUrl(root.dataset.listEndpoint, { ...parameters(), cursor }), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: listAbort.signal });
      if (!response.ok) throw new Error(`Flight list request failed (${response.status})`);
      const payload = normalizeFlightListPayload(await response.json()); renderFlights(payload.flights, append); cursor = payload.nextCursor;
      show(listStatus, list.children.length ? '' : 'No flights match these filters.');
      if (loadMore) { loadMore.hidden = !cursor; loadMore.disabled = false; }
    } catch (error) { if (error?.name !== 'AbortError') { show(listStatus, 'Unable to load flights.'); if (loadMore) loadMore.disabled = false; } }
  };

  const revalidateSelectedFlight = async ({ restore = false } = {}) => {
    if (!selectedFlightId) return;
    selectionAbort?.abort();
    const requestedFlightId = selectedFlightId;
    const controller = new AbortController(); selectionAbort = controller;
    try {
      const response = await fetchImpl(mapFlightSelectionRequestUrl(root.dataset.selectionEndpointTemplate, requestedFlightId, parameters()), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: controller.signal });
      if (response.status === 404) {
        if (selectedFlightId === requestedFlightId) clearFlightSelection({ sync: true });
        return;
      }
      if (!response.ok) throw new Error(`Flight selection request failed (${response.status})`);
      const payload = normalizeFlightListPayload({ items: [await response.json()] });
      const flight = payload.flights[0];
      if (!flight || flight.id !== requestedFlightId) throw new Error('Flight selection response is invalid.');
      if (selectedFlightId !== requestedFlightId) return;
      applySelection(flight, { fit: restore, scroll: false, push: false });
    } catch (error) {
      if (error?.name !== 'AbortError' && restore) show(mapStatus, 'Unable to restore the selected flight.');
    } finally {
      if (selectionAbort === controller) selectionAbort = null;
    }
  };

  const refreshListAndSelection = async () => {
    await refreshList();
    if (selectedFlightId) await revalidateSelectedFlight();
  };

  const refreshLaunches = async () => {
    if (!launchLayerVisible) return;
    const bounds = map.getBounds?.(); if (!bounds) return;
    launchAbort?.abort(); launchAbort = new AbortController();
    try {
      const response = await fetchImpl(mapLaunchRequestUrl(root.dataset.launchEndpoint, bounds, parameters()), { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: launchAbort.signal });
      if (!response.ok) throw new Error(`Launch marker request failed (${response.status})`);
      launches = normalizeLaunchMarkerPayload(await response.json()); setLaunchData();
    } catch (error) {
      if (error?.name !== 'AbortError') show(mapStatus, 'Unable to load launches for this map area.');
    }
  };

  const refreshPersonalHistory = () => personalHistory?.refresh({
    period,
    geography,
    bounds: map.getBounds?.(),
    launch: launchFilter,
  });

  if (root.dataset.initialScope === 'personal') personalHistory = initializePersonalHistory({ documentRef, fetchImpl });

  const refreshLaunchFilteredResults = () => {
    void refreshTracks(); void refreshPersonalHistory();
    void (async () => { await refreshList(); if (selectedFlightId) await revalidateSelectedFlight(); })();
  };

  const applyLaunchSelectorSelection = (selection) => {
    launchFilterDetailAbort?.abort(); launchFilterDetailAbort = null;
    if (selection?.type === 'all') {
      launchFilter = null; clearLaunchSelection(); syncUrl({ push: true }); refreshLaunchFilteredResults();
      return;
    }
    if (selection?.type === 'unknown') {
      launchFilter = 'unknown'; clearLaunchSelection(); syncUrl({ push: true }); refreshLaunchFilteredResults();
      return;
    }
    const launch = selection?.type === 'launch' ? selection.launch : null;
    if (!Number.isSafeInteger(Number(launch?.launchId)) || !Number.isFinite(Number(launch?.longitude)) || !Number.isFinite(Number(launch?.latitude))) return;
    launchFilter = String(launch.launchId);
    map.easeTo?.({ center: [Number(launch.longitude), Number(launch.latitude)], zoom: 12, duration: 500 });
    void selectLaunch(Number(launch.launchId), { push: true });
    refreshLaunchFilteredResults();
  };

  launchSelector = initializeLaunchSelector({
    documentRef,
    fetchImpl,
    getViewport: () => normalizeViewportBounds(map.getBounds?.()),
    onSelect: applyLaunchSelectorSelection,
  });
  if (launchFilter === 'unknown') launchSelector?.setSelection({ type: 'unknown' });
  else if (!launchFilter) launchSelector?.setSelection({ type: 'all' });
  else void hydrateLaunchFilter();

  const refreshAll = ({ push = false } = {}) => {
    replayControls.close(); syncUrl({ push });
    void refreshTracks(); void refreshLaunches(); void refreshPersonalHistory();
    void (async () => { await refreshList(); if (selectedFlightId) await revalidateSelectedFlight(); })();
    if (selectedLaunchId) void selectLaunch(selectedLaunchId, { push: false });
  };
  scope?.addEventListener('change', () => {
    currentPath = { personal: '/personal', following: '/following', all: '/global' }[normalizedScope(scope.value)];
    refreshAll({ push: true });
  }); sort?.addEventListener('change', () => { syncUrl({ push: true }); void refreshListAndSelection(); });
  geographyButtons.forEach((button) => button.addEventListener('click', () => { geography = button.dataset.mapGeography; geographyButtons.forEach((node) => node.setAttribute('aria-pressed', String(node === button))); syncUrl({ push: true }); void refreshPersonalHistory(); void (async () => { await refreshList(); if (selectedFlightId) await revalidateSelectedFlight(); })(); }));
  periodSelect?.addEventListener('change', () => {
    if (periodSelect.value === 'custom') {
      const today = localIsoDate(now()); period = { period: 'custom', startDate: today, endDate: today }; updatePeriodUi(); return;
    }
    period = { period: periodSelect.value, anchor: defaultPeriodAnchor(periodSelect.value, now()) }; updatePeriodUi(); refreshAll({ push: true });
  });
  customApply?.addEventListener('click', () => {
    const startDate = customStart?.value; const endDate = customEnd?.value;
    const valid = validIsoDate(startDate) && validIsoDate(endDate) && startDate <= endDate;
    customEnd?.setCustomValidity?.(valid ? '' : 'Choose an end date on or after the start date.');
    if (!valid) { customEnd?.reportValidity?.(); return; }
    period = { period: 'custom', startDate, endDate }; updatePeriodUi(); refreshAll({ push: true });
  });
  periodSteps.forEach((button) => button.addEventListener('click', () => { period = stepPeriod(period, button.dataset.mapPeriodStep); updatePeriodUi(); refreshAll({ push: true }); }));
  loadMore?.addEventListener('click', () => void refreshList({ append: true }));
  launchToggle?.addEventListener('click', () => {
    launchLayerVisible = !launchLayerVisible;
    launchToggle.setAttribute('aria-pressed', String(launchLayerVisible));
    setLaunchLayerVisibility(map, launchLayerVisible); syncUrl({ push: true });
    if (launchLayerVisible) void refreshLaunches();
  });
  launchPanelClose?.addEventListener('click', () => clearLaunchSelection({ sync: true, push: true }));
  launchPanelFilter?.addEventListener('click', () => {
    if (!selectedLaunchId) return;
    launchFilter = String(selectedLaunchId); syncUrl({ push: true });
    if (selectedLaunchDetail) launchSelector?.setSelection({ type: 'launch', launch: selectedLaunchDetail });
    void refreshTracks(); void refreshList(); void refreshPersonalHistory();
    if (selectedFlightId) void revalidateSelectedFlight();
  });

  const handlePopState = () => {
    urlState = new URLSearchParams(locationRef?.search ?? '');
    currentPath = locationRef?.pathname ?? currentPath;
    if (scope) {
      scope.value = currentPath === '/global' ? 'all' : 'following';
      scope.dispatchEvent?.(new Event('styled-select-sync'));
    }
    period = periodStateFromSearch(locationRef?.search ?? '', now(), root.dataset.initialPeriod);
    const nextLaunch = urlState.get('launch');
    launchFilter = nextLaunch === 'unknown' || (Number.isSafeInteger(Number(nextLaunch)) && Number(nextLaunch) > 0) ? nextLaunch : null;
    launchFilterDetailAbort?.abort(); launchFilterDetailAbort = null;
    if (launchFilter === 'unknown') launchSelector?.setSelection({ type: 'unknown' });
    else if (!launchFilter) launchSelector?.setSelection({ type: 'all' });
    else { launchSelector?.setSelection({ type: 'all' }); void hydrateLaunchFilter(); }
    geography = urlState.get('geography') === 'map-area' ? 'map-area' : 'global';
    const nextSort = urlState.get('sort'); if (sort && SORTS.has(nextSort)) { sort.value = nextSort; sort.dispatchEvent?.(new Event('styled-select-sync')); }
    geographyButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mapGeography === geography)));
    launchLayerVisible = launchLayerVisibleFromSearch(locationRef?.search ?? '');
    launchToggle?.setAttribute('aria-pressed', String(launchLayerVisible)); setLaunchLayerVisibility(map, launchLayerVisible);
    selectedLaunchId = selectedLaunchIdFromSearch(locationRef?.search ?? '');
    const flightValue = urlState.get('selectedFlight');
    selectedFlightId = selectedLaunchId ? null : (/^[0-9a-f-]{36}$/i.test(flightValue ?? '') ? flightValue : null);
    if (!selectedLaunchId) clearLaunchSelection();
    const viewport = mapViewportFromSearch(locationRef?.search ?? '');
    if (viewport) map.jumpTo?.({ center: viewport.center, zoom: viewport.zoom });
    updatePeriodUi();
    void refreshTracks(); void refreshPersonalHistory(); if (launchLayerVisible) void refreshLaunches();
    if (selectedLaunchId) void selectLaunch(selectedLaunchId, { push: false });
    else if (selectedFlightId) void (async () => { await refreshList(); await revalidateSelectedFlight({ restore: true }); })();
    else { clearFlightSelection(); void refreshList(); }
  };
  globalThis.addEventListener?.('popstate', handlePopState);

  map.once?.('error', () => show(mapStatus, 'Map unavailable. Check your connection and try again.'));
  map.once?.('load', () => {
    installFlightTrackLayers(map); installLaunchLayers(map, { visible: launchLayerVisible }); updatePeriodUi();
    sort?.dispatchEvent?.(new Event('styled-select-sync')); syncUrl();
    if (launchToggle) launchToggle.setAttribute('aria-pressed', String(launchLayerVisible));
    void refreshTracks(); void refreshLaunches(); void refreshPersonalHistory();
    if (selectedLaunchId) void selectLaunch(selectedLaunchId, { push: false });
    else void (async () => { await refreshList(); if (selectedFlightId) await revalidateSelectedFlight({ restore: true }); })();
    map.on?.('mouseenter', FLIGHT_TRACK_HIT_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on?.('mouseleave', FLIGHT_TRACK_HIT_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
    map.on?.('click', FLIGHT_TRACK_HIT_LAYER_ID, (event) => {
      const id = String(event.features?.[0]?.properties?.flightId ?? '');
      const track = tracks.find((item) => item.id === id); const flight = flights.get(id) ?? track;
      if (flight) applySelection(flight);
    });
    map.on?.('mouseenter', LAUNCH_MARKER_LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on?.('mouseleave', LAUNCH_MARKER_LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
    map.on?.('click', LAUNCH_MARKER_LAYER_ID, (event) => {
      const launchId = Number(event.features?.[0]?.properties?.launchId);
      if (Number.isSafeInteger(launchId) && launchId > 0) void selectLaunch(launchId);
    });
    map.on?.('click', LAUNCH_CLUSTER_LAYER_ID, async (event) => {
      const feature = event.features?.[0]; const clusterId = Number(feature?.properties?.cluster_id);
      const coordinates = feature?.geometry?.coordinates;
      const source = map.getSource?.(LAUNCH_SOURCE_ID);
      if (!Number.isSafeInteger(clusterId) || !Array.isArray(coordinates) || !source?.getClusterExpansionZoom) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo?.({ center: coordinates, zoom });
    });
  });
  map.on?.('moveend', (event) => {
    if (isMapReplayCameraMoveEvent(event)) return;
    syncUrl(); void refreshTracks(); void refreshLaunches(); launchSelector?.refreshViewport();
    if (geography === 'map-area') { void refreshPersonalHistory(); void (async () => { await refreshList(); if (selectedFlightId) await revalidateSelectedFlight(); })(); }
  });
  updatePeriodUi();
  return { map, refreshTracks, refreshList, refreshLaunches, selectFlight: applySelection, selectLaunch, destroy() { trackAbort?.abort(); listAbort?.abort(); launchAbort?.abort(); launchDetailAbort?.abort(); launchFilterDetailAbort?.abort(); selectionAbort?.abort(); launchSelector?.destroy(); personalHistory?.destroy(); replayControls.destroy(); globalThis.removeEventListener?.('popstate', handlePopState); map.remove?.(); } };
}
