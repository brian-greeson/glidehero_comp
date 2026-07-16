import { initializeArenaSearch } from './arenaSearch.js';
import { createCompetitionColorRegistry } from './competitionMap.js';
import { initializeCompetitionPeriodControl } from './competitionPeriod.js';
import { createLatestRequest } from './latestRequest.js';
import { initializeMobileSheet } from './mobileSheet.js';
import {
  arenaCoverageLeaderboardUrl,
  coverageCellClaimantsUrl,
  coverageTerritoryUrl,
  globalCoverageLeaderboardUrl,
} from './coveragePlaytestApi.js';
import { renderCoverageLeaderboard } from './coveragePlaytestLeaderboard.js';
import { colorCoverageTerritory, COVERAGE_FILL_LAYER_ID, setCoverageData } from './coveragePlaytestMap.js';

async function jsonRequest(url, fetchImpl, signal) {
  const response = await fetchImpl(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`Coverage request failed with ${response.status}.`);
  return response.json();
}

export function initializeCoveragePlaytest({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  locationRef = window.location,
  historyRef = window.history,
  now = () => new Date(),
} = {}) {
  initializeMobileSheet({ documentRef });
  initializeArenaSearch({ documentRef, fetchImpl, locationRef, pathPrefix: '/playtest/coverage' });
  const root = documentRef.querySelector('[data-coverage-playtest]');
  const mapElement = documentRef.querySelector('[data-coverage-map]');
  const card = documentRef.querySelector('[data-coverage-leaderboard]');
  const overviewButton = documentRef.querySelector('[data-coverage-overview]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const cellPopup = documentRef.querySelector('[data-coverage-cell-popup]');
  if (!root || !mapElement || !maplibre) return;

  const arenaSourceId = mapElement.dataset.arenaSourceId || null;
  const currentUserId = mapElement.dataset.currentUserId;
  const colorRegistry = createCompetitionColorRegistry(currentUserId, mapElement.dataset.territoryColor);
  let map;
  let mapReady = false;
  let selectedPilotId = null;
  let selectedPilotColor = null;
  let leaderboard = { leaders: [], currentPilot: null };

  function setStatus(message = '') {
    if (!emptyState) return;
    emptyState.textContent = message;
    emptyState.hidden = !message;
  }

  const territoryRequest = createLatestRequest(async ({ signal, isCurrent }) => {
    try {
      const territory = await jsonRequest(coverageTerritoryUrl({
        arenaSourceId,
        month: periodControl.month,
        pilotUserId: selectedPilotId,
      }), fetchImpl, signal);
      if (!isCurrent()) return;
      const colored = colorCoverageTerritory(territory, selectedPilotColor, selectedPilotId);
      setCoverageData(map, colored);
      setStatus(colored.features.length === 0 ? 'No coverage for this selection.' : '');
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) setStatus('Unable to load coverage. Try again.');
    }
  });

  function renderLeaderboard() {
    renderCoverageLeaderboard({
      documentRef,
      leaderboard,
      selectedPilotId,
      currentUserId,
      colorRegistry,
      onSelect: (pilot) => {
        selectedPilotId = pilot.userId;
        selectedPilotColor = colorRegistry.colorFor(pilot.userId);
        overviewButton?.setAttribute('aria-pressed', 'false');
        renderLeaderboard();
        void territoryRequest.run();
      },
    });
  }

  const leaderboardRequest = createLatestRequest(async ({ signal, isCurrent }) => {
    if (!map?.getBounds) return;
    card?.setAttribute('aria-busy', 'true');
    const url = arenaSourceId
      ? arenaCoverageLeaderboardUrl(arenaSourceId, periodControl.month)
      : globalCoverageLeaderboardUrl(map.getBounds(), periodControl.month);
    try {
      const next = await jsonRequest(url, fetchImpl, signal);
      if (!isCurrent()) return;
      leaderboard = next;
      const pilots = [...next.leaders, ...(next.currentPilot ? [next.currentPilot] : [])];
      if (selectedPilotId && !pilots.some((pilot) => pilot.userId === selectedPilotId && pilot.claimedCellCount > 0)) {
        selectedPilotId = null;
        selectedPilotColor = null;
        overviewButton?.setAttribute('aria-pressed', 'true');
        await territoryRequest.run();
      }
      renderLeaderboard();
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) {
        const status = documentRef.querySelector('[data-coverage-status]');
        if (status) status.textContent = 'Unable to update coverage rankings.';
      }
    } finally {
      if (isCurrent()) card?.removeAttribute('aria-busy');
    }
  });

  async function refreshPeriod() {
    selectedPilotId = null;
    selectedPilotColor = null;
    overviewButton?.setAttribute('aria-pressed', 'true');
    if (cellPopup) cellPopup.hidden = true;
    await Promise.all([leaderboardRequest.run(), territoryRequest.run()]);
  }

  const periodControl = initializeCompetitionPeriodControl({
    documentRef, locationRef, historyRef, now,
    onChange: async () => { if (mapReady) await refreshPeriod(); },
  });

  overviewButton?.addEventListener('click', () => {
    if (!selectedPilotId) return;
    selectedPilotId = null;
    selectedPilotColor = null;
    overviewButton.setAttribute('aria-pressed', 'true');
    renderLeaderboard();
    void territoryRequest.run();
  });

  try {
    map = new maplibre.Map({ container: mapElement, style: mapElement.dataset.mapStyleUrl, center: [-106.2, 39.2], zoom: 7 });
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.once('error', () => setStatus('Map unavailable. Check your connection and try again.'));
    map.once('load', async () => {
      try {
        if (arenaSourceId) {
          const boundary = await jsonRequest(`/v1/arenas/${encodeURIComponent(arenaSourceId)}/boundary`, fetchImpl);
          map.addSource('coverage-arena-boundary', { type: 'geojson', data: boundary });
          map.addLayer({ id: 'coverage-arena-boundary', type: 'line', source: 'coverage-arena-boundary', paint: { 'line-color': '#0f172a', 'line-width': 3 } });
          map.fitBounds([[boundary.bbox[0], boundary.bbox[1]], [boundary.bbox[2], boundary.bbox[3]]], { padding: 60, duration: 0 });
        }
        mapReady = true;
        await refreshPeriod();
      } catch {
        setStatus('Unable to load the coverage playtest. Try again.');
        card?.removeAttribute('aria-busy');
      }
    });
    if (!arenaSourceId) map.on('moveend', () => { if (mapReady) void leaderboardRequest.run(); });
    map.on('click', COVERAGE_FILL_LAYER_ID, async (event) => {
      const properties = event.features?.[0]?.properties;
      if (!properties || !cellPopup) return;
      try {
        const payload = await jsonRequest(coverageCellClaimantsUrl(properties.x, properties.y, periodControl.month), fetchImpl);
        const heading = documentRef.createElement('strong');
        heading.textContent = 'Claimed by';
        const list = documentRef.createElement('ul');
        for (const claimant of payload.claimants) {
          const item = documentRef.createElement('li');
          item.textContent = claimant.displayName;
          list.append(item);
        }
        cellPopup.replaceChildren(heading, list);
        cellPopup.hidden = false;
      } catch { cellPopup.hidden = true; }
    });
  } catch {
    setStatus('Map unavailable. Check your connection and try again.');
  }
}
