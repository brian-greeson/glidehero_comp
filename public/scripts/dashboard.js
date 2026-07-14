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

export function colorCompetitionTerritory(
  geojson,
  currentUserId,
  currentUserColor,
  random = Math.random,
) {
  const ownerColors = new Map([[currentUserId, currentUserColor]]);

  return {
    ...geojson,
    features: geojson.features.map((feature) => {
      const ownerUserId = feature.properties.ownerUserId;
      let displayColor = ownerColors.get(ownerUserId);
      if (!displayColor) {
        const colorIndex = Math.floor(random() * COMPETITION_COLOR_PALETTE.length);
        displayColor = COMPETITION_COLOR_PALETTE[colorIndex] ?? COMPETITION_COLOR_PALETTE[0];
        ownerColors.set(ownerUserId, displayColor);
      }

      return {
        ...feature,
        properties: { ...feature.properties, displayColor },
      };
    }),
  };
}

export async function loadPersonalTerritory(map, territoryColor, fetchImpl = fetch) {
  const response = await fetchImpl('/v1/personal-territory?type=grid', {
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
  { currentUserId, territoryColor, date = new Date(), fetchImpl = fetch, random = Math.random },
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
  let map;
  let mapReady = false;
  let activeMode = 'personal';
  let competitionLoaded = false;
  let competitionLoading = false;
  let competitionIsEmpty = false;

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
      return;
    }

    competitionLoading = true;
    try {
      const geojson = await loadCompetitionTerritory(map, {
        currentUserId: mapElement.dataset.currentUserId,
        territoryColor: mapElement.dataset.territoryColor,
        fetchImpl,
      });
      competitionLoaded = true;
      competitionIsEmpty = geojson.features.length === 0;
      applyModeLayers();
      if (activeMode === 'competitive' && competitionIsEmpty) {
        showStatus('No competition territory claimed this month.');
      }
    } catch {
      if (activeMode === 'competitive') showStatus('Unable to load competition territory. Try again.');
    } finally {
      competitionLoading = false;
    }
  }

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
