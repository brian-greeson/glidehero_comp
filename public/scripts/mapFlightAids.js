import { initializeMapGridOverlay } from './mapGridOverlay.js';
import { initializeMapLocationTracker } from './mapLocationTracker.js';
import { initializeMapPositionLayers } from './mapPositionLayer.js';

function removeLegacySavedTrail() {
  try {
    globalThis.localStorage?.removeItem('glidehero.mapTrail.v1');
  } catch {
    // Storage may be unavailable or blocked; the app no longer reads this data.
  }
}

export function initializeMapFlightAids({
  map,
  mapElement,
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch.bind(globalThis),
  navigatorRef = globalThis.navigator,
}) {
  const statusElement = documentRef.querySelector('[data-map-flight-aid-status]');
  const status = (message = '') => {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.hidden = !message;
  };
  removeLegacySavedTrail();
  initializeMapPositionLayers(map);
  const location = initializeMapLocationTracker({
    map,
    documentRef,
    geolocation: navigatorRef?.geolocation,
    status,
  });
  const grid = initializeMapGridOverlay({
    map,
    documentRef,
    fetchImpl,
    status,
    arenaSourceId: mapElement.dataset.arenaSourceId || null,
  });
  map.addControl(grid.control, 'top-right');
  map.addControl(location.locationControl, 'top-right');
  return { grid, location };
}
