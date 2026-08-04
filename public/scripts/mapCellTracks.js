import { createLatestRequest } from './latestRequest.js';

export const SELECTED_CELL_SOURCE_ID = 'selected-cell';
export const SELECTED_CELL_FILL_LAYER_ID = 'selected-cell-fill';
export const SELECTED_CELL_OUTLINE_LAYER_ID = 'selected-cell-outline';
export const CELL_TRACKS_SOURCE_ID = 'cell-tracks';
export const CELL_TRACKS_LAYER_ID = 'cell-tracks-lines';

const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });

function plainCellFeature(feature) {
  if (!feature?.geometry) return null;
  return {
    type: 'Feature',
    properties: { ...(feature.properties ?? {}) },
    geometry: {
      type: feature.geometry.type,
      coordinates: feature.geometry.coordinates,
    },
  };
}

function stringHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslHex(hue, saturation, lightness) {
  const light = lightness / 100;
  const chroma = (1 - Math.abs((2 * light) - 1)) * (saturation / 100);
  const segment = (((hue % 360) + 360) % 360) / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] = segment < 1
    ? [chroma, secondary, 0]
    : segment < 2
      ? [secondary, chroma, 0]
      : segment < 3
        ? [0, chroma, secondary]
        : segment < 4
          ? [0, secondary, chroma]
          : segment < 5
            ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const match = light - (chroma / 2);
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function colorCellTracks(featureCollection) {
  const flightIds = [...new Set(
    (featureCollection?.features ?? [])
      .map((feature) => feature.properties?.flightId)
      .filter(Boolean),
  )].sort();
  const usedHues = new Set();
  const usedColors = new Set();
  const colors = new Map();
  for (const flightId of flightIds) {
    let colorIndex = stringHash(flightId) % 4320;
    let color;
    do {
      while (usedHues.has(colorIndex)) colorIndex = (colorIndex + 137) % 4320;
      const hue = colorIndex % 360;
      const saturation = 64 + (Math.floor(colorIndex / 360) % 3) * 8;
      const lightness = 42 + (Math.floor(colorIndex / 1080) % 4) * 5;
      color = hslHex(hue, saturation, lightness);
      if (usedColors.has(color)) colorIndex = (colorIndex + 137) % 4320;
    } while (usedColors.has(color));
    usedHues.add(colorIndex);
    usedColors.add(color);
    colors.set(flightId, color);
  }
  return {
    type: 'FeatureCollection',
    features: (featureCollection?.features ?? []).map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        trackColor: colors.get(feature.properties?.flightId) ?? '#2563eb',
      },
    })),
  };
}

export function installMapCellTrackLayers(map) {
  if (!map.getSource?.(SELECTED_CELL_SOURCE_ID)) {
    map.addSource(SELECTED_CELL_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    });
    map.addLayer({
      id: SELECTED_CELL_FILL_LAYER_ID,
      type: 'fill',
      source: SELECTED_CELL_SOURCE_ID,
      paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.16 },
    });
    map.addLayer({
      id: SELECTED_CELL_OUTLINE_LAYER_ID,
      type: 'line',
      source: SELECTED_CELL_SOURCE_ID,
      paint: { 'line-color': '#ffffff', 'line-width': 3 },
    });
  }
  if (!map.getSource?.(CELL_TRACKS_SOURCE_ID)) {
    map.addSource(CELL_TRACKS_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection(),
    });
    map.addLayer({
      id: CELL_TRACKS_LAYER_ID,
      type: 'line',
      source: CELL_TRACKS_SOURCE_ID,
      paint: {
        'line-color': ['get', 'trackColor'],
        'line-width': 3,
        'line-opacity': 0.9,
      },
    });
  }
}

function renderSelection(map, result, colorTracks) {
  map.getSource?.(SELECTED_CELL_SOURCE_ID)?.setData?.({
    type: 'FeatureCollection',
    features: result?.cell ? [result.cell] : [],
  });
  map.getSource?.(CELL_TRACKS_SOURCE_ID)?.setData?.(colorTracks(result?.tracks));
}

export function createMapCellTrackSelection({
  map,
  cellFeatureAtPoint,
  loadCellTracks,
  colorTracks = colorCellTracks,
  onSelect = () => undefined,
  onResult = () => undefined,
  onClear = () => undefined,
  onError = () => undefined,
}) {
  let selectedCell = null;
  const request = createLatestRequest(async ({ signal, isCurrent }, cell, period) => {
    try {
      const result = await loadCellTracks(cell, period, signal);
      if (!isCurrent() || selectedCell?.cellId !== cell.cellId) return;
      renderSelection(map, result, colorTracks);
      onResult(result);
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrent()) onError(error);
    }
  });

  function clear() {
    selectedCell = null;
    request.cancel();
    renderSelection(map, null, colorTracks);
    onClear();
  }

  async function select(cell, period, initialFeature = null) {
    if (!cell?.cellId || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      clear();
      return;
    }
    if (selectedCell?.cellId === cell.cellId) {
      clear();
      return;
    }
    onSelect();
    selectedCell = cell;
    const initialCell = plainCellFeature(initialFeature);
    renderSelection(map, initialCell ? {
      cell: initialCell,
      tracks: emptyFeatureCollection(),
    } : null, colorTracks);
    await request.run(cell, period);
  }

  return {
    clear,
    async handleClick(event, period) {
      const feature = cellFeatureAtPoint(map, event.point);
      const properties = feature?.properties;
      await select(
        properties
          ? { cellId: properties.cellId, x: Number(properties.x), y: Number(properties.y) }
          : null,
        period,
        feature,
      );
    },
    async refresh(period) {
      if (selectedCell) await request.run(selectedCell, period);
    },
    get selectedCell() {
      return selectedCell;
    },
  };
}
