import { initializeMapGridOverlay } from './mapGridOverlay.js';
import { initializeMapLocationTracker } from './mapLocationTracker.js';
import { createMapTrailStore } from './mapTrailStore.js';
import { initializeTrailLayers } from './mapTrailLayer.js';

function browserStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function initializeMapFlightAids({
  map,
  mapElement,
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch.bind(globalThis),
  navigatorRef = globalThis.navigator,
  storage,
}) {
  const statusElement = documentRef.querySelector('[data-map-flight-aid-status]');
  const status = (message = '') => {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.hidden = !message;
  };
  const store = createMapTrailStore({
    storage: browserStorage(storage),
    onPersistenceError: () => status('Trail is visible, but new points cannot be saved.'),
  });
  initializeTrailLayers(map, store.snapshot());
  const location = initializeMapLocationTracker({
    map,
    documentRef,
    geolocation: navigatorRef?.geolocation,
    store,
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
  map.addControl(location.clearControl, 'top-right');
  return { grid, location };
}
