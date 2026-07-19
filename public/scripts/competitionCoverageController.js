import { createCompetitionColorRegistry } from './competitionColors.js';
import { initializeCompetitionPeriodControl } from './competitionPeriod.js';
import { createLatestRequest } from './latestRequest.js';
import {
  arenaCoverageLeaderboardUrl,
  coverageCellClaimantsUrl,
  coverageTerritoryUrl,
  globalCoverageLeaderboardUrl,
} from './competitionCoverageApi.js';
import { renderCoverageLeaderboard } from './competitionCoverageLeaderboard.js';
import {
  colorCoverageTerritory,
  coverageCellFeatureAtPoint,
  positionCoverageCellPopup,
  setCoverageData,
} from './competitionCoverageMap.js';
import { initializeMapFlightAids } from './mapFlightAids.js';
import { createViewportTerritoryLoader } from './viewportTerritoryLoader.js';

async function jsonRequest(url, fetchImpl, signal) {
  const response = await fetchImpl(url, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Coverage request failed with ${response.status}.`);
  return response.json();
}

export function initializeCompetitionCoverage({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  locationRef = typeof window === 'undefined' ? { pathname: '', search: '' } : window.location,
  historyRef = typeof window === 'undefined' ? undefined : window.history,
  now = () => new Date(),
  navigatorRef = globalThis.navigator,
  storage,
} = {}) {
  const root = documentRef.querySelector('[data-competition-coverage]');
  const mapElement = documentRef.querySelector('[data-territory-map]');
  const card = documentRef.querySelector('[data-territory-leaderboard]');
  const overviewButton = documentRef.querySelector('[data-territory-allpilots]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const cellPopup = documentRef.querySelector('[data-territory-cell-popup]');
  if (!root || !mapElement || !maplibre) return;

  const arenaSourceId = mapElement.dataset.arenaSourceId || null;
  const currentUserId = mapElement.dataset.currentUserId;
  const colorRegistry = createCompetitionColorRegistry(
    currentUserId,
    mapElement.dataset.territoryColor,
  );
  let map;
  let mapReady = false;
  let selectedPilotId = null;
  let leaderboard = { leaders: [], currentPilot: null };
  let cellPopupRequestId = 0;
  let territoryLoader;

  function hideCellPopup() {
    cellPopupRequestId += 1;
    if (cellPopup) cellPopup.hidden = true;
  }

  function setStatus(message = '') {
    if (!emptyState) return;
    emptyState.textContent = message;
    emptyState.hidden = !message;
  }

  function initializeTerritoryLoader() {
    territoryLoader = createViewportTerritoryLoader({
      map,
      fetchTerritory: (bounds, signal) => jsonRequest(
        coverageTerritoryUrl({
          arenaSourceId,
          bounds,
          month: periodControl.month,
          pilotUserId: selectedPilotId,
        }),
        fetchImpl,
        signal,
      ),
      applyTerritory: (territory) => setCoverageData(map, colorCoverageTerritory(territory, colorRegistry)),
      onVisibleData: (territory) => setStatus(
        territory.features.length === 0 ? 'No coverage for this selection.' : '',
      ),
      onVisibleError: () => setStatus('Unable to load coverage. Try again.'),
    });
  }

  function renderLeaderboard() {
    renderCoverageLeaderboard({
      documentRef,
      leaderboard,
      selectedPilotId,
      currentUserId,
      colorRegistry,
      onSelect: (pilot) => {
        selectedPilotId = pilot?.userId ?? null;
        overviewButton?.setAttribute('aria-pressed', String(!selectedPilotId));
        renderLeaderboard();
        void territoryLoader?.refresh({ force: true });
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
      if (
        selectedPilotId &&
        !pilots.some((pilot) => pilot.userId === selectedPilotId && pilot.claimedCellCount > 0)
      ) {
        selectedPilotId = null;
        overviewButton?.setAttribute('aria-pressed', 'true');
        await territoryLoader?.refresh({ force: true });
      }
      renderLeaderboard();
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) {
        const status = documentRef.querySelector('[data-territory-status]');
        if (status) status.textContent = 'Unable to update coverage rankings.';
      }
    } finally {
      if (isCurrent()) card?.removeAttribute('aria-busy');
    }
  });

  async function refreshPeriod() {
    selectedPilotId = null;
    overviewButton?.setAttribute('aria-pressed', 'true');
    hideCellPopup();
    await Promise.all([leaderboardRequest.run(), territoryLoader?.refresh({ force: true })]);
  }

  const periodControl = initializeCompetitionPeriodControl({
    documentRef,
    locationRef,
    historyRef,
    now,
    onChange: async () => {
      if (mapReady) await refreshPeriod();
    },
  });

  overviewButton?.addEventListener('click', () => {
    if (!selectedPilotId) return;
    selectedPilotId = null;
    overviewButton.setAttribute('aria-pressed', 'true');
    renderLeaderboard();
    void territoryLoader?.refresh({ force: true });
  });

  try {
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: [-106.2, 39.2],
      zoom: 7,
    });
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    initializeTerritoryLoader();
    map.once('error', () => setStatus('Map unavailable. Check your connection and try again.'));
    map.once('load', async () => {
      try {
        if (arenaSourceId) {
          const boundary = await jsonRequest(
            `/v1/arenas/${encodeURIComponent(arenaSourceId)}/boundary`,
            fetchImpl,
          );
          map.addSource('competition-arena-boundary', { type: 'geojson', data: boundary });
          map.addLayer({
            id: 'competition-arena-boundary',
            type: 'line',
            source: 'competition-arena-boundary',
            paint: { 'line-color': '#0f172a', 'line-width': 3 },
          });
          map.fitBounds(
            [
              [boundary.bbox[0], boundary.bbox[1]],
              [boundary.bbox[2], boundary.bbox[3]],
            ],
            { padding: 60, duration: 0 },
          );
        }
        mapReady = true;
        await refreshPeriod();
      } catch {
        setStatus('Unable to load competition coverage. Try again.');
        card?.removeAttribute('aria-busy');
      } finally {
        initializeMapFlightAids({
          map,
          mapElement,
          documentRef,
          fetchImpl,
          navigatorRef,
          storage,
        });
      }
    });
    map.on('moveend', () => {
      if (!mapReady) return;
      if (!arenaSourceId) void leaderboardRequest.run();
      void territoryLoader?.refresh();
    });
    map.on('click', async (event) => {
      if (!cellPopup) return;
      const feature = coverageCellFeatureAtPoint(map, event.point);
      const properties = feature?.properties;
      if (!properties) {
        hideCellPopup();
        return;
      }
      const requestId = ++cellPopupRequestId;
      cellPopup.hidden = true;
      try {
        const payload = await jsonRequest(
          coverageCellClaimantsUrl(properties.x, properties.y, periodControl.month),
          fetchImpl,
        );
        if (requestId !== cellPopupRequestId) return;
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
        positionCoverageCellPopup(cellPopup, event.point, mapElement.clientWidth);
      } catch {
        if (requestId === cellPopupRequestId) cellPopup.hidden = true;
      }
    });
  } catch {
    setStatus('Map unavailable. Check your connection and try again.');
  }
}
