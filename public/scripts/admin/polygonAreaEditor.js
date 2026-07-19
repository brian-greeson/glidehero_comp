import { createLatestRequest } from '../latestRequest.js';
import { normalizeViewportBounds } from '../viewportQuery.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const PREVIEW_SOURCE = 'arena-cell-preview';
const PREVIEW_ZOOM = 11;

export function filterAndSortAreas(areas, query, sortColumn = 'name', sortDirection = 'asc') {
  const needle = query.trim().toLocaleLowerCase();
  const direction = sortDirection === 'desc' ? -1 : 1;
  return areas
    .filter((area) => !needle || [area.name, area.country, area.state, area.city]
      .some((value) => value?.toLocaleLowerCase().includes(needle)))
    .toSorted((left, right) => {
      const primary = left[sortColumn].localeCompare(right[sortColumn], undefined, { sensitivity: 'base' });
      if (primary) return primary * direction;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
}

export function nextAreaSort(column, currentColumn = 'name', currentDirection = 'asc') {
  return {
    sortColumn: column,
    sortDirection: column === currentColumn && currentDirection === 'asc' ? 'desc' : 'asc',
  };
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { credentials: 'same-origin', headers: {
    accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}),
  }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed with ${response.status}.`);
  return body;
}

export function extractImportedPolygonFeatures(value) {
  const geometries = [];
  const add = (geometry) => {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return;
    if (!Array.isArray(geometry.coordinates)) throw new TypeError('Polygon coordinates are malformed.');
    if (geometry.type === 'Polygon') geometries.push(geometry);
    else for (const coordinates of geometry.coordinates) geometries.push({ type: 'Polygon', coordinates });
  };
  if (value?.type === 'FeatureCollection') for (const feature of value.features ?? []) add(feature?.geometry);
  else if (value?.type === 'Feature') add(value.geometry);
  else add(value);
  if (!geometries.length) throw new TypeError('The file does not contain polygon geometry.');
  return geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry }));
}

export function polygonComponentCount(featureCollection) {
  return (featureCollection?.features ?? []).reduce((count, feature) => {
    if (feature?.geometry?.type === 'Polygon') return count + 1;
    if (feature?.geometry?.type === 'MultiPolygon') return count + (feature.geometry.coordinates?.length ?? 0);
    return count;
  }, 0);
}

export function areaPreviewPayload(bounds, geojson) {
  return { ...normalizeViewportBounds(bounds), geojson };
}

export function createUnsavedActionGate({ isDirty, dialog, save }) {
  let pendingAction = null;
  return {
    request(action) {
      if (!isDirty()) return Promise.resolve(action());
      pendingAction = action;
      dialog.showModal();
      return Promise.resolve(false);
    },
    async handle(action) {
      if (action === 'cancel') {
        pendingAction = null;
        dialog.close();
        return false;
      }
      if (action !== 'discard' && action !== 'save') return false;
      if (action === 'save' && !(await save())) return false;
      const pending = pendingAction;
      pendingAction = null;
      dialog.close();
      if (pending) await pending();
      return true;
    },
  };
}

export function createAreaSelection({ load, apply }) {
  return createLatestRequest(async ({ signal, isCurrent }, id) => {
    let area;
    try {
      area = await load(id, signal);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return false;
      throw error;
    }
    if (!isCurrent()) return false;
    apply(area);
    return true;
  });
}

export function initializePolygonAreaEditor({ documentRef = document, maplibre = window.maplibregl, Draw = window.MapboxDraw, fetchImpl = window.fetch.bind(window) } = {}) {
  const root = documentRef.querySelector('[data-admin-area-editor]');
  if (!root || !maplibre || !Draw) return;
  const form = root.querySelector('[data-area-form]');
  const fields = Object.fromEntries([...form.querySelectorAll('[data-field]')].map((field) => [field.dataset.field, field]));
  const status = root.querySelector('[data-form-status]');
  const list = root.querySelector('[data-area-list]');
  const total = root.querySelector('[data-area-total]');
  const search = root.querySelector('[data-area-search]');
  const heading = root.querySelector('[data-area-heading]');
  const saveButton = root.querySelector('[data-save-area]');
  const cancelButton = root.querySelector('[data-cancel-area]');
  const importInput = root.querySelector('[data-geojson-import]');
  const dialog = root.querySelector('[data-unsaved-dialog]');
  const help = root.querySelector('[data-map-help]');
  const mapNode = root.querySelector('[data-area-map]');
  const map = new maplibre.Map({ container: mapNode, style: mapNode.dataset.mapStyleUrl, center: [-105.5, 39], zoom: 4 });
  const draw = new Draw({ displayControlsDefault: false, controls: { polygon: true, trash: true } });
  map.addControl(draw, 'top-left');
  const state = { areas: [], selectedId: null, isNew: false, original: '', dirty: false, sortColumn: 'name', sortDirection: 'asc' };
  const previewRequest = createLatestRequest(async ({ signal, isCurrent }, payload) => {
    const data = await requestJson('/admin/api/areas/preview', { method: 'POST', body: JSON.stringify(payload), signal }, fetchImpl);
    if (isCurrent()) map.getSource(PREVIEW_SOURCE)?.setData(data);
  });
  const setStatus = (message = '', error = false) => { status.textContent = message; status.classList.toggle('is-error', error); };
  const geojson = () => draw.getAll();
  const snapshot = () => JSON.stringify({ name: fields.name.value, country: fields.country.value, state: fields.state.value, city: fields.city.value, geojson: geojson() });
  const update = () => {
    state.dirty = Boolean(state.selectedId || state.isNew) && snapshot() !== state.original;
    fields.componentCount.value = String(polygonComponentCount(geojson()));
    saveButton.disabled = !state.dirty || !fields.name.value.trim() || !fields.country.value.trim() || !geojson().features.length;
    cancelButton.disabled = !state.dirty;
  };
  function renderList() {
    const areas = filterAndSortAreas(state.areas, search.value, state.sortColumn, state.sortDirection);
    total.textContent = `${areas.length} of ${state.areas.length}`; list.replaceChildren();
    for (const button of root.querySelectorAll('[data-sort]')) {
      const active = button.dataset.sort === state.sortColumn;
      button.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      const indicator = button.querySelector('[data-sort-indicator]');
      if (indicator) indicator.textContent = active ? (state.sortDirection === 'asc' ? '↑' : '↓') : '';
    }
    if (!areas.length) {
      const empty = documentRef.createElement('p'); empty.className = 'muted admin-area-list-empty';
      empty.textContent = state.areas.length ? 'No Arenas match this search.' : 'No Arenas found.';
      list.append(empty); return;
    }
    for (const area of areas) {
      const button = documentRef.createElement('button'); button.type = 'button';
      button.className = `admin-area-list-row${area.id === state.selectedId ? ' is-selected' : ''}`; button.dataset.areaId = area.id;
      for (const value of [area.name, area.country, area.state]) { const cell = documentRef.createElement('span'); cell.textContent = value; button.append(cell); }
      list.append(button);
    }
  }
  function setEnabled(enabled) { for (const name of ['name', 'country', 'state', 'city']) fields[name].disabled = !enabled; importInput.disabled = !enabled; }
  async function refreshPreview() {
    if (map.getZoom() < PREVIEW_ZOOM || !geojson().features.length) {
      previewRequest.cancel(); map.getSource(PREVIEW_SOURCE)?.setData(EMPTY); help.textContent = 'Zoom in to preview Arena cells.'; return;
    }
    try {
      await previewRequest.run(areaPreviewPayload(map.getBounds(), geojson()));
      help.textContent = 'Highlighted cells have centers covered by the current draft.';
    } catch (error) { if (error.name !== 'AbortError') { map.getSource(PREVIEW_SOURCE)?.setData(EMPTY); help.textContent = error.message; } }
  }
  function loadGeometry(geometry) { draw.deleteAll(); if (geometry) draw.add({ type: 'Feature', properties: {}, geometry }); }
  function applySelection(area) {
    state.selectedId = area.id; state.isNew = false; heading.textContent = area.name;
    for (const name of ['id', 'sourceId', 'name', 'country', 'state', 'city']) fields[name].value = String(area[name] ?? '');
    loadGeometry(area.geometry); setEnabled(true); state.original = snapshot(); update(); renderList(); setStatus();
    map.fitBounds([[area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]], { padding: 70, maxZoom: 12, duration: 0 }); void refreshPreview();
  }
  const selectionRequest = createAreaSelection({
    load: async (id, signal) => (await requestJson(`/admin/api/areas/${encodeURIComponent(id)}`, { signal }, fetchImpl)).area,
    apply: applySelection,
  });
  async function select(id) {
    try {
      return await selectionRequest.run(id);
    } catch (error) {
      setStatus(error.message, true);
      return false;
    }
  }
  function startNew() {
    selectionRequest.cancel();
    state.selectedId = null; state.isNew = true; heading.textContent = 'New Arena'; draw.deleteAll();
    fields.id.value = 'Assigned on save'; fields.sourceId.value = 'Assigned on save'; fields.name.value = ''; fields.country.value = ''; fields.state.value = ''; fields.city.value = '';
    setEnabled(true); state.original = snapshot(); update(); renderList(); setStatus('Draw or import one or more polygons.');
  }
  async function save() {
    const payload = { name: fields.name.value, country: fields.country.value, state: fields.state.value, city: fields.city.value, geojson: geojson() };
    const url = state.isNew ? '/admin/api/areas' : `/admin/api/areas/${encodeURIComponent(state.selectedId)}`;
    try {
      const { area } = await requestJson(url, { method: state.isNew ? 'POST' : 'PUT', body: JSON.stringify(payload) }, fetchImpl);
      if (!state.areas.some((item) => item.id === area.id)) state.areas.push(area);
      else state.areas = state.areas.map((item) => item.id === area.id ? area : item);
      await select(area.id); setStatus('Arena saved.'); return true;
    } catch (error) { setStatus(error.message, true); update(); return false; }
  }
  const actionGate = createUnsavedActionGate({ isDirty: () => state.dirty, dialog, save });
  map.on('load', () => {
    map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: EMPTY });
    map.addLayer({ id: `${PREVIEW_SOURCE}-fill`, type: 'fill', source: PREVIEW_SOURCE, paint: { 'fill-color': ['case', ['get', 'inside'], '#1769aa', '#ffffff'], 'fill-opacity': ['case', ['get', 'inside'], .45, .03] } });
    map.addLayer({ id: `${PREVIEW_SOURCE}-line`, type: 'line', source: PREVIEW_SOURCE, paint: { 'line-color': '#63788f', 'line-width': 1 } });
  });
  map.on('moveend', () => { void refreshPreview(); });
  for (const event of ['draw.create', 'draw.update', 'draw.delete']) map.on(event, () => { update(); void refreshPreview(); });
  form.addEventListener('input', update); form.addEventListener('submit', (event) => { event.preventDefault(); void save(); });
  root.querySelector('[data-new-area]').addEventListener('click', () => { void actionGate.request(startNew); });
  cancelButton.addEventListener('click', () => { if (state.isNew) startNew(); else void select(state.selectedId); });
  search.addEventListener('input', renderList); list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-area-id]');
    if (row && row.dataset.areaId !== state.selectedId) void actionGate.request(() => select(row.dataset.areaId));
  });
  root.querySelector('.admin-area-list-columns').addEventListener('click', (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    Object.assign(state, nextAreaSort(button.dataset.sort, state.sortColumn, state.sortDirection));
    renderList();
  });
  dialog.addEventListener('click', (event) => {
    const action = event.target.dataset.dialogAction;
    if (action) void actionGate.handle(action);
  });
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]; if (!file) return;
    try { const parsed = JSON.parse(await file.text()); draw.add({ type: 'FeatureCollection', features: extractImportedPolygonFeatures(parsed) }); update(); void refreshPreview(); setStatus('GeoJSON added to the current draft.'); }
    catch (error) { setStatus(error instanceof SyntaxError ? 'The file is not valid JSON.' : error.message, true); }
    importInput.value = '';
  });
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  void requestJson('/admin/api/areas', {}, fetchImpl).then(({ areas }) => { state.areas = areas; renderList(); }).catch((error) => setStatus(error.message, true));
  return { map, draw, refreshPreview };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initializePolygonAreaEditor();
