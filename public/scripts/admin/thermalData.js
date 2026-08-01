const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });

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

export function initializeThermalData({ documentRef = document, maplibre = window.maplibregl } = {}) {
  const root = documentRef.querySelector('[data-admin-thermal]');
  const mapNode = documentRef.querySelector('[data-thermal-map]');
  const geometry = documentRef.querySelector('[data-thermal-geometry]');
  const submit = documentRef.querySelector('[data-thermal-submit]');
  const status = documentRef.querySelector('[data-thermal-selection-status]');
  const drawButton = documentRef.querySelector('[data-thermal-draw]');
  const finishButton = documentRef.querySelector('[data-thermal-finish]');
  const clearButton = documentRef.querySelector('[data-thermal-clear]');
  if (!root || !mapNode || !geometry || !submit || !status || !drawButton || !finishButton || !clearButton || !maplibre) return null;

  const map = new maplibre.Map({ container: mapNode, style: mapNode.dataset.mapStyleUrl, center: [-105.5, 39.2], zoom: 6, maxPitch: 0 });
  map.addControl(new maplibre.NavigationControl(), 'top-right');
  const points = [];
  let drawing = false;
  let complete = false;

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
    updateMap();
  });
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
  updateControls();
  return { map, points, startDrawing, finishDrawing, clearSelection };
}

if (typeof document !== 'undefined') initializeThermalData();
