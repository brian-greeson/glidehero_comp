import { createLatestRequest } from './latestRequest.js';
import { installPersonalTerritorySource } from './personalMap.js';
import { renderPersonalStats } from './personalStatsView.js';
import { personalStatsUrl } from './viewportQuery.js';
import { initializeMapFlightAids } from './mapFlightAids.js';

export function initializePersonalDashboard({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
  navigatorRef = globalThis.navigator,
  storage,
} = {}) {
  const mapElement = documentRef.querySelector('[data-dashboard-map]');
  const emptyState = documentRef.querySelector('[data-map-empty-state]');
  const statsCard = documentRef.querySelector('[data-personal-stats]');

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
  const statsRequest = createLatestRequest(async ({ signal, isCurrent }, bounds) => {
    statsCard?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchImpl(personalStatsUrl(bounds), {
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
    map = new maplibre.Map({
      container: mapElement,
      style: mapElement.dataset.mapStyleUrl,
      center: [-106.2, 39.2],
      zoom: 7,
    });
    map.addControl(new maplibre.NavigationControl(), 'top-right');
    map.once('error', () => showStatus('Map unavailable. Check your connection and try again.'));
    map.once('load', async () => {
      installPersonalTerritorySource(map, mapElement.dataset.territoryColor);
      initializeMapFlightAids({
        map, mapElement, documentRef, fetchImpl, navigatorRef, storage,
      });
      mapReady = true;
      if (map.getBounds) await statsRequest.run(map.getBounds());
    });
    map.on?.('moveend', () => {
      if (mapReady && map.getBounds) {
        void statsRequest.run(map.getBounds());
      }
    });
  } catch {
    showStatus('Map unavailable. Check your connection and try again.');
  }
}
