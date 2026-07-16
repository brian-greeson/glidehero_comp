const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };
const GRID_SOURCE_ID = 'admin-area-grid';
const GRID_FILL_LAYER_ID = 'admin-area-grid-fill';
const GRID_LINE_LAYER_ID = 'admin-area-grid-line';
const AREA_SOURCE_ID = 'admin-area-cells';
const AREA_FILL_LAYER_ID = 'admin-area-cells-fill';
const AREA_LINE_LAYER_ID = 'admin-area-cells-line';

export function areaCellKey(cell) {
  return `${cell.properties.x}:${cell.properties.y}`;
}

export function filterAndSortAreas(areas, query, sortColumn = 'name', sortDirection = 'asc') {
  const needle = query.trim().toLocaleLowerCase();
  const direction = sortDirection === 'desc' ? -1 : 1;
  return areas
    .filter((area) => !needle || [area.name, area.country, area.state]
      .some((value) => value.toLocaleLowerCase().includes(needle)))
    .toSorted((left, right) => {
      const primary = left[sortColumn].localeCompare(right[sortColumn], undefined, { sensitivity: 'base' });
      if (primary) return primary * direction;
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
}

export function normalizeEditorLongitude(longitude) {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function timezoneValues() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['America/Denver', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Zurich', 'UTC'];
  }
}

async function jsonRequest(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed with ${response.status}.`);
  return body;
}

function layerDefinitions() {
  return [
    { id: GRID_FILL_LAYER_ID, type: 'fill', source: GRID_SOURCE_ID, paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.01 } },
    { id: GRID_LINE_LAYER_ID, type: 'line', source: GRID_SOURCE_ID, paint: { 'line-color': '#63788f', 'line-width': 1, 'line-opacity': 0.62 } },
    { id: AREA_FILL_LAYER_ID, type: 'fill', source: AREA_SOURCE_ID, paint: { 'fill-color': '#1769aa', 'fill-opacity': 0.48 } },
    { id: AREA_LINE_LAYER_ID, type: 'line', source: AREA_SOURCE_ID, paint: { 'line-color': '#0b4d82', 'line-width': 2, 'line-opacity': 0.95 } },
  ];
}

export function initializeAdminAreaEditor({
  documentRef = document,
  maplibre = window.maplibregl,
  fetchImpl = window.fetch.bind(window),
} = {}) {
  const root = documentRef.querySelector('[data-admin-area-editor]');
  const mapElement = documentRef.querySelector('[data-area-map]');
  if (!root || !mapElement || !maplibre) return;

  const form = documentRef.querySelector('[data-area-form]');
  const heading = documentRef.querySelector('[data-area-heading]');
  const status = documentRef.querySelector('[data-form-status]');
  const saveButton = documentRef.querySelector('[data-save-area]');
  const cancelButton = documentRef.querySelector('[data-cancel-area]');
  const list = documentRef.querySelector('[data-area-list]');
  const total = documentRef.querySelector('[data-area-total]');
  const search = documentRef.querySelector('[data-area-search]');
  const dialog = documentRef.querySelector('[data-unsaved-dialog]');
  const mapHelp = documentRef.querySelector('[data-map-help]');
  const fields = Object.fromEntries([...form.querySelectorAll('[data-field]')].map((field) => [field.dataset.field, field]));

  for (const timezone of timezoneValues()) {
    const option = documentRef.createElement('option');
    option.value = timezone;
    option.textContent = timezone;
    fields.timezone.append(option);
  }

  const state = {
    areas: [],
    selectedId: null,
    isNew: false,
    sortColumn: 'name',
    sortDirection: 'asc',
    cells: new Map(),
    original: '',
    tool: 'pan',
    painting: false,
    pendingAction: null,
    marker: null,
    lookupSequence: 0,
  };

  const map = new maplibre.Map({
    container: mapElement,
    style: mapElement.dataset.mapStyleUrl,
    center: [-106.2, 39.2],
    zoom: 5,
  });
  map.addControl(new maplibre.NavigationControl(), 'top-right');

  function setStatus(message = '', isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function ensureTimezone(timezone) {
    if (!timezone || [...fields.timezone.options].some((option) => option.value === timezone)) return;
    const option = documentRef.createElement('option');
    option.value = timezone;
    option.textContent = timezone;
    fields.timezone.append(option);
  }

  function areaPayload() {
    return {
      name: fields.name.value.trim(),
      country: fields.country.value.trim(),
      state: fields.state.value.trim(),
      city: fields.city.value.trim(),
      latitude: Number(fields.latitude.value),
      longitude: Number(fields.longitude.value),
      altitudeMeters: Number(fields.altitudeMeters.value),
      timezone: fields.timezone.value,
      cells: [...state.cells.values()].map((cell) => ({ x: cell.properties.x, y: cell.properties.y })),
    };
  }

  function snapshot() {
    const payload = areaPayload();
    return JSON.stringify({
      ...payload,
      cells: payload.cells.toSorted((left, right) => left.x - right.x || left.y - right.y),
    });
  }

  function hasSelection() {
    return state.isNew || Boolean(state.selectedId);
  }

  function isDirty() {
    return hasSelection() && state.original !== snapshot();
  }

  function updateSaveState() {
    const payload = areaPayload();
    const valid = hasSelection()
      && payload.name && payload.country && payload.state && payload.city && payload.timezone
      && fields.latitude.value !== '' && fields.longitude.value !== '' && fields.altitudeMeters.value !== ''
      && Number.isFinite(payload.latitude) && payload.latitude >= -90 && payload.latitude <= 90
      && Number.isFinite(payload.longitude) && payload.longitude >= -180 && payload.longitude <= 180
      && Number.isInteger(payload.altitudeMeters)
      && payload.cells.length > 0;
    saveButton.disabled = !valid || !isDirty();
    cancelButton.disabled = !isDirty();
    fields.cellCount.value = String(state.cells.size);
  }

  function updateAreaSource() {
    map.getSource(AREA_SOURCE_ID)?.setData({ type: 'FeatureCollection', features: [...state.cells.values()] });
    updateSaveState();
  }

  function setInputsEnabled(enabled) {
    for (const [name, field] of Object.entries(fields)) {
      if (!['id', 'sourceId', 'cellCount'].includes(name)) field.disabled = !enabled;
    }
  }

  function setTool(tool) {
    state.tool = tool;
    state.painting = false;
    for (const button of documentRef.querySelectorAll('[data-map-tool]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mapTool === tool));
    }
    if (tool === 'pan') map.dragPan.enable();
    else map.dragPan.disable();
    map.getCanvas().style.cursor = tool === 'pan' ? '' : 'crosshair';
    mapHelp.textContent = tool === 'pan'
      ? 'Pan or click the map to move the launch location.'
      : `${tool === 'paint' ? 'Paint' : 'Erase'} cells by clicking and dragging.`;
  }

  function renderList() {
    const areas = filterAndSortAreas(state.areas, search.value, state.sortColumn, state.sortDirection);
    total.textContent = `${areas.length} of ${state.areas.length}`;
    list.replaceChildren();
    if (!areas.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No matching areas.';
      list.append(empty);
      return;
    }
    for (const area of areas) {
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = `admin-area-list-row${area.id === state.selectedId ? ' is-selected' : ''}`;
      button.dataset.areaId = area.id;
      button.setAttribute('role', 'row');
      for (const value of [area.name, area.country, area.state]) {
        const cell = documentRef.createElement('span');
        cell.textContent = value;
        cell.title = value;
        cell.setAttribute('role', 'cell');
        button.append(cell);
      }
      list.append(button);
    }
  }

  function setMarker(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (!state.marker) {
      state.marker = new maplibre.Marker({ draggable: true })
        .setLngLat([longitude, latitude])
        .addTo(map);
      state.marker.on('dragend', () => {
        const position = state.marker.getLngLat();
        setCoordinates(position.lat, position.lng, true);
      });
    } else {
      state.marker.setLngLat([longitude, latitude]);
    }
  }

  async function lookupLocation(latitude, longitude) {
    const request = ++state.lookupSequence;
    setStatus('Looking up the nearest location…');
    try {
      const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
      const { location } = await jsonRequest(`/admin/api/location?${query}`, {}, fetchImpl);
      if (request !== state.lookupSequence) return;
      fields.country.value = location.country;
      fields.state.value = location.state;
      fields.city.value = location.city;
      fields.altitudeMeters.value = String(location.altitudeMeters);
      ensureTimezone(location.timezone);
      fields.timezone.value = location.timezone;
      setStatus('Location details updated.');
      updateSaveState();
    } catch (error) {
      if (request !== state.lookupSequence) return;
      setStatus(`${error.message} You can enter the values manually.`, true);
    }
  }

  function setCoordinates(latitude, longitude, lookup = false) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    fields.latitude.value = String(Number(latitude.toFixed(6)));
    fields.longitude.value = String(Number(longitude.toFixed(6)));
    setMarker(latitude, longitude);
    updateSaveState();
    if (lookup) void lookupLocation(latitude, longitude);
  }

  function clearMarker() {
    state.marker?.remove();
    state.marker = null;
  }

  function populateArea(area) {
    state.selectedId = area.id;
    state.isNew = false;
    state.cells = new Map(area.cells.features.map((cell) => [areaCellKey(cell), cell]));
    heading.textContent = area.name;
    for (const name of ['id', 'sourceId', 'name', 'country', 'state', 'city', 'latitude', 'longitude', 'altitudeMeters']) {
      fields[name].value = String(area[name]);
    }
    ensureTimezone(area.timezone);
    fields.timezone.value = area.timezone;
    setInputsEnabled(true);
    setMarker(area.latitude, area.longitude);
    updateAreaSource();
    state.original = snapshot();
    updateSaveState();
    renderList();
    setStatus();
    if (area.bbox) {
      map.fitBounds([[area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]], { padding: 80, maxZoom: 15, duration: 0 });
    } else {
      map.easeTo({ center: [area.longitude, area.latitude], zoom: 13, duration: 0 });
    }
    void refreshGrid();
  }

  async function selectArea(id) {
    setStatus('Loading area…');
    try {
      const { area } = await jsonRequest(`/admin/api/areas/${encodeURIComponent(id)}`, {}, fetchImpl);
      populateArea(area);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function newArea() {
    state.selectedId = null;
    state.isNew = true;
    state.cells = new Map();
    heading.textContent = 'New area';
    for (const field of Object.values(fields)) field.value = '';
    fields.id.value = 'Assigned on save';
    fields.sourceId.value = 'Assigned on save';
    fields.cellCount.value = '0';
    setInputsEnabled(true);
    clearMarker();
    updateAreaSource();
    state.original = snapshot();
    updateSaveState();
    renderList();
    setStatus('Click the map to set the launch location, then paint cells.');
    setTool('pan');
  }

  function clearSelection() {
    state.selectedId = null;
    state.isNew = false;
    state.cells = new Map();
    heading.textContent = 'No area selected';
    for (const field of Object.values(fields)) field.value = '';
    fields.id.value = '—';
    fields.sourceId.value = '—';
    fields.cellCount.value = '0';
    setInputsEnabled(false);
    clearMarker();
    updateAreaSource();
    state.original = '';
    updateSaveState();
    renderList();
    setStatus();
    setTool('pan');
    mapHelp.textContent = 'Select an area or create a new one.';
  }

  function cancelArea() {
    if (!isDirty()) return;
    if (state.isNew) {
      clearSelection();
      return;
    }
    void selectArea(state.selectedId);
  }

  async function saveArea() {
    const payload = areaPayload();
    const isNew = state.isNew;
    saveButton.disabled = true;
    setStatus('Saving area…');
    try {
      const url = isNew ? '/admin/api/areas' : `/admin/api/areas/${encodeURIComponent(state.selectedId)}`;
      const method = isNew ? 'POST' : 'PUT';
      const { area } = await jsonRequest(url, { method, body: JSON.stringify(payload) }, fetchImpl);
      const detail = await jsonRequest(`/admin/api/areas/${encodeURIComponent(area.id)}`, {}, fetchImpl);
      const listResponse = await jsonRequest('/admin/api/areas', {}, fetchImpl);
      state.areas = listResponse.areas;
      populateArea(detail.area);
      setStatus('Area saved.');
      return true;
    } catch (error) {
      setStatus(error.message, true);
      updateSaveState();
      return false;
    }
  }

  function requestAction(action) {
    if (!isDirty()) {
      void action();
      return;
    }
    state.pendingAction = action;
    dialog.showModal();
  }

  function editCellAt(point) {
    if (!hasSelection() || state.tool === 'pan') return;
    const [gridCell] = map.queryRenderedFeatures(point, { layers: [GRID_FILL_LAYER_ID] });
    if (!gridCell) return;
    const cell = {
      type: 'Feature',
      properties: { x: Number(gridCell.properties.x), y: Number(gridCell.properties.y) },
      geometry: gridCell.geometry,
    };
    const key = areaCellKey(cell);
    if (state.tool === 'paint') state.cells.set(key, cell);
    else state.cells.delete(key);
    updateAreaSource();
  }

  async function refreshGrid() {
    if (!map.getSource(GRID_SOURCE_ID)) return;
    const bounds = map.getBounds();
    const query = new URLSearchParams({
      west: String(normalizeEditorLongitude(bounds.getWest())),
      south: String(bounds.getSouth()),
      east: String(normalizeEditorLongitude(bounds.getEast())),
      north: String(bounds.getNorth()),
    });
    try {
      const response = await fetchImpl(`/admin/api/areas/grid?${query}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/geo+json' },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Unable to load game cells.');
      map.getSource(GRID_SOURCE_ID)?.setData(body);
      if (hasSelection()) setTool(state.tool);
    } catch (error) {
      map.getSource(GRID_SOURCE_ID)?.setData(EMPTY_GEOJSON);
      mapHelp.textContent = error.message;
    }
  }

  map.once('load', () => {
    map.addSource(GRID_SOURCE_ID, { type: 'geojson', data: EMPTY_GEOJSON });
    map.addSource(AREA_SOURCE_ID, { type: 'geojson', data: EMPTY_GEOJSON });
    for (const layer of layerDefinitions()) map.addLayer(layer);
    void refreshGrid();
  });
  map.on('moveend', () => void refreshGrid());
  map.on('mousedown', (event) => {
    if (state.tool === 'pan') return;
    state.painting = true;
    editCellAt(event.point);
  });
  map.on('mousemove', (event) => {
    if (state.painting) editCellAt(event.point);
  });
  map.on('mouseup', () => { state.painting = false; });
  map.on('mouseout', () => { state.painting = false; });
  map.on('click', (event) => {
    if (state.tool === 'pan' && hasSelection()) setCoordinates(event.lngLat.lat, event.lngLat.lng, true);
  });

  for (const button of documentRef.querySelectorAll('[data-map-tool]')) {
    button.addEventListener('click', () => setTool(button.dataset.mapTool));
  }
  documentRef.querySelector('[data-new-area]').addEventListener('click', () => requestAction(newArea));
  cancelButton.addEventListener('click', cancelArea);
  search.addEventListener('input', renderList);
  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-area-id]');
    if (row && row.dataset.areaId !== state.selectedId) requestAction(() => selectArea(row.dataset.areaId));
  });
  for (const button of documentRef.querySelectorAll('[data-sort]')) {
    button.addEventListener('click', () => {
      const column = button.dataset.sort;
      if (state.sortColumn === column) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      else {
        state.sortColumn = column;
        state.sortDirection = 'asc';
      }
      for (const candidate of documentRef.querySelectorAll('[data-sort]')) {
        const marker = candidate.querySelector('span');
        if (marker) marker.remove();
        if (candidate.dataset.sort === state.sortColumn) {
          const indicator = documentRef.createElement('span');
          indicator.setAttribute('aria-hidden', 'true');
          indicator.textContent = state.sortDirection === 'asc' ? ' ▲' : ' ▼';
          candidate.append(indicator);
        }
      }
      renderList();
    });
  }
  form.addEventListener('input', () => {
    heading.textContent = fields.name.value.trim() || (state.isNew ? 'New area' : 'Unnamed area');
    updateSaveState();
  });
  for (const field of [fields.latitude, fields.longitude]) {
    field.addEventListener('change', () => {
      const latitude = Number(fields.latitude.value);
      const longitude = Number(fields.longitude.value);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) setCoordinates(latitude, longitude, true);
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveArea();
  });
  dialog.addEventListener('click', async (event) => {
    const action = event.target.dataset.dialogAction;
    if (!action) return;
    if (action === 'cancel') {
      state.pendingAction = null;
      dialog.close();
      return;
    }
    if (action === 'save' && !(await saveArea())) return;
    const pending = state.pendingAction;
    state.pendingAction = null;
    dialog.close();
    if (pending) await pending();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  void jsonRequest('/admin/api/areas', {}, fetchImpl)
    .then(({ areas }) => {
      state.areas = areas;
      renderList();
    })
    .catch((error) => {
      list.textContent = error.message;
      setStatus(error.message, true);
    });

  return { map, state, selectArea, newArea, saveArea };
}

if (typeof document !== 'undefined') initializeAdminAreaEditor();
