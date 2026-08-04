import { initializeGroupMapController } from '../groupMapController.js';

function formatDistance(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : '—';
}

function formatDuration(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const seconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

function initials(value) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? `${words[0][0]}${words.at(-1)[0]}`.toUpperCase() : (words[0]?.slice(0, 2).toUpperCase() || 'P');
}

function setInviteResultsState(search, results, open) {
  results.hidden = !open;
  search.setAttribute('aria-expanded', String(open));
  if (!open) search.removeAttribute('aria-activedescendant');
}

export function initializeGroupInviteSearch(documentRef = document, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const form = documentRef.querySelector('[data-group-invite-form]');
  const search = form?.querySelector('[data-group-invite-search]');
  const userId = form?.querySelector('[data-group-invite-user-id]');
  const results = form?.querySelector('[data-group-invite-results]');
  const status = form?.querySelector('[data-group-invite-status]');
  if (!form || !search || !userId || !results || !fetchImpl) return;
  let timer;
  let controller;
  let request = 0;

  function cancelPendingSearch() {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    request += 1;
  }

  function options() { return [...results.querySelectorAll('[role="option"]')]; }
  function choose(button, pilot) {
    cancelPendingSearch();
    search.value = pilot.displayName;
    userId.value = pilot.userId;
    search.setCustomValidity('');
    if (status) status.textContent = `${pilot.displayName} selected.`;
    setInviteResultsState(search, results, false);
    search.focus();
  }
  function moveOption(current, direction) {
    const items = options();
    const index = items.indexOf(current);
    const next = items[(index + direction + items.length) % items.length];
    if (!next) return;
    for (const item of items) item.setAttribute('aria-selected', String(item === next));
    search.setAttribute('aria-activedescendant', next.id);
    next.focus();
  }

  async function searchPilots(query) {
    timer = undefined;
    controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const current = ++request;
    const url = new URL(form.dataset.searchHref, globalThis.location?.origin ?? 'http://localhost');
    url.searchParams.set('q', query);
    try {
      const response = await fetchImpl(url.pathname + url.search, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: controller?.signal });
      if (current !== request || !response.ok) return;
      const pilots = await response.json();
      if (current !== request) return;
      results.replaceChildren(...pilots.map((pilot, index) => {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.id = `group-invite-option-${index}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        button.textContent = pilot.displayName;
        button.addEventListener('click', () => choose(button, pilot));
        button.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveOption(button, event.key === 'ArrowDown' ? 1 : -1); }
          if (event.key === 'Escape') { event.preventDefault(); cancelPendingSearch(); setInviteResultsState(search, results, false); search.focus(); }
        });
        return button;
      }));
      setInviteResultsState(search, results, pilots.length > 0);
      if (status) status.textContent = pilots.length ? `${pilots.length} pilots found.` : 'No matching pilots found.';
    } catch (error) {
      if (error?.name === 'AbortError' || current !== request) return;
      setInviteResultsState(search, results, false);
      if (status) status.textContent = 'Pilot search is temporarily unavailable.';
    } finally {
      if (current === request) controller = undefined;
    }
  }

  search.addEventListener('input', () => {
    cancelPendingSearch();
    userId.value = '';
    search.setCustomValidity('');
    if (status) status.textContent = '';
    const query = search.value.trim();
    if (query.length < 2) { results.replaceChildren(); setInviteResultsState(search, results, false); return; }
    timer = setTimeout(() => void searchPilots(query), 200);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { cancelPendingSearch(); setInviteResultsState(search, results, false); return; }
    if (event.key !== 'ArrowDown' || results.hidden) return;
    const first = options()[0];
    if (!first) return;
    event.preventDefault();
    first.setAttribute('aria-selected', 'true');
    search.setAttribute('aria-activedescendant', first.id);
    first.focus();
  });
  form.addEventListener('submit', (event) => {
    if (userId.value) return;
    event.preventDefault();
    search.setCustomValidity('Select a pilot from the search results.');
    search.reportValidity();
  });
}

export function initializeStandingsLoadMore(documentRef = document, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const link = documentRef.querySelector('[data-group-standings-load-more]');
  const body = documentRef.querySelector('.group-standings tbody');
  if (!link || !body || !fetchImpl) return;
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    const response = await fetchImpl(link.href, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const page = await response.json();
    const selectedPilotId = new URL(globalThis.location?.href ?? link.href, 'http://localhost').searchParams.get('pilot');
    const existingRows = new Map([...body.querySelectorAll('[data-group-standing-user-id]')]
      .map((row) => [row.dataset.groupStandingUserId, row]));
    let nextRow = null;
    for (const standing of [...page.standings].reverse()) {
      const existingRow = existingRows.get(standing.userId);
      if (existingRow) {
        nextRow = existingRow;
        continue;
      }
      const row = body.insertRow();
      row.dataset.groupStandingUserId = standing.userId;
      row.classList.toggle('is-selected', standing.userId === selectedPilotId);
      row.insertCell().textContent = standing.rank ?? 'Not ranked yet';
      const pilotCell = row.insertCell();
      const anchor = documentRef.createElement('a');
      anchor.className = 'group-pilot';
      anchor.dataset.groupPilotFilter = '';
      anchor.dataset.groupPilotId = standing.userId;
      const pilotUrl = new URL(globalThis.location.href);
      pilotUrl.searchParams.set('pilot', standing.userId);
      anchor.href = `${pilotUrl.pathname}${pilotUrl.search}`;
      const avatar = documentRef.createElement('span');
      avatar.className = 'group-pilot-avatar group-pilot-avatar--standing';
      avatar.style.setProperty('--pilot-color', standing.territoryColor);
      avatar.textContent = initials(standing.displayName);
      const name = documentRef.createElement('span'); name.textContent = standing.displayName;
      anchor.append(avatar, name); pilotCell.append(anchor);
      row.insertCell().textContent = String(standing.claimedCellCount);
      row.insertCell().textContent = `${formatDistance(standing.bestFivePointDistanceMeters)}${standing.trophy ? ' 🏆' : ''}`;
      if (nextRow) body.insertBefore(row, nextRow);
      nextRow = row;
      existingRows.set(standing.userId, row);
    }
    if (page.nextOffset === null) link.remove();
    else { const url = new URL(link.href); url.searchParams.set('offset', String(page.nextOffset)); link.href = url.toString(); }
  });
}

function createMetric(documentRef, value, label) {
  const wrapper = documentRef.createElement('span');
  const strong = documentRef.createElement('b'); strong.textContent = value;
  const small = documentRef.createElement('small'); small.textContent = label;
  wrapper.append(strong, small);
  return wrapper;
}

function createFlightRow(documentRef, flight, mapElement, trackReady) {
  const article = documentRef.createElement('article');
  article.className = 'group-flight-row';
  article.dataset.groupFlightRow = '';
  article.dataset.groupFlightId = flight.flightId;
  const detailHref = `/flights/${encodeURIComponent(flight.flightId)}`;
  const preview = documentRef.createElement('a'); preview.className = 'group-flight-thumbnail'; preview.href = detailHref; preview.setAttribute('aria-label', `View ${flight.pilotName} flight`);
  const picture = documentRef.createElement('picture');
  const source = documentRef.createElement('source'); source.media = '(max-width: 767px)'; source.srcset = flight.thumbnail?.squareUrl ?? '/flight-thumbnail-fallback.webp'; source.type = 'image/webp';
  const image = documentRef.createElement('img'); image.dataset.flightThumbnail = ''; image.src = flight.thumbnail?.wideUrl ?? '/flight-thumbnail-fallback.webp'; image.alt = ''; image.loading = 'lazy'; image.width = 160; image.height = 90;
  picture.append(source, image); preview.append(picture);
  const pilot = documentRef.createElement('div'); pilot.className = 'group-flight-pilot';
  const avatar = documentRef.createElement('span'); avatar.className = 'group-pilot-avatar';
  let colors = {}; try { colors = JSON.parse(mapElement.dataset.groupPilotColors || '{}'); } catch { colors = {}; }
  avatar.style.setProperty('--pilot-color', colors[flight.pilotUserId] ?? '#1769AA'); avatar.textContent = initials(flight.pilotName);
  const pilotCopy = documentRef.createElement('div');
  const name = documentRef.createElement('strong'); name.textContent = flight.pilotName;
  const time = documentRef.createElement('small');
  try { time.textContent = new Date(flight.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: flight.launchTimezone || 'UTC' }); }
  catch { time.textContent = new Date(flight.startedAt).toLocaleString(); }
  pilotCopy.append(name, time); pilot.append(avatar, pilotCopy);
  const actions = documentRef.createElement('div'); actions.className = 'group-flight-actions';
  const track = documentRef.createElement('button'); track.type = 'button'; track.className = 'group-track-link'; track.dataset.groupFlightTrack = ''; track.dataset.groupFlightId = flight.flightId; track.textContent = 'Show track'; track.setAttribute('aria-pressed', 'false'); track.disabled = !trackReady;
  const detail = documentRef.createElement('a'); detail.href = detailHref; detail.textContent = 'View'; detail.setAttribute('aria-label', `View ${flight.pilotName} flight`);
  actions.append(track, detail);
  article.append(preview, pilot, createMetric(documentRef, formatDistance(flight.fivePointDistanceMeters), '5-point'), createMetric(documentRef, formatDuration(flight.durationSeconds), 'Duration'), actions);
  return article;
}

export function initializeFlightsLoadMore(documentRef = document, options = {}, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  const link = documentRef.querySelector('[data-group-flights-load-more]');
  const list = documentRef.querySelector('.group-flights-list');
  const mapElement = documentRef.querySelector('[data-group-map]');
  if (!link || !list || !mapElement || !fetchImpl) return;
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    const response = await fetchImpl(link.href, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const page = await response.json();
    for (const flight of page.flights) list.append(createFlightRow(documentRef, flight, mapElement, Boolean(options.trackReady?.())));
    options.onRowsAdded?.();
    if (!page.nextCursor) link.remove();
    else { const url = new URL(link.href); url.searchParams.set('cursor', page.nextCursor); link.href = url.toString(); }
  });
}

function initializeTrackControls(documentRef, page, emptyState) {
  let controller = null;
  function updateSelection(flightId) {
    for (const row of documentRef.querySelectorAll('[data-group-flight-row]')) row.classList.toggle('is-selected', row.dataset.groupFlightId === flightId);
    for (const button of documentRef.querySelectorAll('[data-group-flight-track]')) {
      const selected = button.dataset.groupFlightId === flightId;
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = selected ? 'Track shown on map' : 'Show track';
    }
  }
  function refresh() { for (const button of documentRef.querySelectorAll('[data-group-flight-track]')) button.disabled = !controller; }
  documentRef.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-group-flight-track]');
    if (!button) return;
    event.preventDefault();
    if (!controller) { if (emptyState) emptyState.hidden = false; return; }
    void controller.selectFlight(button.dataset.groupFlightId).catch(() => { if (emptyState) emptyState.hidden = false; });
  });
  return {
    updateSelection,
    refresh,
    ready: () => Boolean(controller),
    setController(value) {
      controller = value;
      refresh();
      const initialFlightId = page.dataset.selectedFlightId;
      if (initialFlightId) void controller.selectFlight(initialFlightId).catch(() => { if (emptyState) emptyState.hidden = false; });
    },
  };
}

export function initializeGroupPage(documentRef = document) {
  const page = documentRef.querySelector('[data-group-page]');
  const mapElement = documentRef.querySelector('[data-group-map]');
  if (!page || !mapElement) return;
  const empty = documentRef.querySelector('[data-group-map-empty]');
  const trackControls = initializeTrackControls(documentRef, page, empty);
  initializeFlightsLoadMore(documentRef, { trackReady: trackControls.ready, onRowsAdded: trackControls.refresh });
  const style = page.dataset.mapStyleUrl;
  if (!globalThis.maplibregl || !style) { if (empty) empty.hidden = false; return; }
  mapElement.dataset.territoryTileMinimumZoom = page.dataset.territoryTileMinimumZoom;
  mapElement.dataset.territoryTileMaximumZoom = page.dataset.territoryTileMaximumZoom;
  const map = new globalThis.maplibregl.Map({ container: mapElement, style, center: [0, 20], zoom: 1.4, attributionControl: true });
  map.addControl(new globalThis.maplibregl.NavigationControl(), 'bottom-right');
  let mapReady = false;
  map.on('load', () => {
    mapReady = true;
    if (empty) empty.hidden = true;
    const controller = initializeGroupMapController({
      map,
      mapElement,
      documentRef,
      enablePilotControls: false,
      enableFlightControls: false,
      tileUrl: () => mapElement.dataset.tileUrl,
      onFlightTrackChange: trackControls.updateSelection,
    });
    trackControls.setController(controller);
  });
  map.on('error', () => { if (!mapReady && empty) empty.hidden = false; });
}

if (typeof document !== 'undefined') initializeGroupPage();
if (typeof document !== 'undefined') initializeGroupInviteSearch();
if (typeof document !== 'undefined') initializeStandingsLoadMore();
