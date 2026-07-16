import { initializeOnboarding } from './onboarding.js';
import { initializeArenaSearch } from './arenaSearch.js';
import {
  colorCompetitionTerritory,
  createCompetitionColorRegistry,
  initializeMobileSheet,
  renderCompetitionLeaderboard,
  renderCompetitionStats,
} from './dashboard.js';
import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from './mapStyles.js';
import {
  ALL_TIME_COMPETITION_PERIOD,
  initializeCompetitionPeriodControl,
} from './competitionPeriod.js';

export const ARENA_BOUNDARY_SOURCE_ID = 'arena-boundary';
export const ARENA_BOUNDARY_LAYER_ID = 'arena-boundary-outline';
export const ARENA_TERRITORY_SOURCE_ID = 'arena-competition-territory';
export const ARENA_TERRITORY_FILL_LAYER_ID = 'arena-competition-territory-fill';
export const ARENA_TERRITORY_OUTLINE_LAYER_ID = 'arena-competition-territory-outline';

const COMPETITION_COLOR_EXPRESSION = ['get', 'displayColor'];

export function arenaBoundaryUrl(sourceId) {
  return `/v1/arenas/${encodeURIComponent(sourceId)}/boundary`;
}

export function arenaTerritoryUrl(sourceId, month = null) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return `/v1/arenas/${encodeURIComponent(sourceId)}/competition-territory${query}`;
}

export function arenaLeaderboardUrl(sourceId, month = null) {
  const query = month ? `?month=${encodeURIComponent(month)}` : '';
  return `/v1/arenas/${encodeURIComponent(sourceId)}/competition-leaderboard${query}`;
}

async function jsonRequest(url, accept, fetchImpl, signal) {
  const response = await fetchImpl(url, { credentials: 'same-origin', headers: { accept }, signal });
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
  locationRef = typeof window === 'undefined' ? { pathname: '', search: '' } : window.location,
  historyRef = typeof window === 'undefined' ? undefined : window.history,
  now = () => new Date(),
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
  let map;
  let mapReady = false;
  let requestSequence = 0;
  let abortController;
  const periodControl = initializeCompetitionPeriodControl({
    documentRef,
    locationRef,
    historyRef,
    now,
    onChange: async () => {
      if (mapReady) await refreshCompetition();
    },
  });

  async function refreshCompetition() {
    if (!map) return;
    abortController?.abort();
    abortController = typeof AbortController === 'undefined' ? undefined : new AbortController();
    const activeRequest = ++requestSequence;
    if (map.getLayer?.(ARENA_TERRITORY_FILL_LAYER_ID)) {
      map.setLayoutProperty(ARENA_TERRITORY_FILL_LAYER_ID, 'visibility', 'none');
      map.setLayoutProperty(ARENA_TERRITORY_OUTLINE_LAYER_ID, 'visibility', 'none');
    }
    leaderboardList?.replaceChildren();
    if (currentPilotResult) currentPilotResult.hidden = true;
    for (const selector of [
      '[data-competition-claimed-area]',
      '[data-competition-flights]',
      '[data-competition-pilots]',
      '[data-competition-my-flights]',
    ]) {
      const value = documentRef.querySelector(selector);
      if (value) value.textContent = '-';
    }
    leaderboardCard?.setAttribute('aria-busy', 'true');
    competitionStatsCard?.setAttribute('aria-busy', 'true');
    if (leaderboardStatus) leaderboardStatus.textContent = 'Updating leaderboard…';
    try {
      const [territory, leaderboard] = await Promise.all([
        jsonRequest(
          arenaTerritoryUrl(sourceId, periodControl.month),
          'application/geo+json',
          fetchImpl,
          abortController?.signal,
        ),
        jsonRequest(
          arenaLeaderboardUrl(sourceId, periodControl.month),
          'application/json',
          fetchImpl,
          abortController?.signal,
        ),
      ]);
      if (activeRequest !== requestSequence) return;
      const coloredTerritory = colorCompetitionTerritory(
        territory,
        mapElement.dataset.currentUserId,
        mapElement.dataset.territoryColor,
        Math.random,
        colorRegistry,
      );
      const territorySource = map.getSource?.(ARENA_TERRITORY_SOURCE_ID);
      if (territorySource?.setData) {
        territorySource.setData(coloredTerritory);
        map.setLayoutProperty(ARENA_TERRITORY_FILL_LAYER_ID, 'visibility', 'visible');
        map.setLayoutProperty(ARENA_TERRITORY_OUTLINE_LAYER_ID, 'visibility', 'visible');
      } else {
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
      }
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
      if (emptyState) {
        emptyState.hidden = coloredTerritory.features.length > 0;
        if (!emptyState.hidden) {
          emptyState.textContent = periodControl.period === ALL_TIME_COMPETITION_PERIOD
            ? 'No competition territory has been claimed in this Arena.'
            : 'No competition territory claimed in this Arena this month.';
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (leaderboardStatus) leaderboardStatus.textContent = 'Unable to load this Arena.';
      if (emptyState) {
        emptyState.textContent = 'Unable to load this Arena. Try again.';
        emptyState.hidden = false;
      }
    } finally {
      if (activeRequest === requestSequence) {
        leaderboardCard?.removeAttribute('aria-busy');
        competitionStatsCard?.removeAttribute('aria-busy');
      }
    }
  }

  try {
    map = new maplibre.Map({
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
        const boundary = await jsonRequest(arenaBoundaryUrl(sourceId), 'application/geo+json', fetchImpl);

        map.addSource(ARENA_BOUNDARY_SOURCE_ID, { type: 'geojson', data: boundary });
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
        mapReady = true;
        await refreshCompetition();
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
