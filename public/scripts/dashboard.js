import { initializeOnboarding } from './onboarding.js';
import { COMPETITION_COLOR_PALETTE } from './competitionColors.js';
import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const PERSONAL_TERRITORY_SOURCE_ID = 'personal-territory';
export const PERSONAL_TERRITORY_FILL_LAYER_ID = 'personal-territory-fill';
export const PERSONAL_TERRITORY_OUTLINE_LAYER_ID = 'personal-territory-outline';
export const COMPETITION_TERRITORY_SOURCE_ID = 'competition-territory';
export const COMPETITION_TERRITORY_FILL_LAYER_ID = 'competition-territory-fill';
export const COMPETITION_TERRITORY_OUTLINE_LAYER_ID = 'competition-territory-outline';

const COMPETITION_COLOR_EXPRESSION = ['get', 'displayColor'];

export function formatBrowserLocalDate(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatBrowserLocalMonth(date = new Date()) {
  return formatBrowserLocalDate(date).slice(0, 7);
}

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
    features: geojson.features.map((feature) => {
      const ownerUserId = feature.properties.ownerUserId;
      const displayColor = colorRegistry.colorFor(ownerUserId);

      return {
        ...feature,
        properties: { ...feature.properties, displayColor },
      };
    }),
  };
}

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

export async function loadCompetitionTerritory(
  map,
  {
    currentUserId,
    territoryColor,
    date = new Date(),
    fetchImpl = fetch,
    random = Math.random,
    colorRegistry = createCompetitionColorRegistry(currentUserId, territoryColor, random),
  },
) {
  const competitionDate = formatBrowserLocalDate(date);
  const response = await fetchImpl(`/v1/competition-territory?date=${encodeURIComponent(competitionDate)}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/geo+json' },
  });
  if (!response.ok) throw new Error(`Competition territory request failed with ${response.status}.`);

  const geojson = colorCompetitionTerritory(
    await response.json(),
    currentUserId,
    territoryColor,
    random,
    colorRegistry,
  );
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
  return geojson;
}

function wrapLongitude(longitude, isEast = false) {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  if (wrapped === -180 && isEast && longitude > 0) return 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function normalizeLeaderboardBounds(bounds) {
  const rawWest = bounds.getWest();
  const rawEast = bounds.getEast();
  if (rawEast - rawWest >= 360) {
    return { west: -180, south: bounds.getSouth(), east: 180, north: bounds.getNorth() };
  }
  return {
    west: wrapLongitude(rawWest),
    south: bounds.getSouth(),
    east: wrapLongitude(rawEast, true),
    north: bounds.getNorth(),
  };
}

export function competitionLeaderboardUrl(bounds, date = new Date()) {
  const normalized = normalizeLeaderboardBounds(bounds);
  const query = new URLSearchParams({
    month: formatBrowserLocalMonth(date),
    west: String(normalized.west),
    south: String(normalized.south),
    east: String(normalized.east),
    north: String(normalized.north),
  });
  return `/v1/competition-leaderboard?${query}`;
}

export function formatClaimedArea(squareMeters, locale) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(squareMeters / 1_000_000)} km²`;
}

function createLeaderboardRow(documentRef, pilot, { currentUserId, colorRegistry }) {
  const row = documentRef.createElement('div');
  row.className = 'leaderboard-row';
  row.setAttribute('role', 'listitem');
  if (pilot.userId === currentUserId) row.classList.add('is-current-pilot');

  const rank = documentRef.createElement('span');
  rank.className = 'leaderboard-rank';
  rank.textContent = pilot.rank === null ? '—' : String(pilot.rank);
  const swatch = documentRef.createElement('span');
  swatch.className = 'leaderboard-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  swatch.style.setProperty('--pilot-color', colorRegistry.colorFor(pilot.userId));
  const name = documentRef.createElement('span');
  name.className = 'leaderboard-name';
  name.textContent = pilot.displayName;
  const area = documentRef.createElement('span');
  area.className = 'leaderboard-area';
  area.textContent = formatClaimedArea(pilot.claimedAreaSquareMeters);
  row.append(rank, swatch, name, area);
  return row;
}

export function renderCompetitionLeaderboard({
  documentRef,
  leaderboard,
  currentUserId,
  colorRegistry,
  statusElement,
  listElement,
  currentPilotElement,
}) {
  listElement.replaceChildren(...leaderboard.leaders.map((pilot) => createLeaderboardRow(
    documentRef,
    pilot,
    { currentUserId, colorRegistry },
  )));
  statusElement.textContent = leaderboard.leaders.length === 0 ? 'No claimed territory in this area.' : '';
  currentPilotElement.replaceChildren();
  currentPilotElement.hidden = leaderboard.currentPilot === null;
  if (leaderboard.currentPilot) {
    const label = documentRef.createElement('p');
    label.className = 'current-pilot-label';
    label.textContent = 'Your position';
    currentPilotElement.append(
      label,
      createLeaderboardRow(documentRef, leaderboard.currentPilot, { currentUserId, colorRegistry }),
    );
  }
}

export function initializeDashboard({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
} = {}) {
  initializeOnboarding({ documentRef });

  const mapElement = documentRef.querySelector('[data-dashboard-map]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const personalMode = documentRef.querySelector('[data-personal-mode]');
  const competitiveMode = documentRef.querySelector('[data-competitive-mode]');
  const leaderboardCard = documentRef.querySelector('[data-competition-leaderboard]');
  const leaderboardStatus = documentRef.querySelector('[data-leaderboard-status]');
  const leaderboardList = documentRef.querySelector('[data-leaderboard-list]');
  const currentPilotResult = documentRef.querySelector('[data-current-pilot-result]');
  let map;
  let mapReady = false;
  let activeMode = 'personal';
  let competitionLoaded = false;
  let competitionLoading = false;
  let competitionIsEmpty = false;
  let leaderboardRequestSequence = 0;
  let leaderboardAbortController;
  const colorRegistry = mapElement
    ? createCompetitionColorRegistry(mapElement.dataset.currentUserId, mapElement.dataset.territoryColor)
    : null;

  function showStatus(message) {
    if (emptyState) {
      emptyState.textContent = message;
      emptyState.hidden = false;
    }
  }

  function clearStatus() {
    if (emptyState) emptyState.hidden = true;
  }

  function showMapUnavailable() {
    showStatus('Map unavailable. Check your connection and try again.');
  }

  function showTerritoryUnavailable() {
    showStatus('Unable to load your territory. Refresh the page.');
  }

  function setTabState(mode) {
    for (const [tab, tabMode] of [[personalMode, 'personal'], [competitiveMode, 'competitive']]) {
      if (!tab) continue;
      const isActive = mode === tabMode;
      tab.classList.toggle('is-active', isActive);
      if (isActive) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    if (leaderboardCard) leaderboardCard.hidden = mode !== 'competitive';
  }

  async function refreshLeaderboard() {
    if (
      activeMode !== 'competitive'
      || !mapReady
      || !competitionLoaded
      || !map?.getBounds
      || !leaderboardCard
      || !leaderboardStatus
      || !leaderboardList
      || !currentPilotResult
      || !colorRegistry
    ) return;

    leaderboardAbortController?.abort();
    leaderboardAbortController = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const requestSequence = ++leaderboardRequestSequence;
    leaderboardCard.setAttribute('aria-busy', 'true');
    leaderboardStatus.textContent = 'Updating leaderboard…';
    try {
      const response = await fetchImpl(competitionLeaderboardUrl(map.getBounds()), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal: leaderboardAbortController?.signal,
      });
      if (!response.ok) throw new Error(`Competition leaderboard request failed with ${response.status}.`);
      const leaderboard = await response.json();
      if (requestSequence !== leaderboardRequestSequence || activeMode !== 'competitive') return;
      renderCompetitionLeaderboard({
        documentRef,
        leaderboard,
        currentUserId: mapElement.dataset.currentUserId,
        colorRegistry,
        statusElement: leaderboardStatus,
        listElement: leaderboardList,
        currentPilotElement: currentPilotResult,
      });
    } catch (error) {
      if (error?.name !== 'AbortError' && requestSequence === leaderboardRequestSequence) {
        leaderboardStatus.textContent = 'Unable to update the leaderboard. Try moving the map again.';
      }
    } finally {
      if (requestSequence === leaderboardRequestSequence) leaderboardCard.removeAttribute('aria-busy');
    }
  }

  function setLayerVisibility(layerIds, visibility) {
    if (!mapReady) return;
    for (const layerId of layerIds) {
      if (!map.getLayer || map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    }
  }

  function applyModeLayers() {
    setLayerVisibility(
      [PERSONAL_TERRITORY_FILL_LAYER_ID, PERSONAL_TERRITORY_OUTLINE_LAYER_ID],
      activeMode === 'personal' ? 'visible' : 'none',
    );
    if (competitionLoaded) {
      setLayerVisibility(
        [COMPETITION_TERRITORY_FILL_LAYER_ID, COMPETITION_TERRITORY_OUTLINE_LAYER_ID],
        activeMode === 'competitive' ? 'visible' : 'none',
      );
    }
  }

  function selectPersonalMode() {
    activeMode = 'personal';
    leaderboardRequestSequence += 1;
    leaderboardAbortController?.abort();
    setTabState(activeMode);
    clearStatus();
    applyModeLayers();
  }

  async function selectCompetitiveMode() {
    activeMode = 'competitive';
    setTabState(activeMode);
    clearStatus();
    applyModeLayers();
    if (!mapReady || competitionLoaded || competitionLoading) {
      if (competitionLoaded && competitionIsEmpty) showStatus('No competition territory claimed this month.');
      if (competitionLoaded) await refreshLeaderboard();
      return;
    }

    competitionLoading = true;
    try {
      const geojson = await loadCompetitionTerritory(map, {
        currentUserId: mapElement.dataset.currentUserId,
        territoryColor: mapElement.dataset.territoryColor,
        fetchImpl,
        colorRegistry,
      });
      competitionLoaded = true;
      competitionIsEmpty = geojson.features.length === 0;
      applyModeLayers();
      if (activeMode === 'competitive' && competitionIsEmpty) {
        showStatus('No competition territory claimed this month.');
      }
      await refreshLeaderboard();
    } catch {
      if (activeMode === 'competitive') showStatus('Unable to load competition territory. Try again.');
    } finally {
      competitionLoading = false;
    }
  }

  setTabState(activeMode);
  personalMode?.addEventListener('click', selectPersonalMode);
  competitiveMode?.addEventListener('click', selectCompetitiveMode);

  if (mapElement && maplibre) {
    try {
      map = new maplibre.Map({
        container: mapElement,
        style: mapElement.dataset.mapStyleUrl,
        center: [-106.2, 39.2],
        zoom: 7,
      });
      map.addControl(new maplibre.NavigationControl(), 'top-right');
      map.once('error', showMapUnavailable);
      map.once('load', async () => {
        try {
          await loadPersonalTerritory(map, mapElement.dataset.territoryColor, fetchImpl);
        } catch {
          showTerritoryUnavailable();
        }
        mapReady = true;
        if (activeMode === 'competitive') await selectCompetitiveMode();
      });
      map.on?.('moveend', () => {
        void refreshLeaderboard();
      });
    } catch {
      showMapUnavailable();
    }
  } else if (mapElement) {
    showMapUnavailable();
  }

  const currentMonth = documentRef.querySelector('[data-current-month]');
  if (currentMonth) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    currentMonth.textContent = `${formatter.format(start)} – ${formatter.format(end)} (Local)`;
  }

  const accountTrigger = documentRef.querySelector('[data-account-trigger]');
  const accountPopover = documentRef.querySelector('[data-account-popover]');
  if (accountTrigger && accountPopover) {
    accountTrigger.addEventListener('click', () => {
      const open = accountPopover.hidden;
      accountPopover.hidden = !open;
      accountTrigger.setAttribute('aria-expanded', String(open));
    });
  }

  const sheetToggle = documentRef.querySelector('[data-sheet-toggle]');
  const sheet = documentRef.querySelector('[data-mobile-sheet]');
  if (sheetToggle && sheet) {
    sheetToggle.addEventListener('click', () => {
      const expanded = sheet.classList.toggle('is-expanded');
      sheetToggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  const uploadForm = documentRef.querySelector('[data-upload-form]');
  const uploadInput = uploadForm?.querySelector('input[type="file"]');
  if (uploadForm && uploadInput) {
    uploadInput.addEventListener('change', () => {
      if (uploadInput.files?.length) uploadForm.requestSubmit();
    });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => initializeDashboard(), { once: true });
}
