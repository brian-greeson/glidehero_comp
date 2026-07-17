import { createLatestRequest } from './latestRequest.js';
import { createMapButtonControl } from './mapButtonControl.js';
import { arenaGridUrl, viewportGridUrl } from './mapGridApi.js';

export const MAP_GRID_SOURCE_ID = 'map-flight-aid-grid';
export const MAP_GRID_LAYER_ID = 'map-flight-aid-grid-lines';
export const MINIMUM_VIEWPORT_GRID_ZOOM = 11;

const MAP_GRID_LAYER = {
  id: MAP_GRID_LAYER_ID,
  type: 'line',
  source: MAP_GRID_SOURCE_ID,
  paint: {
    'line-color': '#334155',
    'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 15, 1.4],
    'line-opacity': 0.72,
  },
};

export function initializeMapGridOverlay({
  map,
  documentRef = document,
  fetchImpl = window.fetch.bind(window),
  status = () => {},
  arenaSourceId = null,
  minimumViewportZoom = MINIMUM_VIEWPORT_GRID_ZOOM,
}) {
  let enabled = false;
  let arenaCache = null;

  function setVisible(visible) {
    if (map.getLayer?.(MAP_GRID_LAYER_ID)) {
      map.setLayoutProperty(MAP_GRID_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  }

  function setData(data) {
    const source = map.getSource?.(MAP_GRID_SOURCE_ID);
    if (source?.setData) {
      source.setData(data);
    } else {
      map.addSource(MAP_GRID_SOURCE_ID, { type: 'geojson', data });
      map.addLayer(MAP_GRID_LAYER);
    }
    setVisible(true);
  }

  const request = createLatestRequest(async ({ signal, isCurrent }, url) => {
    const response = await fetchImpl(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/geo+json' },
      signal,
    });
    if (response.status === 422) {
      const error = new Error('Grid viewport is too large.');
      error.code = 'too_large';
      throw error;
    }
    if (!response.ok) throw new Error(`Grid request failed with ${response.status}.`);
    const data = await response.json();
    if (!isCurrent() || !enabled) return;
    if (arenaSourceId) arenaCache = data;
    setData(data);
    status('');
  });

  async function refresh() {
    if (!enabled) return;
    if (arenaSourceId && arenaCache) {
      setData(arenaCache);
      return;
    }
    if (!arenaSourceId && map.getZoom() < minimumViewportZoom) {
      request.cancel();
      setVisible(false);
      status('Zoom in to view grid.');
      return;
    }
    try {
      await request.run(arenaSourceId ? arenaGridUrl(arenaSourceId) : viewportGridUrl(map.getBounds()));
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setVisible(false);
      status(error?.code === 'too_large' ? 'Zoom in to view grid.' : 'Unable to load grid. Try again.');
    }
  }

  async function toggle() {
    enabled = !enabled;
    control.setPressed(enabled);
    control.setLabel(enabled ? 'Hide grid' : 'Show grid');
    if (!enabled) {
      request.cancel();
      setVisible(false);
      status('');
      return;
    }
    await refresh();
  }

  const control = createMapButtonControl({
    documentRef,
    label: 'Show grid',
    symbol: '▦',
    onClick: () => { void toggle(); },
  });
  const onMoveEnd = () => {
    if (enabled && !arenaSourceId) void refresh();
  };
  if (!arenaSourceId) map.on('moveend', onMoveEnd);

  return {
    control,
    toggle,
    refresh,
    destroy() {
      request.cancel();
      if (!arenaSourceId) map.off?.('moveend', onMoveEnd);
    },
  };
}
