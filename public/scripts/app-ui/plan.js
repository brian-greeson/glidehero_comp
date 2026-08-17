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
  if (!Array.isArray(result?.anchors) || !Array.isArray(result?.route)) throw new Error('Calculate a route before exporting.');
  const response = await fetchImpl('/v1/plan/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: '*/*' },
    body: JSON.stringify({ variant, format, prefix, anchors: result.anchors, route: result.route }),
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
  let bootstrap = { savedPlans: [], activePlan: null };
  try {
    const parsed = JSON.parse(root.dataset?.planBootstrap || '{}');
    bootstrap = {
      savedPlans: Array.isArray(parsed?.savedPlans) ? parsed.savedPlans : [],
      activePlan: parsed?.activePlan ?? null,
    };
  } catch { /* Use an empty planner if bootstrap data is unavailable. */ }
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
  const planName = documentRef.querySelector('[data-plan-name]');
  const savePlan = documentRef.querySelector('[data-plan-save]');
  const deletePlan = documentRef.querySelector('[data-plan-delete-saved]');
  const newPlan = documentRef.querySelector('[data-plan-new]');
  const mutationStatus = documentRef.querySelector('[data-plan-mutation-status]');
  const savedList = documentRef.querySelector('[data-plan-saved-list]');
  const savedEmpty = documentRef.querySelector('[data-plan-saved-empty]');
  const savedSheet = documentRef.querySelector('[data-plan-saved-sheet]');
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
  };
  const map = new maplibre.Map({
    container: mapNode,
    style: mapNode.dataset.mapStyleUrl,
    center: [-105.5, 39.2],
    zoom: 6,
    maxPitch: 0,
  });
  map.addControl(new maplibre.NavigationControl(), 'top-right');
  if (savedSheet && windowRef?.matchMedia?.('(max-width: 760px)')?.matches) savedSheet.open = false;
  const collapseMobileAttribution = () => {
    if (!windowRef?.matchMedia?.('(max-width: 760px)')?.matches) return;
    mapNode.querySelector?.('.maplibregl-ctrl-attrib')?.removeAttribute?.('open');
  };
  collapseMobileAttribution();
  const activeBootstrap = bootstrap.activePlan;
  const anchors = Array.isArray(activeBootstrap?.turnpoints)
    ? activeBootstrap.turnpoints.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))
    : [];
  let selectedIndex = -1;
  let draggingIndex = -1;
  let requestTimer;
  let requestController;
  let requestSequence = 0;
  let lastResult = activeBootstrap?.generatedRoute
    ? { ...activeBootstrap.generatedRoute, anchors: activeBootstrap.turnpoints }
    : null;
  let activePlanId = activeBootstrap?.planId ?? null;
  let baseline = null;
  let mutationPending = false;
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
      if (parsed.resumeIntent !== 'export' && parsed.resumeIntent !== 'save') return null;
      return parsed;
    } catch {
      try { storage.removeItem(planResumeStorageKey); } catch { /* Storage can be unavailable. */ }
      return null;
    }
  }

  const resumeState = readResumeState();
  if (resumeState) {
    anchors.splice(0);
    anchors.push(...resumeState.anchors.map((anchor) => ({
      latitude: anchor.latitude,
      longitude: anchor.longitude,
    })));
    restoredResumeIntent = resumeState.resumeIntent;
    restoredMapPosition = resumeState.mapPosition;
    activePlanId = null;
    lastResult = null;
    if (planName) planName.value = typeof resumeState.name === 'string' ? resumeState.name : '';
  } else if (planName && activeBootstrap?.name) {
    planName.value = activeBootstrap.name;
  }

  function selectedPriority() {
    return priorities.find((input) => input.checked)?.value ?? mobilePriority?.value ?? 'balanced';
  }

  function synchronizePriority(value) {
    priorities.forEach((priority) => { priority.checked = priority.value === value; });
    if (mobilePriority) mobilePriority.value = value;
  }

  if (resumeState?.priority) synchronizePriority(resumeState.priority);
  else if (activeBootstrap?.routingPriority) synchronizePriority(activeBootstrap.routingPriority);
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

  function snapshot() {
    return JSON.stringify({
      name: String(planName?.value ?? '').trim(),
      anchors: anchors.map((anchor) => ({ latitude: anchor.latitude, longitude: anchor.longitude })),
      routingPriority: selectedPriority(),
      generatedRoute: lastResult ? {
        route: lastResult.route,
        legs: lastResult.legs,
        directDistanceMeters: lastResult.directDistanceMeters,
        maximumRouteDistanceMeters: lastResult.maximumRouteDistanceMeters,
        routeDistanceMeters: lastResult.routeDistanceMeters,
        actualExtraDistanceMeters: lastResult.actualExtraDistanceMeters,
        actualDeviationPercent: lastResult.actualDeviationPercent,
        thermalCoverage: lastResult.thermalCoverage,
      } : null,
    });
  }

  function isDirty() {
    if (baseline === null) return anchors.length > 0 || Boolean(String(planName?.value ?? '').trim()) || selectedPriority() !== 'balanced';
    return snapshot() !== baseline;
  }

  function validName() {
    const name = String(planName?.value ?? '').trim();
    return name.length >= 1 && name.length <= 80;
  }

  function setMutationStatus(message) {
    if (mutationStatus) mutationStatus.textContent = message;
  }

  function updateControls() {
    if (undo) undo.disabled = anchors.length === 0;
    if (reset) reset.disabled = anchors.length === 0;
    if (deleteSelected) deleteSelected.disabled = selectedIndex < 0;
    if (fitRoute) fitRoute.disabled = anchors.length === 0;
    if (exportOpen) exportOpen.disabled = !lastResult;
    if (savePlan) savePlan.disabled = mutationPending || !validName() || !lastResult;
    if (deletePlan) deletePlan.hidden = !activePlanId;
    setSource('plan-anchors', anchorFeatures(anchors, selectedIndex));
    setSource('plan-direct', lineFeature(anchors));
  }

  function clearResult() {
    lastResult = null;
    setMutationStatus('');
    setSource('plan-route', emptyFeatureCollection());
    if (values.direct) values.direct.textContent = '—';
    if (values.route) values.route.textContent = '—';
    if (values.extra) values.extra.textContent = '—';
    if (values.maximum) values.maximum.textContent = '—';
    if (exportOpen) exportOpen.disabled = true;
    if (savePlan) savePlan.disabled = true;
  }

  function renderResult(result, message = 'Saved route ready.', mobileMessage = 'Route ready') {
    lastResult = result;
    setSource('plan-route', lineFeature(result.route));
    if (values.direct) values.direct.textContent = formatDistance(result.directDistanceMeters);
    if (values.route) values.route.textContent = formatDistance(result.routeDistanceMeters);
    if (values.extra) values.extra.textContent = `+${formatDistance(result.actualExtraDistanceMeters)} (${result.actualDeviationPercent.toFixed(1)}%)`;
    if (values.maximum) values.maximum.textContent = formatDistance(result.maximumRouteDistanceMeters);
    if (exportOpen) exportOpen.disabled = false;
    setStatus(message, mobileMessage);
    updateControls();
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
      renderResult(result,
        result.thermalCoverage === 'available'
          ? 'Route calculated using available historical thermal areas.'
          : 'No processed thermal areas are available here yet; showing the direct route.',
        result.thermalCoverage === 'available' ? 'Route ready' : 'Direct route',
      );
      if (restoredResumeIntent === 'export' && exportDialog?.showModal && !exportDialog.open) {
        restoredResumeIntent = null;
        exportDialog.showModal();
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

  baseline = snapshot();

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
    for (const name of ['plan-direct', 'plan-route', 'plan-anchors']) {
      map.addSource(name, { type: 'geojson', data: emptyFeatureCollection() });
    }
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
    else if (lastResult) renderResult(lastResult);
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

  function confirmDiscard() {
    return !isDirty() || !windowRef?.confirm || windowRef.confirm('Discard unsaved changes to this Plan?');
  }

  function replacePlanUrl(planId = null) {
    windowRef?.history?.replaceState?.({}, '', planId ? `/plan/${planId}` : '/plan');
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  }

  function markActiveListItem() {
    documentRef.querySelectorAll?.('[data-plan-list-item]').forEach((item) => {
      item.classList?.toggle?.('is-active', item.dataset?.planListItem === activePlanId);
    });
  }

  function upsertSavedListItem(plan) {
    if (!savedList) return;
    let item = savedList.querySelector?.(`[data-plan-list-item="${plan.planId}"]`);
    if (!item && documentRef.createElement) {
      item = documentRef.createElement('li');
      item.dataset.planListItem = plan.planId;
      const link = documentRef.createElement('a');
      link.href = `/plan/${plan.planId}`;
      link.dataset.planOpen = '';
      const name = documentRef.createElement('strong');
      name.dataset.planListName = '';
      const date = documentRef.createElement('time');
      date.dataset.planListDate = '';
      link.append(name, date);
      item.append(link);
    }
    const nameNode = item?.querySelector?.('[data-plan-list-name]');
    const dateNode = item?.querySelector?.('[data-plan-list-date]');
    if (nameNode) nameNode.textContent = plan.name;
    if (dateNode) {
      dateNode.dateTime = plan.updatedAt;
      dateNode.textContent = plan.updatedAtLabel || formatUpdatedAt(plan.updatedAt);
    }
    if (item) savedList.prepend?.(item);
    if (savedEmpty) savedEmpty.hidden = true;
    markActiveListItem();
  }

  function clearToNewPlan() {
    clearTimeout(requestTimer);
    requestController?.abort();
    requestSequence += 1;
    anchors.splice(0);
    selectedIndex = -1;
    activePlanId = null;
    if (planName) planName.value = '';
    synchronizePriority('balanced');
    clearResult();
    updateControls();
    setStatus('Place at least two points to calculate a route.', 'Place 2 points');
    setMutationStatus('');
    replacePlanUrl();
    markActiveListItem();
    baseline = snapshot();
  }

  async function responseMessage(response, fallback) {
    try {
      const payload = await response.json();
      return payload?.error?.message ?? payload?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  planName?.addEventListener('input', () => {
    setMutationStatus('');
    updateControls();
  });
  savePlan?.addEventListener('click', async () => {
    if (!validName() || !lastResult || mutationPending) return;
    if (!isAuthenticated) {
      openAuth('save');
      return;
    }
    mutationPending = true;
    updateControls();
    setMutationStatus('Saving…');
    const { anchors: _anchors, ...generatedRoute } = lastResult;
    try {
      const response = await fetchImpl(activePlanId ? `/v1/plans/${activePlanId}` : '/v1/plans', {
        method: activePlanId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          name: String(planName.value).trim(),
          turnpoints: anchors,
          generatedRoute,
          routingPriority: selectedPriority(),
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Plan could not be saved.'));
      const payload = await response.json();
      const plan = payload.plan;
      if (!plan?.planId) throw new Error('Plan could not be saved.');
      activePlanId = plan.planId;
      if (planName) planName.value = plan.name;
      replacePlanUrl(activePlanId);
      upsertSavedListItem(plan);
      baseline = snapshot();
      setMutationStatus('Plan saved.');
    } catch (error) {
      setMutationStatus(error?.message || 'Plan could not be saved.');
    } finally {
      mutationPending = false;
      updateControls();
    }
  });

  newPlan?.addEventListener('click', () => {
    if (confirmDiscard()) clearToNewPlan();
  });

  savedList?.addEventListener('click', (event) => {
    const link = event.target?.closest?.('[data-plan-open]');
    if (!link || !isDirty()) return;
    event.preventDefault();
    if (confirmDiscard()) windowRef?.location?.assign?.(link.href);
  });

  deletePlan?.addEventListener('click', async () => {
    if (!activePlanId || mutationPending) return;
    if (windowRef?.confirm && !windowRef.confirm('Delete this Plan?')) return;
    const deletingId = activePlanId;
    mutationPending = true;
    updateControls();
    setMutationStatus('Deleting…');
    try {
      const response = await fetchImpl(`/v1/plans/${deletingId}`, {
        method: 'DELETE', headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await responseMessage(response, 'Plan could not be deleted.'));
      savedList?.querySelector?.(`[data-plan-list-item="${deletingId}"]`)?.remove?.();
      if (savedEmpty && !savedList?.querySelector?.('[data-plan-list-item]')) savedEmpty.hidden = false;
      clearToNewPlan();
    } catch (error) {
      setMutationStatus(error?.message || 'Plan could not be deleted.');
    } finally {
      mutationPending = false;
      updateControls();
    }
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
        name: String(planName?.value ?? ''),
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
