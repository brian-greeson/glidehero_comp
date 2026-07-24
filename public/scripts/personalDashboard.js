import { createLatestRequest } from './latestRequest.js';
import {
  installPersonalTerritorySource,
  personalCellFeatureAtPoint,
  personalCellTracksUrl,
  updatePersonalTerritoryTiles,
} from './personalMap.js';
import { renderPersonalStats } from './personalStatsView.js';
import { personalStatsUrl } from './viewportQuery.js';
import { initializeMapFlightAids } from './mapFlightAids.js';
import { mapViewportFromSearch, updateMapModeLinks } from './mapViewportUrl.js';
import {
  mapPeriodFromSearch,
  initializeCompetitionPeriodControl,
} from './competitionPeriod.js';
import {
  createMapCellTrackSelection,
  installMapCellTrackLayers,
} from './mapCellTracks.js';
import { initializeMapReplayController } from './mapReplayController.js';

export function initializePersonalDashboard({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  storage,
  periodSelection,
  now = () => new Date(),
} = {}) {
  const mapElement = documentRef.querySelector('[data-dashboard-map]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const statsCard = documentRef.querySelector('[data-personal-stats]');
  let period = periodSelection ?? mapPeriodFromSearch(locationRef?.search ?? '', now());

  function showStatus(message) {
    if (!emptyState) return;
    emptyState.textContent = message;
    emptyState.hidden = false;
  }

  if (!mapElement || !maplibre) {
    if (mapElement) showStatus('Map unavailable. Check your connection and try again.');
    return;
  }

  let map;
  let mapReady = false;
  let cellTrackSelection;
  let replayController;
  const statsRequest = createLatestRequest(async ({ signal, isCurrent }, bounds) => {
    statsCard?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchImpl(personalStatsUrl(bounds, period.month), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw new Error(`Personal stats request failed with ${response.status}.`);
      const stats = await response.json();
      if (isCurrent()) renderPersonalStats({ documentRef, stats });
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) statsCard?.removeAttribute('aria-busy');
    }
  });

  try {
    const initialViewport = mapViewportFromSearch(locationRef?.search);
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: initialViewport?.center ?? [-106.2, 39.2],
      zoom: initialViewport?.zoom ?? 7,
    });
    const syncModeLinks = () => updateMapModeLinks({
      documentRef, locationRef, map, periodSelection: period,
    });
    initializeCompetitionPeriodControl({
      documentRef,
      locationRef,
      historyRef,
      now,
      onChange: async (selection) => {
        period = selection;
        replayController?.setMonth(period.month);
        syncModeLinks();
        if (!mapReady) return;
        updatePersonalTerritoryTiles(map, period.month);
        const refreshes = [];
        if (map.getBounds) refreshes.push(statsRequest.run(map.getBounds()));
        if (cellTrackSelection) refreshes.push(cellTrackSelection.refresh(period));
        await Promise.all(refreshes);
      },
    });
    syncModeLinks();
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.once('error', () => showStatus('Map unavailable. Check your connection and try again.'));
    map.once('load', async () => {
      installPersonalTerritorySource(
        map,
        mapElement.dataset.territoryColor,
        {
          minimumZoom: Number(mapElement.dataset.territoryTileMinimumZoom),
          maximumZoom: Number(mapElement.dataset.territoryTileMaximumZoom),
        },
        period.month,
      );
      installMapCellTrackLayers(map);
      cellTrackSelection = createMapCellTrackSelection({
        map,
        cellFeatureAtPoint: personalCellFeatureAtPoint,
        loadCellTracks: async (cell, selectedPeriod, signal) => {
          const response = await fetchImpl(personalCellTracksUrl(cell, selectedPeriod.month), {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
            signal,
          });
          if (!response.ok) {
            throw new Error(`Personal cell tracks request failed with ${response.status}.`);
          }
          return response.json();
        },
      });
      map.on?.('click', (event) => cellTrackSelection.handleClick(event, period));
      initializeMapFlightAids({
        map, mapElement, documentRef, fetchImpl, navigatorRef, storage,
      });
      mapReady = true;
      replayController = initializeMapReplayController({ documentRef, map, fetchImpl, month: period.month, color: mapElement.dataset.territoryColor });
      if (map.getBounds) await statsRequest.run(map.getBounds());
    });
    map.on?.('moveend', () => {
      syncModeLinks();
      if (mapReady && map.getBounds) {
        void statsRequest.run(map.getBounds());
      }
    });
  } catch {
    showStatus('Map unavailable. Check your connection and try again.');
  }
}
