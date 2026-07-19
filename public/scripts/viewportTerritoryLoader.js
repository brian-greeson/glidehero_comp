import { createLatestRequest } from './latestRequest.js';
import { expandViewportBounds, normalizeViewportBounds, viewportContains } from './viewportQuery.js';

export function createViewportTerritoryLoader({
  map,
  fetchTerritory,
  applyTerritory,
  onVisibleData = () => {},
  onVisibleError = () => {},
  bufferRatio = 0.5,
}) {
  let generation = 0;
  let loadedBounds = null;

  const backgroundRequest = createLatestRequest(async ({ signal, isCurrent }, bounds, requestGeneration) => {
    try {
      const territory = await fetchTerritory(bounds, signal);
      if (!isCurrent() || requestGeneration !== generation) return;
      applyTerritory(territory);
      loadedBounds = bounds;
    } catch (error) {
      // A failed prefetch leaves the successfully rendered visible territory intact.
    }
  });

  const visibleRequest = createLatestRequest(async ({ signal, isCurrent }, bounds, requestGeneration) => {
    try {
      const territory = await fetchTerritory(bounds, signal);
      if (!isCurrent() || requestGeneration !== generation) return;
      applyTerritory(territory);
      loadedBounds = bounds;
      onVisibleData(territory);
      void backgroundRequest.run(expandViewportBounds(bounds, bufferRatio), requestGeneration);
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent() && requestGeneration === generation) onVisibleError(error);
    }
  });

  function invalidate() {
    generation += 1;
    loadedBounds = null;
    visibleRequest.cancel();
    backgroundRequest.cancel();
  }

  return {
    async refresh({ force = false } = {}) {
      if (!map.getBounds) return;
      const visibleBounds = normalizeViewportBounds(map.getBounds());
      if (!force && loadedBounds && viewportContains(loadedBounds, visibleBounds)) return;
      const requestGeneration = ++generation;
      backgroundRequest.cancel();
      await visibleRequest.run(visibleBounds, requestGeneration);
    },
    invalidate,
    destroy: invalidate,
  };
}
