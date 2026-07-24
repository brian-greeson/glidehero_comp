import { createCompetitionColorRegistry } from './competitionColors.js';
import { initializeCompetitionPeriodControl } from './competitionPeriod.js';
import { createLatestRequest } from './latestRequest.js';
import {
  arenaCoverageLeaderboardUrl,
  competitionCellTracksUrl,
  coverageTerritoryTileUrl,
  globalCoverageLeaderboardUrl,
} from './competitionCoverageApi.js';
import { renderCoverageLeaderboard } from './competitionCoverageLeaderboard.js';
import {
  assignLoadedCoverageColors,
  coverageCellFeatureAtPoint,
  installCoverageSource,
  updateCoverageTiles,
  visibleCoverageFeatureCount,
} from './competitionCoverageMap.js';
import {
  createMapCellTrackSelection,
  installMapCellTrackLayers,
} from './mapCellTracks.js';
import { initializeMapFlightAids } from './mapFlightAids.js';
import { mapViewportFromSearch, updateMapModeLinks } from './mapViewportUrl.js';
import { initializeMapReplayController } from './mapReplayController.js';

async function jsonRequest(url, fetchImpl, signal) {
  const response = await fetchImpl(url, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Coverage request failed with ${response.status}.`);
  return response.json();
}

function matchingElements(documentRef, selector) {
  const matches = documentRef.querySelectorAll?.(selector);
  if (matches?.length) return Array.from(matches);
  const match = documentRef.querySelector(selector);
  return match ? [match] : [];
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
  const leaderboardCards = matchingElements(documentRef, '[data-territory-leaderboard]');
  const overviewButtons = matchingElements(documentRef, '[data-territory-allpilots]');
  const leaderboardStatuses = matchingElements(documentRef, '[data-territory-status]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  if (!root || !mapElement || !maplibre) return;

  const arenaSourceId = mapElement.dataset.arenaSourceId || null;
  const focusArenaSourceId = mapElement.dataset.focusArenaSourceId || null;
  const currentUserId = mapElement.dataset.currentUserId;
  const colorRegistry = createCompetitionColorRegistry(
    currentUserId,
    mapElement.dataset.territoryColor,
  );
  let map;
  let mapReady = false;
  let selectedPilotId = null;
  let leaderboard = { leaders: [], currentPilot: null };
  let cellTrackSelection;
  let replayController;

  function syncOverviewButtons() {
    for (const button of overviewButtons)
      button.setAttribute('aria-pressed', String(!selectedPilotId));
  }

  function setLeaderboardBusy(isBusy) {
    for (const card of leaderboardCards) {
      if (isBusy) card.setAttribute('aria-busy', 'true');
      else card.removeAttribute('aria-busy');
    }
  }

  function setLeaderboardError(message) {
    for (const status of leaderboardStatuses) {
      status.textContent = message;
      status.hidden = false;
    }
  }

  function syncModeLinks(periodSelection = {
    period: periodControl.period,
    month: periodControl.month,
  }) {
    if (map) updateMapModeLinks({ documentRef, locationRef, map, periodSelection });
  }

  function setStatus(message = '') {
    if (!emptyState) return;
    emptyState.textContent = message;
    emptyState.hidden = !message;
  }

  function activeTileUrl() {
    return coverageTerritoryTileUrl({
      arenaSourceId,
      month: periodControl.month,
      pilotUserId: selectedPilotId,
    });
  }

  function refreshTerritoryTiles() {
    updateCoverageTiles(map, activeTileUrl());
  }

  function activeCellTrackScope() {
    return { month: periodControl.month, pilotUserId: selectedPilotId };
  }

  async function refreshCellTracks() {
    if (cellTrackSelection) await cellTrackSelection.refresh(activeCellTrackScope());
  }

  function renderLeaderboard() {
    renderCoverageLeaderboard({
      documentRef,
      leaderboard,
      selectedPilotId,
      currentUserId,
      colorRegistry,
      onSelect: async (pilot) => {
        selectedPilotId = pilot?.userId ?? null;
        syncOverviewButtons();
        renderLeaderboard();
        refreshTerritoryTiles();
        await refreshCellTracks();
      },
    });
  }

  const leaderboardRequest = createLatestRequest(async ({ signal, isCurrent }) => {
    if (!map?.getBounds) return;
    setLeaderboardBusy(true);
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
        syncOverviewButtons();
        refreshTerritoryTiles();
        void refreshCellTracks();
      }
      renderLeaderboard();
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) {
        setLeaderboardError('Unable to update coverage rankings.');
      }
    } finally {
      if (isCurrent()) setLeaderboardBusy(false);
    }
  });

  async function refreshPeriod() {
    selectedPilotId = null;
    syncOverviewButtons();
    refreshTerritoryTiles();
    await Promise.all([leaderboardRequest.run(), refreshCellTracks()]);
  }

  const periodControl = initializeCompetitionPeriodControl({
    documentRef,
    locationRef,
    historyRef,
    now,
    onChange: async (selection) => {
      syncModeLinks(selection);
      replayController?.setMonth(selection.month);
      if (mapReady) await refreshPeriod();
    },
  });

  syncOverviewButtons();
  for (const overviewButton of overviewButtons) {
    overviewButton.addEventListener('click', async () => {
      if (!selectedPilotId) return;
      selectedPilotId = null;
      syncOverviewButtons();
      renderLeaderboard();
      refreshTerritoryTiles();
      await refreshCellTracks();
    });
  }

  try {
    const initialViewport = mapViewportFromSearch(locationRef?.search);
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: initialViewport?.center ?? [-106.2, 39.2],
      zoom: initialViewport?.zoom ?? 7,
    });
    syncModeLinks();
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.once('error', () => setStatus('Map unavailable. Check your connection and try again.'));
    map.once('load', async () => {
      try {
        if (arenaSourceId || focusArenaSourceId) {
          const boundarySourceId = arenaSourceId ?? focusArenaSourceId;
          const boundary = await jsonRequest(
            `/v1/arenas/${encodeURIComponent(boundarySourceId)}/boundary`,
            fetchImpl,
          );
          map.addSource('arena-focus-boundary', { type: 'geojson', data: boundary });
          map.addLayer({
            id: 'arena-focus-boundary',
            type: 'line',
            source: 'arena-focus-boundary',
            paint: { 'line-color': '#0f172a', 'line-width': 3 },
          });
          if (!initialViewport) {
            map.fitBounds(
              [
                [boundary.bbox[0], boundary.bbox[1]],
                [boundary.bbox[2], boundary.bbox[3]],
              ],
              { padding: 60, duration: 0 },
            );
          }
        }
        installCoverageSource(map, activeTileUrl(), {
          minimumZoom: Number(mapElement.dataset.territoryTileMinimumZoom),
          maximumZoom: Number(mapElement.dataset.territoryTileMaximumZoom),
        });
        installMapCellTrackLayers(map);
        cellTrackSelection = createMapCellTrackSelection({
          map,
          cellFeatureAtPoint: coverageCellFeatureAtPoint,
          colorTracks: (tracks) => ({
            type: 'FeatureCollection',
            features: (tracks?.features ?? []).map((feature) => ({
              ...feature,
              properties: {
                ...feature.properties,
                trackColor: colorRegistry.colorFor(feature.properties?.pilotUserId),
              },
            })),
          }),
          loadCellTracks: async (cell, scope, signal) => jsonRequest(
            competitionCellTracksUrl(cell.x, cell.y, scope),
            fetchImpl,
            signal,
          ),
        });
        map.on?.('click', (event) =>
          cellTrackSelection.handleClick(event, activeCellTrackScope()));
        mapReady = true;
        replayController = initializeMapReplayController({
          documentRef,
          map,
          fetchImpl,
          month: periodControl.month,
          mode: 'competitive',
          colorForPilot: colorRegistry.colorFor,
        });
        await refreshPeriod();
      } catch {
        setStatus('Unable to load competition coverage. Try again.');
        setLeaderboardBusy(false);
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
      syncModeLinks();
      if (!mapReady) return;
      if (!arenaSourceId) void leaderboardRequest.run();
    });
    map.on('sourcedata', (event) => {
      if (!mapReady || event.sourceId !== 'competition-coverage' || !event.isSourceLoaded) return;
      assignLoadedCoverageColors(map, colorRegistry);
    });
    map.on('idle', () => {
      if (!mapReady) return;
      setStatus(visibleCoverageFeatureCount(map) === 0 ? 'No territory for this zoom level or area.' : '');
    });
  } catch {
    setStatus('Map unavailable. Check your connection and try again.');
  }
}
