import {
  createCompetitionColorRegistry,
  loadCompetitionTerritory,
  setCompetitionTerritoryVisibility,
} from './competitionMap.js';
import {
  renderCompetitionLeaderboard,
  renderCompetitionStats,
  resetCompetitionResults,
} from './competitionResultsView.js';
import {
  ALL_TIME_COMPETITION_PERIOD,
  initializeCompetitionPeriodControl,
} from './competitionPeriod.js';
import { createLatestRequest } from './latestRequest.js';
import { competitionLeaderboardUrl } from './viewportQuery.js';

export function initializeGlobalDashboard({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  locationRef = typeof window === 'undefined' ? { pathname: '', search: '' } : window.location,
  historyRef = typeof window === 'undefined' ? undefined : window.history,
  now = () => new Date(),
} = {}) {
  const mapElement = documentRef.querySelector('[data-dashboard-map]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const leaderboardCard = documentRef.querySelector('[data-competition-leaderboard]');
  const leaderboardStatus = documentRef.querySelector('[data-leaderboard-status]');
  const leaderboardList = documentRef.querySelector('[data-leaderboard-list]');
  const currentPilotResult = documentRef.querySelector('[data-current-pilot-result]');
  const competitionStatsCard = documentRef.querySelector('[data-competition-stats]');

  function showStatus(message) {
    if (!emptyState) return;
    emptyState.textContent = message;
    emptyState.hidden = false;
  }

  function clearStatus() {
    if (emptyState) emptyState.hidden = true;
  }

  if (!mapElement || !maplibre) {
    if (mapElement) showStatus('Map unavailable. Check your connection and try again.');
    return;
  }

  const colorRegistry = createCompetitionColorRegistry(
    mapElement.dataset.currentUserId,
    mapElement.dataset.territoryColor,
  );
  let map;
  let mapReady = false;
  let loadedPeriod;

  const leaderboardRequest = createLatestRequest(async ({ signal, isCurrent }) => {
    if (
      !map?.getBounds
      || loadedPeriod !== periodControl.period
      || !leaderboardCard
      || !leaderboardStatus
      || !leaderboardList
      || !currentPilotResult
    ) return;

    leaderboardCard.setAttribute('aria-busy', 'true');
    competitionStatsCard?.setAttribute('aria-busy', 'true');
    leaderboardStatus.textContent = 'Updating leaderboard…';
    try {
      const response = await fetchImpl(competitionLeaderboardUrl(
        map.getBounds(),
        periodControl.month,
      ), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`Competition leaderboard request failed with ${response.status}.`);
      const leaderboard = await response.json();
      if (!isCurrent() || loadedPeriod !== periodControl.period) return;
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
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) {
        leaderboardStatus.textContent = 'Unable to update the leaderboard. Try moving the map again.';
      }
    } finally {
      if (isCurrent()) {
        leaderboardCard.removeAttribute('aria-busy');
        competitionStatsCard?.removeAttribute('aria-busy');
      }
    }
  });

  const territoryRequest = createLatestRequest(async ({ signal, isCurrent }) => {
    leaderboardRequest.cancel();
    loadedPeriod = undefined;
    resetCompetitionResults(documentRef);
    leaderboardCard?.setAttribute('aria-busy', 'true');
    competitionStatsCard?.setAttribute('aria-busy', 'true');
    clearStatus();
    setCompetitionTerritoryVisibility(map, false);
    try {
      const geojson = await loadCompetitionTerritory(map, {
        currentUserId: mapElement.dataset.currentUserId,
        territoryColor: mapElement.dataset.territoryColor,
        month: periodControl.month,
        fetchImpl,
        signal,
        colorRegistry,
      });
      if (!isCurrent()) return;
      loadedPeriod = periodControl.period;
      setCompetitionTerritoryVisibility(map, true);
      if (geojson.features.length === 0) {
        showStatus(periodControl.period === ALL_TIME_COMPETITION_PERIOD
          ? 'No competition territory has been claimed.'
          : 'No competition territory claimed this month.');
      }
      await leaderboardRequest.run();
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) {
        showStatus('Unable to load competition territory. Try again.');
        leaderboardCard?.removeAttribute('aria-busy');
        competitionStatsCard?.removeAttribute('aria-busy');
      }
    }
  });

  const periodControl = initializeCompetitionPeriodControl({
    documentRef,
    locationRef,
    historyRef,
    now,
    onChange: async () => {
      if (mapReady) await territoryRequest.run();
    },
  });

  try {
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: [-106.2, 39.2],
      zoom: 7,
    });
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.once('error', () => showStatus('Map unavailable. Check your connection and try again.'));
    map.once('load', async () => {
      mapReady = true;
      await territoryRequest.run();
    });
    map.on?.('moveend', () => {
      if (loadedPeriod === periodControl.period) void leaderboardRequest.run();
    });
  } catch {
    showStatus('Map unavailable. Check your connection and try again.');
  }
}
