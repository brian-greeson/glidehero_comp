import { createLatestRequest } from '../latestRequest.js';
import { normalizeViewportBounds } from '../viewportQuery.js';

const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });
const PROCESSED_SOURCE_ID = 'thermal-processed-areas';
const PROCESSED_LAYER_ID = 'thermal-processed-areas-fill';
export const MINIMUM_PROCESSED_AREA_ZOOM = 11;

const activityBandLabels = {
  dark_blue: 'Dark blue',
  cyan: 'Cyan',
  yellow_orange: 'Yellow/orange',
  red: 'Red',
};

export function processedThermalAreasUrl(bounds) {
  const normalized = normalizeViewportBounds(bounds);
  return `/admin/api/thermal/areas?${new URLSearchParams({
    west: String(normalized.west), south: String(normalized.south),
    east: String(normalized.east), north: String(normalized.north),
  })}`;
}

export function processedThermalTooltipRows(properties, dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})) {
  const processedAt = new Date(properties.processedAt);
  return [
    `Band: ${activityBandLabels[properties.activityBand] ?? properties.activityBand}`,
    `Score: ${Number(properties.relativeScore).toFixed(2)}`,
    `Processed: ${dateFormatter.format(processedAt)}`,
  ];
}

export function processedThermalAreaLayer(opacity = 0.6) {
  return {
    id: PROCESSED_LAYER_ID,
    type: 'fill',
    source: PROCESSED_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': ['match', ['get', 'activityBand'],
        'dark_blue', '#1e3a8a',
        'cyan', '#06b6d4',
        'yellow_orange', '#f59e0b',
        'red', '#dc2626',
        '#64748b'],
      'fill-opacity': opacity,
    },
  };
}

export function thermalDrawingFeatures(points, complete) {
  const features = points.map((coordinate) => ({
    type: 'Feature', properties: { kind: 'vertex' }, geometry: { type: 'Point', coordinates: coordinate },
  }));
  if (points.length >= 2) {
    const coordinates = complete || points.length >= 3 ? [...points, points[0]] : points;
    features.unshift({
      type: 'Feature', properties: { kind: complete ? 'area' : 'preview' },
      geometry: complete
        ? { type: 'Polygon', coordinates: [coordinates] }
        : { type: 'LineString', coordinates },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function thermalPolygonGeometry(points) {
  if (points.length < 3) throw new RangeError('A thermal crawl polygon requires at least three points.');
  return { type: 'Polygon', coordinates: [[...points, points[0]]] };
}

export function initializeThermalData({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
} = {}) {
  const root = documentRef.querySelector('[data-admin-thermal]');
  const mapNode = documentRef.querySelector('[data-thermal-map]');
  const geometry = documentRef.querySelector('[data-thermal-geometry]');
  const submit = documentRef.querySelector('[data-thermal-submit]');
  const status = documentRef.querySelector('[data-thermal-selection-status]');
  const drawButton = documentRef.querySelector('[data-thermal-draw]');
  const finishButton = documentRef.querySelector('[data-thermal-finish]');
  const clearButton = documentRef.querySelector('[data-thermal-clear]');
  const processedToggle = documentRef.querySelector('[data-thermal-processed-toggle]');
  const opacityControl = documentRef.querySelector('[data-thermal-opacity-control]');
  const opacityInput = documentRef.querySelector('[data-thermal-opacity]');
  const opacityOutput = documentRef.querySelector('[data-thermal-opacity-output]');
  const processedStatus = documentRef.querySelector('[data-thermal-processed-status]');
  if (!root || !mapNode || !geometry || !submit || !status || !drawButton || !finishButton || !clearButton
    || !processedToggle || !opacityControl || !opacityInput || !opacityOutput || !processedStatus || !maplibre) return null;

  const map = new maplibre.Map({ container: mapNode, style: mapNode.dataset.mapStyleUrl, center: [-105.5, 39.2], zoom: 6, maxPitch: 0 });
  map.addControl(new maplibre.NavigationControl(), 'top-right');
  processedToggle.disabled = true;
  const points = [];
  let drawing = false;
  let complete = false;
  let processedEnabled = false;
  let popup;
  let popupPinned = false;

  function setProcessedStatus(message = '', error = false) {
    processedStatus.textContent = message;
    processedStatus.classList.toggle('is-error', error);
  }

  function setProcessedVisibility(visible) {
    if (map.getLayer(PROCESSED_LAYER_ID)) {
      map.setLayoutProperty(PROCESSED_LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
  }

  function closeProcessedPopup() {
    popup?.remove();
    popup = undefined;
    popupPinned = false;
  }

  function showProcessedPopup(feature, lngLat, pinned) {
    if (!processedEnabled || drawing) return;
    const content = documentRef.createElement('div');
    content.className = 'admin-thermal-tooltip';
    for (const row of processedThermalTooltipRows(feature.properties)) {
      const line = documentRef.createElement('span');
      line.textContent = row;
      content.append(line);
    }
    popup?.remove();
    const nextPopup = new maplibre.Popup({ closeButton: pinned, closeOnClick: false, offset: 8 })
      .setLngLat(lngLat)
      .setDOMContent(content)
      .addTo(map);
    popup = nextPopup;
    nextPopup.on?.('close', () => {
      if (popup === nextPopup) {
        popup = undefined;
        popupPinned = false;
      }
    });
    popupPinned = pinned;
  }

  const processedRequest = createLatestRequest(async ({ signal, isCurrent }, url) => {
    const response = await fetchImpl(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/geo+json' },
      signal,
    });
    if (response.status === 422) {
      const error = new Error('Zoom in to view processed areas.');
      error.code = 'too_large';
      throw error;
    }
    if (!response.ok) throw new Error(`Processed thermal area request failed with ${response.status}.`);
    const data = await response.json();
    if (!isCurrent() || !processedEnabled) return;
    map.getSource(PROCESSED_SOURCE_ID)?.setData(data);
    setProcessedVisibility(true);
    setProcessedStatus(data.features.length ? `${data.features.length} processed areas` : 'No processed areas in view.');
  });

  async function refreshProcessedAreas() {
    if (!processedEnabled) return;
    if (map.getZoom() < MINIMUM_PROCESSED_AREA_ZOOM) {
      processedRequest.cancel();
      map.getSource(PROCESSED_SOURCE_ID)?.setData(emptyFeatureCollection());
      setProcessedVisibility(false);
      setProcessedStatus('Zoom in to view processed areas.');
      closeProcessedPopup();
      return;
    }
    setProcessedStatus('Loading processed areas…');
    try {
      await processedRequest.run(processedThermalAreasUrl(map.getBounds()));
    } catch (error) {
      if (error?.name === 'AbortError') return;
      map.getSource(PROCESSED_SOURCE_ID)?.setData(emptyFeatureCollection());
      setProcessedVisibility(false);
      setProcessedStatus(error?.code === 'too_large' ? error.message : 'Unable to load processed areas.', error?.code !== 'too_large');
      closeProcessedPopup();
    }
  }

  function toggleProcessedAreas() {
    processedEnabled = !processedEnabled;
    processedToggle.setAttribute('aria-pressed', String(processedEnabled));
    processedToggle.textContent = processedEnabled ? 'Hide processed areas' : 'Show processed areas';
    opacityControl.hidden = !processedEnabled;
    if (!processedEnabled) {
      processedRequest.cancel();
      setProcessedVisibility(false);
      setProcessedStatus();
      closeProcessedPopup();
      return;
    }
    void refreshProcessedAreas();
  }

  function updateMap() {
    map.getSource('thermal-crawl-target')?.setData(points.length ? thermalDrawingFeatures(points, complete) : emptyFeatureCollection());
  }

  function updateControls() {
    drawButton.setAttribute('aria-pressed', String(drawing));
    finishButton.disabled = !drawing || points.length < 3;
    clearButton.disabled = points.length === 0;
    submit.disabled = !complete;
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  }

  function clearSelection(message = 'Draw one polygon on the map.') {
    points.splice(0);
    drawing = false;
    complete = false;
    geometry.value = '';
    status.textContent = message;
    updateMap();
    updateControls();
  }

  function startDrawing() {
    closeProcessedPopup();
    points.splice(0);
    drawing = true;
    complete = false;
    geometry.value = '';
    status.textContent = 'Click at least three points on the map, then choose Finish.';
    updateMap();
    updateControls();
  }

  function finishDrawing() {
    if (!drawing || points.length < 3) return;
    geometry.value = JSON.stringify(thermalPolygonGeometry(points));
    drawing = false;
    complete = true;
    status.textContent = 'Target polygon ready. Tile count will be calculated when the job is created.';
    updateMap();
    updateControls();
  }

  map.on('load', () => {
    map.addSource(PROCESSED_SOURCE_ID, { type: 'geojson', data: emptyFeatureCollection() });
    const firstSymbol = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer(processedThermalAreaLayer(Number(opacityInput.value) / 100), firstSymbol);
    map.addSource('thermal-crawl-target', { type: 'geojson', data: emptyFeatureCollection() });
    map.addLayer({
      id: 'thermal-crawl-target-fill', type: 'fill', source: 'thermal-crawl-target',
      filter: ['==', ['get', 'kind'], 'area'],
      paint: { 'fill-color': '#1769aa', 'fill-opacity': .2 },
    });
    map.addLayer({
      id: 'thermal-crawl-target-line', type: 'line', source: 'thermal-crawl-target',
      filter: ['in', ['get', 'kind'], ['literal', ['area', 'preview']]],
      paint: { 'line-color': '#0b5161', 'line-width': 3 },
    });
    map.addLayer({
      id: 'thermal-crawl-target-vertices', type: 'circle', source: 'thermal-crawl-target',
      filter: ['==', ['get', 'kind'], 'vertex'],
      paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#0b5161', 'circle-stroke-width': 2 },
    });
    map.on('mousemove', PROCESSED_LAYER_ID, (event) => {
      if (!processedEnabled || drawing || popupPinned || !event.features?.[0]) return;
      map.getCanvas().style.cursor = 'pointer';
      showProcessedPopup(event.features[0], event.lngLat, false);
    });
    map.on('mouseleave', PROCESSED_LAYER_ID, () => {
      map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
      if (!popupPinned) closeProcessedPopup();
    });
    map.on('click', PROCESSED_LAYER_ID, (event) => {
      if (!processedEnabled || drawing || !event.features?.[0]) return;
      showProcessedPopup(event.features[0], event.lngLat, true);
    });
    processedToggle.disabled = false;
    updateMap();
  });
  map.on('moveend', () => { if (processedEnabled) void refreshProcessedAreas(); });
  map.on('click', (event) => {
    if (!drawing) return;
    points.push([event.lngLat.lng, event.lngLat.lat]);
    status.textContent = points.length < 3
      ? `${3 - points.length} more ${points.length === 2 ? 'point' : 'points'} required.`
      : `${points.length} points placed. Choose Finish or keep adding points.`;
    updateMap();
    updateControls();
  });
  drawButton.addEventListener('click', startDrawing);
  finishButton.addEventListener('click', finishDrawing);
  clearButton.addEventListener('click', () => clearSelection());
  processedToggle.addEventListener('click', toggleProcessedAreas);
  opacityInput.addEventListener('input', () => {
    opacityOutput.textContent = `${opacityInput.value}%`;
    if (map.getLayer(PROCESSED_LAYER_ID)) map.setPaintProperty(PROCESSED_LAYER_ID, 'fill-opacity', Number(opacityInput.value) / 100);
  });
  updateControls();
  return { map, points, startDrawing, finishDrawing, clearSelection, toggleProcessedAreas, refreshProcessedAreas };
}

if (typeof document !== 'undefined') initializeThermalData();
