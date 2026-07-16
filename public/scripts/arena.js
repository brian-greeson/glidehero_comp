import { initializeOnboarding } from './onboarding.js';
import { initializeArenaSearch } from './arenaSearch.js';
import {
  colorCompetitionTerritory,
  createCompetitionColorRegistry,
  formatBrowserLocalDate,
  formatBrowserLocalMonth,
  formatBrowserLocalMonthLabel,
  initializeMobileSheet,
  renderCompetitionLeaderboard,
  renderCompetitionStats,
} from './dashboard.js';
import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';

export const ARENA_BOUNDARY_SOURCE_ID = 'arena-boundary';
export const ARENA_BOUNDARY_LAYER_ID = 'arena-boundary-outline';
export const ARENA_TERRITORY_SOURCE_ID = 'arena-competition-territory';
export const ARENA_TERRITORY_FILL_LAYER_ID = 'arena-competition-territory-fill';
export const ARENA_TERRITORY_OUTLINE_LAYER_ID = 'arena-competition-territory-outline';

const COMPETITION_COLOR_EXPRESSION = ['get', 'displayColor'];

export function arenaBoundaryUrl(sourceId) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/boundary`;
}

export function arenaTerritoryUrl(sourceId, date = new Date()) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/competition-territory?date=${encodeURIComponent(formatBrowserLocalDate(date))}`;
}

export function arenaLeaderboardUrl(sourceId, date = new Date()) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/competition-leaderboard?month=${encodeURIComponent(formatBrowserLocalMonth(date))}`;
}

async function jsonRequest(url, accept, fetchImpl) {
  const response = await fetchImpl(url, { credentials: 'same-origin', headers: { accept } });
  if (!response.ok) throw new Error(`Arena request failed with ${response.status}.`);
  return response.json();
}

function initializeAccountAndUpload(documentRef) {
  const accountTrigger = documentRef.querySelector('[data-account-trigger]');
  const accountPopover = documentRef.querySelector('[data-account-popover]');
  if (accountTrigger && accountPopover) {
    accountTrigger.addEventListener('click', () => {
      const open = accountPopover.hidden;
      accountPopover.hidden = !open;
      accountTrigger.setAttribute('aria-expanded', String(open));
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

export function initializeArena({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  date = new Date(),
} = {}) {
  initializeOnboarding({ documentRef });
  initializeMobileSheet({ documentRef });
  initializeArenaSearch({ documentRef, fetchImpl });
  initializeAccountAndUpload(documentRef);

  const mapElement = documentRef.querySelector('[data-arena-map]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const leaderboardCard = documentRef.querySelector('[data-competition-leaderboard]');
  const leaderboardStatus = documentRef.querySelector('[data-leaderboard-status]');
  const leaderboardList = documentRef.querySelector('[data-leaderboard-list]');
  const currentPilotResult = documentRef.querySelector('[data-current-pilot-result]');
  const competitionStatsCard = documentRef.querySelector('[data-competition-stats]');
  const month = documentRef.querySelector('[data-competition-month]');
  if (month) month.textContent = formatBrowserLocalMonthLabel(date);
  if (!mapElement || !maplibre) {
    if (emptyState) {
      emptyState.textContent = 'Map unavailable. Check your connection and try again.';
      emptyState.hidden = false;
    }
    return;
  }

  const sourceId = mapElement.dataset.arenaSourceId;
  const colorRegistry = createCompetitionColorRegistry(
    mapElement.dataset.currentUserId,
    mapElement.dataset.territoryColor,
  );

  try {
    const map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: [-106.2, 39.2],
      zoom: 7,
    });
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.once('error', () => {
      if (emptyState) {
        emptyState.textContent = 'Map unavailable. Check your connection and try again.';
        emptyState.hidden = false;
      }
    });
    map.once('load', async () => {
      try {
        const [boundary, territory, leaderboard] = await Promise.all([
          jsonRequest(arenaBoundaryUrl(sourceId), 'application/geo+json', fetchImpl),
          jsonRequest(arenaTerritoryUrl(sourceId, date), 'application/geo+json', fetchImpl),
          jsonRequest(arenaLeaderboardUrl(sourceId, date), 'application/json', fetchImpl),
        ]);

        map.addSource(ARENA_BOUNDARY_SOURCE_ID, { type: 'geojson', data: boundary });
        const coloredTerritory = colorCompetitionTerritory(
          territory,
          mapElement.dataset.currentUserId,
          mapElement.dataset.territoryColor,
          Math.random,
          colorRegistry,
        );
        map.addSource(ARENA_TERRITORY_SOURCE_ID, { type: 'geojson', data: coloredTerritory });
        map.addLayer(createTerritoryFillLayer({
          id: ARENA_TERRITORY_FILL_LAYER_ID,
          source: ARENA_TERRITORY_SOURCE_ID,
          color: COMPETITION_COLOR_EXPRESSION,
        }));
        map.addLayer(createTerritoryBoundaryLayer({
          id: ARENA_TERRITORY_OUTLINE_LAYER_ID,
          source: ARENA_TERRITORY_SOURCE_ID,
          color: COMPETITION_COLOR_EXPRESSION,
        }));
        map.addLayer({
          id: ARENA_BOUNDARY_LAYER_ID,
          type: 'line',
          source: ARENA_BOUNDARY_SOURCE_ID,
          paint: { 'line-color': '#0f172a', 'line-width': 3, 'line-opacity': 0.9 },
        });
        map.fitBounds(
          [[boundary.bbox[0], boundary.bbox[1]], [boundary.bbox[2], boundary.bbox[3]]],
          { padding: 60, duration: 0 },
        );
        renderCompetitionLeaderboard({
          documentRef,
          leaderboard,
          currentUserId: mapElement.dataset.currentUserId,
          colorRegistry,
          statusElement: leaderboardStatus,
          listElement: leaderboardList,
          currentPilotElement: currentPilotResult,
        });
        renderCompetitionStats({ documentRef, stats: leaderboard.stats });
        leaderboardCard?.removeAttribute('aria-busy');
        competitionStatsCard?.removeAttribute('aria-busy');
        if (coloredTerritory.features.length === 0 && emptyState) {
          emptyState.textContent = 'No competition territory claimed in this Arena this month.';
          emptyState.hidden = false;
        }
      } catch {
        if (leaderboardStatus) leaderboardStatus.textContent = 'Unable to load this Arena.';
        leaderboardCard?.removeAttribute('aria-busy');
        competitionStatsCard?.removeAttribute('aria-busy');
        if (emptyState) {
          emptyState.textContent = 'Unable to load this Arena. Try again.';
          emptyState.hidden = false;
        }
      }
    });
  } catch {
    if (emptyState) {
      emptyState.textContent = 'Map unavailable. Check your connection and try again.';
      emptyState.hidden = false;
    }
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-arena-dashboard]')) initializeArena();
  }, { once: true });
}
