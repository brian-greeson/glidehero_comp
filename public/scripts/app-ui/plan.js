const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });
const planResumeStorageKey = 'glidehero.plan.resume.v1';
const planResumeVersion = 1;

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

export function routeBounds(points) {
  if (!points?.length) return null;
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

export async function requestPlanExport({ fetchImpl, result, variant, format, prefix }) {
  if (!result?.exportToken) throw new Error('Calculate a route before exporting.');
  const response = await fetchImpl('/v1/plan/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: '*/*' },
    body: JSON.stringify({ variant, format, prefix, exportToken: result.exportToken }),
  });
  if (!response.ok) throw new Error('Flight plan export failed.');
  const filename = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]
    ?? `glidehero-${variant}.${format}`;
  return { blob: await response.blob(), filename };
}

export function initializePlanPage({
  documentRef = document,
  maplibre = globalThis.window?.maplibregl,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  windowRef = globalThis.window,
} = {}) {
  const root = documentRef.querySelector('[data-plan-page]');
  const mapNode = documentRef.querySelector('[data-plan-map]');
  if (!root || !mapNode || !maplibre || !fetchImpl) return null;
  const isAuthenticated = root.dataset?.planAuthenticated !== 'false';
  const priorities = [...documentRef.querySelectorAll('[data-plan-priority]')];
  const mobilePriority = documentRef.querySelector('[data-plan-priority-mobile]');
  const status = documentRef.querySelector('[data-plan-status]');
  const mobileStatus = documentRef.querySelector('[data-plan-status-mobile]');
  const undo = documentRef.querySelector('[data-plan-undo]');
  const deleteSelected = documentRef.querySelector('[data-plan-delete]');
  const reset = documentRef.querySelector('[data-plan-reset]');
  const thermalToggle = documentRef.querySelector('[data-plan-thermal-toggle]');
  const fitRoute = documentRef.querySelector('[data-plan-fit-route]');
  const metricsToggle = documentRef.querySelector('[data-plan-metrics-toggle]');
  const exportOpen = documentRef.querySelector('[data-plan-export-open]');
  const exportDialog = documentRef.querySelector('[data-plan-export-dialog]');
  const exportForm = documentRef.querySelector('[data-plan-export-form]');
  const exportClose = documentRef.querySelector('[data-plan-export-close]');
  const exportCancel = documentRef.querySelector('[data-plan-export-cancel]');
  const exportDownload = documentRef.querySelector('[data-plan-export-download]');
  const exportStatus = documentRef.querySelector('[data-plan-export-status]');
  const collectCells = documentRef.querySelector('[data-plan-collect-cells]');
  const authDialog = documentRef.querySelector('[data-plan-auth-dialog]');
  const authChoice = documentRef.querySelector('[data-plan-auth-choice]');
  const authSigninPanel = documentRef.querySelector('[data-plan-auth-signin-panel]');
  const authSignupPanel = documentRef.querySelector('[data-plan-auth-signup-panel]');
  const authSignin = [...documentRef.querySelectorAll('[data-plan-auth-signin]')];
  const authSignup = [...documentRef.querySelectorAll('[data-plan-auth-signup]')];
  const authBack = [...documentRef.querySelectorAll('[data-plan-auth-back]')];
  const authClose = [...documentRef.querySelectorAll('[data-plan-auth-close]')];
  const loginForm = documentRef.querySelector('[data-plan-login-form]');
  const signupForm = documentRef.querySelector('[data-plan-signup-form]');
  const loginStatus = documentRef.querySelector('[data-plan-login-status]');
  const signupStatus = documentRef.querySelector('[data-plan-signup-status]');
  const values = {
    direct: documentRef.querySelector('[data-plan-direct-distance]'),
    route: documentRef.querySelector('[data-plan-route-distance]'),
    extra: documentRef.querySelector('[data-plan-extra-distance]'),
    maximum: documentRef.querySelector('[data-plan-maximum-distance]'),
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
  const collapseMobileAttribution = () => {
    if (!windowRef?.matchMedia?.('(max-width: 760px)')?.matches) return;
    mapNode.querySelector?.('.maplibregl-ctrl-attrib')?.removeAttribute?.('open');
  };
  collapseMobileAttribution();
  const anchors = [];
  let selectedIndex = -1;
  let draggingIndex = -1;
  let requestTimer;
  let requestController;
  let requestSequence = 0;
  let lastResult = null;
  let authResumeIntent = null;
  let restoredResumeIntent = null;
  let restoredMapPosition = null;

  function readResumeState() {
    if (!isAuthenticated) return null;
    const storage = windowRef?.sessionStorage;
    if (!storage) return null;
    let value;
    try {
      value = storage.getItem(planResumeStorageKey);
      if (!value) return null;
      storage.removeItem(planResumeStorageKey);
      const parsed = JSON.parse(value);
      if (parsed?.version !== planResumeVersion || !Array.isArray(parsed.anchors)) return null;
      if (!parsed.anchors.every((anchor) => Number.isFinite(anchor?.latitude) && Number.isFinite(anchor?.longitude))) return null;
      if (!['export', 'collect-cells'].includes(parsed.resumeIntent)) return null;
      return parsed;
    } catch {
      try { storage.removeItem(planResumeStorageKey); } catch { /* Storage can be unavailable. */ }
      return null;
    }
  }

  const resumeState = readResumeState();
  if (resumeState) {
    anchors.push(...resumeState.anchors.map((anchor) => ({
      latitude: anchor.latitude,
      longitude: anchor.longitude,
    })));
    restoredResumeIntent = resumeState.resumeIntent;
    restoredMapPosition = resumeState.mapPosition;
  }

  function selectedPriority() {
    return priorities.find((input) => input.checked)?.value ?? mobilePriority?.value ?? 'balanced';
  }

  function synchronizePriority(value) {
    priorities.forEach((priority) => { priority.checked = priority.value === value; });
    if (mobilePriority) mobilePriority.value = value;
  }

  if (resumeState?.priority) synchronizePriority(resumeState.priority);
  if (thermalToggle && typeof resumeState?.thermalVisible === 'boolean') {
    thermalToggle.checked = resumeState.thermalVisible;
  }

  function setStatus(message, mobileMessage = message) {
    if (status) status.textContent = message;
    if (mobileStatus) mobileStatus.textContent = mobileMessage;
  }

  function setSource(name, data) {
    map.getSource(name)?.setData(data);
  }

  function updateControls() {
    if (undo) undo.disabled = anchors.length === 0;
    if (reset) reset.disabled = anchors.length === 0;
    if (deleteSelected) deleteSelected.disabled = selectedIndex < 0;
    if (fitRoute) fitRoute.disabled = anchors.length === 0;
    if (exportOpen) exportOpen.disabled = !lastResult;
    setSource('plan-anchors', anchorFeatures(anchors, selectedIndex));
    setSource('plan-direct', lineFeature(anchors));
  }

  function clearResult() {
    lastResult = null;
    setSource('plan-route', emptyFeatureCollection());
    setSource('plan-direct-cells', emptyFeatureCollection());
    setSource('plan-enclosed-cells', emptyFeatureCollection());
    setSource('plan-new-cells', emptyFeatureCollection());
    values.direct.textContent = '—';
    values.route.textContent = '—';
    values.extra.textContent = '—';
    values.maximum.textContent = '—';
    values.directCells.textContent = '0';
    values.enclosedCells.textContent = '0';
    if (values.newCells) values.newCells.textContent = '0';
    if (exportOpen) exportOpen.disabled = true;
  }

  async function calculate(sequence = ++requestSequence) {
    if (sequence !== requestSequence) return;
    requestController?.abort();
    if (anchors.length < 2) {
      clearResult();
      setStatus('Place at least two points to calculate a route.', 'Place 2 points');
      return;
    }
    requestController = new AbortController();
    setStatus('Calculating thermal-guided route…', 'Calculating…');
    try {
      const response = await fetchImpl('/v1/plan/route', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ anchors, routingPriority: selectedPriority() }),
        signal: requestController.signal,
      });
      if (!response.ok) throw new Error('Route calculation failed.');
      const result = await response.json();
      if (sequence !== requestSequence) return;
      lastResult = result;
      setSource('plan-route', lineFeature(result.route));
      setSource('plan-direct-cells', claimFeatures(result.claims.direct));
      setSource('plan-enclosed-cells', claimFeatures(result.claims.enclosed));
      const newPersonalClaims = Array.isArray(result.claims.newPersonal) ? result.claims.newPersonal : [];
      setSource('plan-new-cells', claimFeatures(newPersonalClaims));
      values.direct.textContent = formatDistance(result.directDistanceMeters);
      values.route.textContent = formatDistance(result.routeDistanceMeters);
      values.extra.textContent = `+${formatDistance(result.actualExtraDistanceMeters)} (${result.actualDeviationPercent.toFixed(1)}%)`;
      values.maximum.textContent = formatDistance(result.maximumRouteDistanceMeters);
      values.directCells.textContent = String(result.claims.direct.length);
      values.enclosedCells.textContent = String(result.claims.enclosed.length);
      if (values.newCells) values.newCells.textContent = String(newPersonalClaims.length);
      if (exportOpen) exportOpen.disabled = false;
      setStatus(
        result.thermalCoverage === 'available'
          ? 'Route calculated using available historical thermal areas.'
          : 'No processed thermal areas are available here yet; showing the direct route.',
        result.thermalCoverage === 'available' ? 'Route ready' : 'Direct route',
      );
      if (restoredResumeIntent === 'export' && result.exportToken && exportDialog?.showModal && !exportDialog.open) {
        restoredResumeIntent = null;
        exportDialog.showModal();
      } else if (restoredResumeIntent === 'collect-cells') {
        restoredResumeIntent = null;
      }
    } catch (error) {
      if (error?.name === 'AbortError' || sequence !== requestSequence) return;
      setSource('plan-route', lineFeature(anchors));
      setStatus('Thermal routing is temporarily unavailable; showing the direct route.', 'Try again');
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
    collapseMobileAttribution();
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
    if (restoredMapPosition
      && Number.isFinite(restoredMapPosition.longitude)
      && Number.isFinite(restoredMapPosition.latitude)) {
      map.setCenter?.([restoredMapPosition.longitude, restoredMapPosition.latitude]);
      if (Number.isFinite(restoredMapPosition.zoom)) map.setZoom?.(restoredMapPosition.zoom);
    }
    if (resumeState) calculate();
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
    clearResult();
    updateControls();
  });
  map.on('mouseup', () => {
    if (draggingIndex < 0) return;
    draggingIndex = -1;
    map.getCanvas().style.cursor = 'crosshair';
    map.dragPan.enable();
    scheduleCalculation();
  });

  priorities.forEach((priority) => priority.addEventListener('change', () => {
    synchronizePriority(priority.value);
    clearResult();
    scheduleCalculation();
  }));
  mobilePriority?.addEventListener('change', () => {
    synchronizePriority(mobilePriority.value);
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
    if (mobileStatus) mobileStatus.textContent = thermalToggle.checked ? 'Thermals visible' : 'Thermals hidden';
  });
  fitRoute?.addEventListener('click', () => {
    const bounds = routeBounds(lastResult?.route?.length ? lastResult.route : anchors);
    if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 11, duration: 500 });
  });
  const mobileBreakpoint = windowRef?.matchMedia?.('(max-width: 760px)');
  const synchronizeMetrics = () => {
    const isMobile = mobileBreakpoint?.matches === true;
    metricsToggle?.setAttribute('aria-expanded', String(!isMobile));
    metricsToggle?.setAttribute('tabindex', isMobile ? '0' : '-1');
  };
  const resizeMap = () => windowRef?.requestAnimationFrame?.(() => map.resize?.());
  const breakpointChanged = () => {
    synchronizeMetrics();
    resizeMap();
  };
  synchronizeMetrics();
  mobileBreakpoint?.addEventListener?.('change', breakpointChanged);
  metricsToggle?.addEventListener('click', () => {
    if (!mobileBreakpoint?.matches) return;
    const expanded = metricsToggle.getAttribute('aria-expanded') === 'true';
    metricsToggle.setAttribute('aria-expanded', String(!expanded));
  });
  const showAuthPanel = (panel) => {
    if (authChoice) authChoice.hidden = panel !== 'choice';
    if (authSigninPanel) authSigninPanel.hidden = panel !== 'signin';
    if (authSignupPanel) authSignupPanel.hidden = panel !== 'signup';
  };
  const openAuth = (resumeIntent) => {
    authResumeIntent = resumeIntent;
    showAuthPanel('choice');
    if (loginStatus) loginStatus.textContent = '';
    if (signupStatus) signupStatus.textContent = '';
    if (authDialog?.showModal && !authDialog.open) authDialog.showModal();
  };
  const safeMapPosition = () => {
    try {
      const center = map.getCenter?.();
      const zoom = map.getZoom?.();
      if (!Number.isFinite(center?.lng) || !Number.isFinite(center?.lat)) return null;
      return {
        longitude: center.lng,
        latitude: center.lat,
        ...(Number.isFinite(zoom) ? { zoom } : {}),
      };
    } catch {
      return null;
    }
  };
  const saveResumeState = () => {
    const storage = windowRef?.sessionStorage;
    if (!storage || !authResumeIntent) return false;
    try {
      storage.setItem(planResumeStorageKey, JSON.stringify({
        version: planResumeVersion,
        anchors: anchors.map((anchor) => ({ latitude: anchor.latitude, longitude: anchor.longitude })),
        priority: selectedPriority(),
        thermalVisible: thermalToggle?.checked !== false,
        mapPosition: safeMapPosition(),
        resumeIntent: authResumeIntent,
      }));
      return true;
    } catch {
      return false;
    }
  };
  const authErrorMessage = (payload) => {
    if (typeof payload?.error?.message === 'string') return payload.error.message;
    if (typeof payload?.error === 'string') return payload.error;
    if (typeof payload?.message === 'string') return payload.message;
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      return payload.errors.map((error) => error?.message ?? error).filter(Boolean).join(' ');
    }
    return 'Unable to continue. Check your details and try again.';
  };
  const submitAuthForm = async (form, endpoint, statusNode) => {
    if (!form) return;
    if (statusNode) statusNode.textContent = 'Please wait…';
    const body = new URLSearchParams();
    new FormData(form).forEach((value, key) => body.append(key, String(value)));
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
      });
      let payload = null;
      try { payload = await response.json(); } catch { /* Use the fallback message below. */ }
      if (!response.ok) {
        if (statusNode) statusNode.textContent = authErrorMessage(payload);
        return;
      }
      if (!saveResumeState()) {
        if (statusNode) statusNode.textContent = 'Your route could not be preserved. Please try again.';
        return;
      }
      if (windowRef?.location?.assign) windowRef.location.assign('/plan');
      else if (windowRef?.location) windowRef.location.href = '/plan';
    } catch {
      if (statusNode) statusNode.textContent = 'Unable to continue. Check your connection and try again.';
    }
  };
  exportOpen?.addEventListener('click', () => {
    if (!lastResult) return;
    if (!isAuthenticated) {
      openAuth('export');
      return;
    }
    if (exportDialog?.showModal && !exportDialog.open) exportDialog.showModal();
  });
  collectCells?.addEventListener('click', () => openAuth('collect-cells'));
  authSignin.forEach((control) => control.addEventListener('click', () => showAuthPanel('signin')));
  authSignup.forEach((control) => control.addEventListener('click', () => showAuthPanel('signup')));
  authBack.forEach((control) => control.addEventListener('click', () => showAuthPanel('choice')));
  authClose.forEach((control) => control.addEventListener('click', () => authDialog?.close()));
  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    return submitAuthForm(loginForm, '/login', loginStatus);
  });
  signupForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    return submitAuthForm(signupForm, '/signup', signupStatus);
  });
  const closeExport = () => exportDialog?.close();
  exportClose?.addEventListener('click', closeExport);
  exportCancel?.addEventListener('click', closeExport);
  exportForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!lastResult) return;
    const formData = new FormData(exportForm);
    if (exportDownload) exportDownload.disabled = true;
    if (exportStatus) exportStatus.textContent = 'Preparing export…';
    try {
      const exported = await requestPlanExport({
        fetchImpl,
        result: lastResult,
        variant: String(formData.get('variant') ?? 'main-turnpoints'),
        format: String(formData.get('format') ?? 'cup'),
        prefix: String(formData.get('prefix') ?? 'GH').trim().toUpperCase(),
      });
      const url = URL.createObjectURL(exported.blob);
      const link = documentRef.createElement('a');
      link.href = url;
      link.download = exported.filename;
      link.click();
      URL.revokeObjectURL(url);
      closeExport();
    } catch {
      if (exportStatus) exportStatus.textContent = 'Export is temporarily unavailable. Try again.';
    } finally {
      if (exportDownload) exportDownload.disabled = false;
    }
  });
  return { map, anchors, calculate };
}

if (typeof document !== 'undefined') initializePlanPage();
