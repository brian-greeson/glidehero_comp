import { createCompetitionColorRegistry } from './competitionColors.js';
import { initializeCompetitionPeriodControl } from './competitionPeriod.js';
import { createLatestRequest } from './latestRequest.js';
import {
  arenaCoverageLeaderboardUrl,
  coverageCellClaimantsUrl,
  coverageTerritoryTileUrl,
  globalCoverageLeaderboardUrl,
} from './competitionCoverageApi.js';
import { renderCoverageLeaderboard } from './competitionCoverageLeaderboard.js';
import {
  assignLoadedCoverageColors,
  coverageCellFeatureAtPoint,
  installCoverageSource,
  isExclusiveCoverageFeature,
  positionCoverageCellPopup,
  setCoverageHoveredCell,
  updateCoverageTiles,
  visibleCoverageFeatureCount,
} from './competitionCoverageMap.js';
import { initializeMapFlightAids } from './mapFlightAids.js';
import { mapViewportFromSearch, updateMapModeLinks } from './mapViewportUrl.js';

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
  let hoveredCellId = null;

  function hideCellPopup() {
    cellPopupRequestId += 1;
    if (cellPopup) cellPopup.hidden = true;
  }

  function clearCellHover() {
    hoveredCellId = null;
    if (mapReady) setCoverageHoveredCell(map);
    const canvas = map?.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
    hideCellPopup();
  }

  function renderCellPopup(claimants, point) {
    if (!cellPopup || claimants.length === 0) return false;
    const heading = documentRef.createElement('strong');
    heading.textContent = 'Claimed by';
    const list = documentRef.createElement('ul');
    for (const claimant of claimants) {
      const item = documentRef.createElement('li');
      item.textContent = claimant.displayName;
      list.append(item);
    }
    cellPopup.replaceChildren(heading, list);
    cellPopup.hidden = false;
    positionCoverageCellPopup(cellPopup, point, mapElement.clientWidth);
    return true;
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
    clearCellHover();
    updateCoverageTiles(map, activeTileUrl());
  }

  function renderLeaderboard() {
    renderCoverageLeaderboard({
      documentRef,
      leaderboard,
      selectedPilotId,
      currentUserId,
      colorRegistry,
      onSelect: (pilot) => {
        clearCellHover();
        selectedPilotId = pilot?.userId ?? null;
        overviewButton?.setAttribute('aria-pressed', String(!selectedPilotId));
        renderLeaderboard();
        refreshTerritoryTiles();
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
        refreshTerritoryTiles();
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
    clearCellHover();
    refreshTerritoryTiles();
    await leaderboardRequest.run();
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
    clearCellHover();
    selectedPilotId = null;
    overviewButton.setAttribute('aria-pressed', 'true');
    renderLeaderboard();
    refreshTerritoryTiles();
  });

  try {
    const initialViewport = mapViewportFromSearch(locationRef?.search);
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: initialViewport?.center ?? [-106.2, 39.2],
      zoom: initialViewport?.zoom ?? 7,
    });
    const syncModeLinks = () => updateMapModeLinks({ documentRef, locationRef, map });
    syncModeLinks();
    map.addControl(new maplibre.NavigationControl(), 'top-right');
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
    map.on('mousemove', async (event) => {
      if (!mapReady || !cellPopup) return;
      const feature = coverageCellFeatureAtPoint(map, event.point);
      if (!isExclusiveCoverageFeature(feature)) {
        clearCellHover();
        return;
      }

      const properties = feature.properties;
      const canvas = map.getCanvas?.();
      if (canvas) canvas.style.cursor = 'pointer';
      if (properties.cellId === hoveredCellId) {
        if (!cellPopup.hidden)
          positionCoverageCellPopup(cellPopup, event.point, mapElement.clientWidth);
        return;
      }

      hoveredCellId = properties.cellId;
      setCoverageHoveredCell(map, hoveredCellId);
      const requestId = ++cellPopupRequestId;
      cellPopup.hidden = true;
      try {
        const payload = await jsonRequest(
          coverageCellClaimantsUrl(properties.x, properties.y, periodControl.month),
          fetchImpl,
        );
        if (requestId !== cellPopupRequestId || properties.cellId !== hoveredCellId) return;
        if (!renderCellPopup(payload.claimants, event.point)) clearCellHover();
      } catch {
        if (requestId === cellPopupRequestId) clearCellHover();
      }
    });
    map.on('mouseleave', clearCellHover);
    map.on('click', async (event) => {
      if (!cellPopup) return;
      const feature = coverageCellFeatureAtPoint(map, event.point);
      if (!isExclusiveCoverageFeature(feature)) {
        hideCellPopup();
        return;
      }
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
        renderCellPopup(payload.claimants, event.point);
      } catch {
        if (requestId === cellPopupRequestId) cellPopup.hidden = true;
      }
    });
  } catch {
    setStatus('Map unavailable. Check your connection and try again.');
  }
}
