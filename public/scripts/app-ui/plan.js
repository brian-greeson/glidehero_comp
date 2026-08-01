const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });

function lineFeature(points) {
  return {
    type: 'FeatureCollection',
    features: points.length > 1 ? [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: points.map((point) => [point.longitude, point.latitude]) },
    }] : [],
  };
}

function anchorFeatures(points, selectedIndex) {
  return {
    type: 'FeatureCollection',
    features: points.map((point, index) => ({
      type: 'Feature',
      properties: { index, label: String(index + 1), selected: index === selectedIndex },
      geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
    })),
  };
}

function claimFeatures(claims) {
  return {
    type: 'FeatureCollection',
    features: claims.map((cell) => ({ type: 'Feature', properties: { x: cell.x, y: cell.y }, geometry: cell.geometry })),
  };
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  return `${(meters / 1000).toFixed(meters >= 100_000 ? 0 : 1)} km`;
}

export function initializePlanPage({
  documentRef = document,
  maplibre = globalThis.window?.maplibregl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  const root = documentRef.querySelector('[data-plan-page]');
  const mapNode = documentRef.querySelector('[data-plan-map]');
  if (!root || !mapNode || !maplibre || !fetchImpl) return null;
  const deviation = documentRef.querySelector('[data-plan-deviation]');
  const deviationOutput = documentRef.querySelector('[data-plan-deviation-output]');
  const status = documentRef.querySelector('[data-plan-status]');
  const undo = documentRef.querySelector('[data-plan-undo]');
  const deleteSelected = documentRef.querySelector('[data-plan-delete]');
  const reset = documentRef.querySelector('[data-plan-reset]');
  const thermalToggle = documentRef.querySelector('[data-plan-thermal-toggle]');
  const values = {
    direct: documentRef.querySelector('[data-plan-direct-distance]'),
    route: documentRef.querySelector('[data-plan-route-distance]'),
    deviation: documentRef.querySelector('[data-plan-actual-deviation]'),
    directCells: documentRef.querySelector('[data-plan-direct-cells]'),
    enclosedCells: documentRef.querySelector('[data-plan-enclosed-cells]'),
    newCells: documentRef.querySelector('[data-plan-new-cells]'),
  };
  const map = new maplibre.Map({
    container: mapNode,
    style: mapNode.dataset.mapStyleUrl,
    center: [-105.5, 39.2],
    zoom: 6,
    maxPitch: 0,
  });
  map.addControl(new maplibre.NavigationControl(), 'top-right');
  const anchors = [];
  let selectedIndex = -1;
  let draggingIndex = -1;
  let requestTimer;
  let requestController;
  let requestSequence = 0;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function setSource(name, data) {
    map.getSource(name)?.setData(data);
  }

  function updateControls() {
    if (undo) undo.disabled = anchors.length === 0;
    if (reset) reset.disabled = anchors.length === 0;
    if (deleteSelected) deleteSelected.disabled = selectedIndex < 0;
    setSource('plan-anchors', anchorFeatures(anchors, selectedIndex));
    setSource('plan-direct', lineFeature(anchors));
  }

  function clearResult() {
    setSource('plan-route', emptyFeatureCollection());
    setSource('plan-direct-cells', emptyFeatureCollection());
    setSource('plan-enclosed-cells', emptyFeatureCollection());
    setSource('plan-new-cells', emptyFeatureCollection());
    values.direct.textContent = '—';
    values.route.textContent = '—';
    values.deviation.textContent = '—';
    values.directCells.textContent = '0';
    values.enclosedCells.textContent = '0';
    values.newCells.textContent = '0';
  }

  async function calculate(sequence = ++requestSequence) {
    if (sequence !== requestSequence) return;
    requestController?.abort();
    if (anchors.length < 2) {
      clearResult();
      setStatus('Place at least two points to calculate a route.');
      return;
    }
    requestController = new AbortController();
    setStatus('Calculating thermal-guided route…');
    try {
      const response = await fetchImpl('/v1/plan/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ anchors, maximumDeviationPercent: Number(deviation?.value ?? 20) }),
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error('Route calculation failed.');
      const result = await response.json();
      if (sequence !== requestSequence) return;
      setSource('plan-route', lineFeature(result.route));
      setSource('plan-direct-cells', claimFeatures(result.claims.direct));
      setSource('plan-enclosed-cells', claimFeatures(result.claims.enclosed));
      setSource('plan-new-cells', claimFeatures(result.claims.newPersonal));
      values.direct.textContent = formatDistance(result.directDistanceMeters);
      values.route.textContent = formatDistance(result.routeDistanceMeters);
      values.deviation.textContent = `${result.actualDeviationPercent.toFixed(1)}%`;
      values.directCells.textContent = String(result.claims.direct.length);
      values.enclosedCells.textContent = String(result.claims.enclosed.length);
      values.newCells.textContent = String(result.claims.newPersonal.length);
      setStatus(result.thermalCoverage === 'available'
        ? 'Route calculated using available historical thermal areas.'
        : 'No processed thermal areas are available here yet; showing the direct route.');
    } catch (error) {
      if (error?.name === 'AbortError' || sequence !== requestSequence) return;
      setSource('plan-route', lineFeature(anchors));
      setStatus('Thermal routing is temporarily unavailable; showing the direct route.');
    }
  }

  function scheduleCalculation() {
    clearTimeout(requestTimer);
    requestController?.abort();
    const sequence = ++requestSequence;
    requestTimer = setTimeout(() => calculate(sequence), 250);
  }

  function changed() {
    updateControls();
    clearResult();
    scheduleCalculation();
  }

  map.on('load', () => {
    map.addSource('thermal-history', {
      type: 'raster',
      tiles: [mapNode.dataset.thermalTileUrl],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 12,
      attribution: 'thermal.kk7.ch · CC BY-NC-SA 4.0',
    });
    const firstSymbol = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
    map.addLayer({
      id: 'thermal-history', type: 'raster', source: 'thermal-history',
      layout: { visibility: thermalToggle?.checked === false ? 'none' : 'visible' },
      paint: { 'raster-opacity': 0.72 },
    }, firstSymbol);
    for (const name of ['plan-direct', 'plan-route', 'plan-direct-cells', 'plan-enclosed-cells', 'plan-new-cells', 'plan-anchors']) {
      map.addSource(name, { type: 'geojson', data: emptyFeatureCollection() });
    }
    map.addLayer({ id: 'plan-direct-cells', type: 'fill', source: 'plan-direct-cells', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.16, 'fill-outline-color': '#2563eb' } });
    map.addLayer({ id: 'plan-enclosed-cells', type: 'fill', source: 'plan-enclosed-cells', paint: { 'fill-color': '#8b5cf6', 'fill-opacity': 0.2, 'fill-outline-color': '#7c3aed' } });
    map.addLayer({ id: 'plan-new-cells', type: 'line', source: 'plan-new-cells', paint: { 'line-color': '#16a34a', 'line-width': 3 } });
    map.addLayer({ id: 'plan-direct', type: 'line', source: 'plan-direct', paint: { 'line-color': '#0f172a', 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } });
    map.addLayer({ id: 'plan-route', type: 'line', source: 'plan-route', paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.95 } });
    map.addLayer({ id: 'plan-anchors', type: 'circle', source: 'plan-anchors', paint: {
      'circle-radius': ['case', ['get', 'selected'], 8, 6],
      'circle-color': ['case', ['get', 'selected'], '#f97316', '#ffffff'],
      'circle-stroke-color': '#0f172a',
      'circle-stroke-width': 2,
    } });
    updateControls();
  });

  map.on('click', (event) => {
    if (draggingIndex >= 0) return;
    const existing = map.queryRenderedFeatures(event.point, { layers: ['plan-anchors'] });
    if (existing.length) {
      selectedIndex = Number(existing[0].properties.index);
      updateControls();
      return;
    }
    anchors.push({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    selectedIndex = anchors.length - 1;
    changed();
  });

  function beginDrag(event) {
    const feature = event.features?.[0];
    if (!feature) return;
    draggingIndex = Number(feature.properties.index);
    selectedIndex = draggingIndex;
    map.getCanvas().style.cursor = 'grabbing';
    map.dragPan.disable();
    updateControls();
  }
  map.on('mousedown', 'plan-anchors', beginDrag);
  map.on('mousemove', (event) => {
    if (draggingIndex < 0) return;
    anchors[draggingIndex] = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };
    updateControls();
  });
  map.on('mouseup', () => {
    if (draggingIndex < 0) return;
    draggingIndex = -1;
    map.getCanvas().style.cursor = 'crosshair';
    map.dragPan.enable();
    scheduleCalculation();
  });

  deviation?.addEventListener('input', () => {
    deviationOutput.textContent = `${deviation.value}%`;
    clearResult();
    scheduleCalculation();
  });
  undo?.addEventListener('click', () => {
    anchors.pop();
    selectedIndex = Math.min(selectedIndex, anchors.length - 1);
    changed();
  });
  deleteSelected?.addEventListener('click', () => {
    if (selectedIndex < 0) return;
    anchors.splice(selectedIndex, 1);
    selectedIndex = Math.min(selectedIndex, anchors.length - 1);
    changed();
  });
  reset?.addEventListener('click', () => {
    anchors.splice(0);
    selectedIndex = -1;
    changed();
  });
  thermalToggle?.addEventListener('change', () => {
    if (map.getLayer('thermal-history')) map.setLayoutProperty('thermal-history', 'visibility', thermalToggle.checked ? 'visible' : 'none');
  });
  return { map, anchors, calculate };
}

if (typeof document !== 'undefined') initializePlanPage();
