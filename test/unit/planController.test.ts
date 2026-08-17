import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { initializePlanPage, requestPlanExport, routeBounds } from '../../public/scripts/app-ui/plan.js';

const result = {
  anchors: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
  route: [{ latitude: 39, longitude: -105 }, { latitude: 39.5, longitude: -104.6 }, { latitude: 40, longitude: -104 }],
};

const generatedRoute = {
  route: result.route,
  legs: [{ directDistanceMeters: 1000, maximumDistanceMeters: 1250, routeDistanceMeters: 1100 }],
  directDistanceMeters: 1000,
  maximumRouteDistanceMeters: 1250,
  routeDistanceMeters: 1100,
  actualExtraDistanceMeters: 100,
  actualDeviationPercent: 10,
  thermalCoverage: 'available',
};

const activePlan = {
  planId: '00000000-0000-4000-8000-000000000123',
  ownerUserId: '00000000-0000-4000-8000-000000000456',
  name: 'Boulder triangle',
  turnpoints: result.anchors,
  generatedRoute,
  routingPriority: 'thermal',
  visibility: 'private',
  sharedGroupId: null,
  isOwner: true,
  createdAt: '2026-08-15T12:00:00.000Z',
  updatedAt: '2026-08-16T12:00:00.000Z',
};

function makePlanHarness({
  authenticated = true,
  fetchImpl = vi.fn(),
  storedResume = null as string | null,
  bootstrap = { savedPlans: [], activePlan: null } as any,
} = {}) {
  const handlers = new Map<string, (event?: any) => any>();
  const source = { setData: vi.fn() };
  const map = {
    addControl: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(),
    getSource: vi.fn(() => source), getLayer: vi.fn(), setLayoutProperty: vi.fn(),
    getStyle: vi.fn(() => ({ layers: [] })), queryRenderedFeatures: vi.fn(() => []),
    fitBounds: vi.fn(), resize: vi.fn(), setCenter: vi.fn(), setZoom: vi.fn(),
    getCenter: vi.fn(() => ({ lng: -104.5, lat: 39.5 })), getZoom: vi.fn(() => 8),
    getCanvas: vi.fn(() => ({ style: {} })), dragPan: { disable: vi.fn(), enable: vi.fn() },
    on: vi.fn((event: string, layerOrHandler: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) => {
      handlers.set(handler ? `${event}:${layerOrHandler}` : event, handler ?? layerOrHandler as (event?: unknown) => void);
    }),
  };
  const node = (extra = {}): any => ({
    disabled: false, textContent: '', hidden: false, open: false,
    addEventListener: vi.fn(), ...extra,
  });
  const authDialog = node({
    showModal: vi.fn(function (this: { open: boolean }) { this.open = true; }),
    close: vi.fn(function (this: { open: boolean }) { this.open = false; }),
  });
  const exportDialog = node({
    showModal: vi.fn(function (this: { open: boolean }) { this.open = true; }),
    close: vi.fn(function (this: { open: boolean }) { this.open = false; }),
  });
  const loginForm = node({ fields: [['email', 'pilot@example.com'], ['password', 'secret']] });
  const signupForm = node({ fields: [['email', 'new@example.com'], ['password', 'secret']] });
  const priorities = ['shorter', 'balanced', 'thermal'].map((value) => node({ value, checked: value === 'balanced' }));
  const visibilityControls = ['private', 'link', 'group'].map((value) => node({ value, checked: value === 'private' }));
  const savedList = node({ querySelector: vi.fn(() => null), prepend: vi.fn() });
  const nodes = new Map<string, any>([
    ['[data-plan-page]', { dataset: { planAuthenticated: String(authenticated), planBootstrap: JSON.stringify(bootstrap) } }],
    ['[data-plan-map]', { dataset: { mapStyleUrl: 'style', thermalTileUrl: 'tiles' }, querySelector: vi.fn() }],
    ['[data-plan-priority-mobile]', node({ value: 'balanced' })],
    ['[data-plan-thermal-toggle]', node({ checked: true })],
    ['[data-plan-auth-dialog]', authDialog],
    ['[data-plan-auth-choice]', node()],
    ['[data-plan-auth-signin-panel]', node({ hidden: true })],
    ['[data-plan-auth-signup-panel]', node({ hidden: true })],
    ['[data-plan-auth-signin]', node()],
    ['[data-plan-auth-signup]', node()],
    ['[data-plan-login-form]', loginForm],
    ['[data-plan-signup-form]', signupForm],
    ['[data-plan-login-status]', node()],
    ['[data-plan-signup-status]', node()],
    ['[data-plan-export-dialog]', exportDialog],
    ['[data-plan-name]', node({ value: '' })],
    ['[data-plan-save]', node({ disabled: true })],
    ['[data-plan-new]', node()],
    ['[data-plan-mutation-status]', node()],
    ['[data-plan-saved-list]', savedList],
    ['[data-plan-saved-empty]', node({ hidden: false })],
    ['[data-plan-save-section]', node({ open: true })],
    ['[data-plan-share-section]', node({ open: false })],
    ['[data-plan-sharing-group]', node({ hidden: true })],
    ['[data-plan-sharing-group-select]', node({ value: 'group-1' })],
    ['[data-plan-sharing-link]', node({ hidden: true })],
    ['[data-plan-sharing-url]', node({ value: '', select: vi.fn() })],
    ['[data-plan-sharing-copy]', node()],
    ['[data-plan-sharing-save]', node()],
    ['[data-plan-sharing-status]', node()],
    ['[data-plan-sharing-label]', node()],
    ...[
      '[data-plan-status]', '[data-plan-status-mobile]', '[data-plan-undo]', '[data-plan-delete]', '[data-plan-reset]',
      '[data-plan-fit-route]', '[data-plan-direct-distance]', '[data-plan-route-distance]', '[data-plan-extra-distance]',
      '[data-plan-maximum-distance]', '[data-plan-export-open]',
    ].map((selector) => [selector, node()] as const),
  ]);
  const back = node();
  const close = node();
  const documentRef = {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-plan-priority]') return priorities;
      if (selector === '[data-plan-visibility]') return visibilityControls;
      if (selector === '[data-plan-auth-signin]' || selector === '[data-plan-auth-signup]') return [nodes.get(selector)];
      if (selector === '[data-plan-auth-back]') return [back];
      if (selector === '[data-plan-auth-close]') return [close];
      return [];
    },
  };
  const storage = new Map<string, string>();
  if (storedResume) storage.set('glidehero.plan.resume.v1', storedResume);
  const sessionStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  };
  const location = { assign: vi.fn(), href: `https://glidehero.test/plan/${activePlan.planId}` };
  const history = { replaceState: vi.fn() };
  const confirm = vi.fn(() => true);
  const clipboard = { writeText: vi.fn(async () => undefined) };
  const windowRef = { sessionStorage, location, history, confirm, navigator: { clipboard }, matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) };
  const controller = initializePlanPage({
    documentRef, fetchImpl, windowRef,
    maplibre: { Map: class { constructor() { return map; } }, NavigationControl: class {} },
  });
  const listener = (selector: string, event: string) => nodes.get(selector)?.addEventListener.mock.calls
    .find((call: any[]) => call[0] === event)?.[1];
  return { controller, handlers, map, nodes, priorities, visibilityControls, authDialog, exportDialog, back, close, sessionStorage, location, history, confirm, clipboard, listener };
}

describe('Plan export controller', () => {
  it('calculates map bounds around every point in a route', () => {
    expect(routeBounds([
      { latitude: 40, longitude: -104 },
      { latitude: 39, longitude: -105 },
      { latitude: 39.5, longitude: -103.5 },
    ])).toEqual([[-105, 39], [-103.5, 40]]);
    expect(routeBounds([])).toBeNull();
  });
  it('exports the current turnpoints and generated route without an export key', async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response('task', {
      status: 200,
      headers: { 'content-disposition': 'attachment; filename="glidehero-main-turnpoints.cup"' },
    }));

    const exported = await requestPlanExport({
      fetchImpl, result, variant: 'main-turnpoints', format: 'cup', prefix: 'GH',
    });

    expect(exported.filename).toBe('glidehero-main-turnpoints.cup');
    expect(await exported.blob.text()).toBe('task');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({
      variant: 'main-turnpoints', format: 'cup', prefix: 'GH', anchors: result.anchors, route: result.route,
    });
  });

  it('rejects export attempts without a calculated route', async () => {
    await expect(requestPlanExport({
      fetchImpl: vi.fn(), result: { anchors: result.anchors },
      variant: 'main-turnpoints', format: 'cup', prefix: 'GH',
    })).rejects.toThrow('Calculate a route');
  });

  it('invalidates the authorized export as soon as a turnpoint is dragged', async () => {
    const handlers = new Map<string, (event?: unknown) => void>();
    const source = { setData: vi.fn() };
    const map = {
      addControl: vi.fn(), getSource: vi.fn(() => source), getLayer: vi.fn(), setLayoutProperty: vi.fn(),
      fitBounds: vi.fn(), resize: vi.fn(),
      getCanvas: vi.fn(() => ({ style: {} })), dragPan: { disable: vi.fn(), enable: vi.fn() },
      on: vi.fn((event: string, layerOrHandler: string | ((event?: unknown) => void), handler?: (event?: unknown) => void) => {
        handlers.set(handler ? `${event}:${layerOrHandler}` : event, handler ?? layerOrHandler as (event?: unknown) => void);
      }),
    };
    const controls = new Map<string, { disabled: boolean; textContent: string; addEventListener: ReturnType<typeof vi.fn> }>();
    const control = (selector: string) => {
      const value = { disabled: true, textContent: '', addEventListener: vi.fn() };
      controls.set(selector, value);
      return value;
    };
    const mobilePriority = { value: 'balanced', addEventListener: vi.fn() };
    const priorities = ['shorter', 'balanced', 'thermal'].map((value) => ({
      value, checked: value === 'balanced',
      addEventListener: vi.fn(),
    }));
    const nodes = new Map<string, unknown>([
      ['[data-plan-page]', {}],
      ['[data-plan-map]', { dataset: { mapStyleUrl: 'style', thermalTileUrl: 'tiles' } }],
      ['[data-plan-priority-mobile]', mobilePriority],
      ...[
        '[data-plan-status]', '[data-plan-status-mobile]', '[data-plan-undo]', '[data-plan-delete]', '[data-plan-reset]',
        '[data-plan-fit-route]',
        '[data-plan-direct-distance]', '[data-plan-route-distance]', '[data-plan-extra-distance]',
        '[data-plan-maximum-distance]', '[data-plan-export-open]',
      ].map((selector) => [selector, control(selector)] as const),
    ]);
    const documentRef = {
      querySelector: (selector: string) => nodes.get(selector) ?? null,
      querySelectorAll: (selector: string) => selector === '[data-plan-priority]' ? priorities : [],
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
      actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const controller = initializePlanPage({
      documentRef, fetchImpl,
      maplibre: { Map: class { constructor() { return map; } }, NavigationControl: class {} },
    });
    controller.anchors.push(...result.anchors);
    await controller.calculate();
    expect(controls.get('[data-plan-export-open]')?.disabled).toBe(false);
    expect(controls.get('[data-plan-status-mobile]')?.textContent).toBe('Direct route');

    const fitHandler = controls.get('[data-plan-fit-route]')?.addEventListener.mock.calls.find(([event]) => event === 'click')?.[1];
    fitHandler?.();
    expect(map.fitBounds).toHaveBeenCalledWith([[-105, 39], [-104, 40]], { padding: 64, maxZoom: 11, duration: 500 });

    mobilePriority.value = 'thermal';
    const mobilePriorityHandler = mobilePriority.addEventListener.mock.calls.find(([event]) => event === 'change')?.[1];
    mobilePriorityHandler?.();
    expect(priorities.find((priority) => priority.checked)?.value).toBe('thermal');
    expect(controls.get('[data-plan-export-open]')?.disabled).toBe(true);
    await controller.calculate();
    expect(controls.get('[data-plan-export-open]')?.disabled).toBe(false);

    handlers.get('mousedown:plan-anchors')?.({ features: [{ properties: { index: 0 } }] });
    handlers.get('mousemove')?.({ lngLat: { lat: 39.2, lng: -105.2 } });

    expect(controls.get('[data-plan-export-open]')?.disabled).toBe(true);
    expect(controls.get('[data-plan-route-distance]')?.textContent).toBe('—');
  });

  it('gates a calculated guest export with the auth choice modal', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_100, actualExtraDistanceMeters: 100,
      actualDeviationPercent: 10, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'available',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    await harness.controller.calculate();

    expect(harness.nodes.get('[data-plan-export-open]').disabled).toBe(false);
    harness.listener('[data-plan-export-open]', 'click')?.();
    expect(harness.authDialog.showModal).toHaveBeenCalledOnce();
    expect(harness.exportDialog.showModal).not.toHaveBeenCalled();
    expect(harness.nodes.get('[data-plan-auth-choice]').hidden).toBe(false);
  });

  it('opens both auth form steps from the guest export modal and returns to its choice step', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
      actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    await harness.controller.calculate();
    harness.listener('[data-plan-export-open]', 'click')?.();
    harness.listener('[data-plan-auth-signup]', 'click')?.();
    expect(harness.nodes.get('[data-plan-auth-signup-panel]').hidden).toBe(false);
    expect(harness.nodes.get('[data-plan-auth-choice]').hidden).toBe(true);

    const backHandler = harness.back.addEventListener.mock.calls.find((call: any[]) => call[0] === 'click')?.[1];
    backHandler?.();
    expect(harness.nodes.get('[data-plan-auth-choice]').hidden).toBe(false);
    harness.listener('[data-plan-auth-signin]', 'click')?.();
    expect(harness.nodes.get('[data-plan-auth-signin-panel]').hidden).toBe(false);
  });

  it('shows JSON auth errors inline without losing the guest route', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...result,
        directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
        actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    await harness.controller.calculate();
    harness.listener('[data-plan-export-open]', 'click')?.();
    const originalFormData = globalThis.FormData;
    vi.stubGlobal('FormData', class {
      entries: [string, string][];
      constructor(form: { fields: [string, string][] }) { this.entries = form.fields; }
      forEach(callback: (value: string, key: string) => void) { this.entries.forEach(([key, value]) => callback(value, key)); }
    });
    try {
      await harness.listener('[data-plan-login-form]', 'submit')?.({ preventDefault: vi.fn() });
    } finally {
      vi.stubGlobal('FormData', originalFormData);
    }

    expect(fetchImpl).toHaveBeenCalledWith('/login', expect.objectContaining({
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'email=pilot%40example.com&password=secret',
    }));
    expect(harness.nodes.get('[data-plan-login-status]').textContent).toBe('Email or password is incorrect.');
    expect(harness.controller.anchors).toEqual(result.anchors);
    expect(harness.location.assign).not.toHaveBeenCalled();
  });

  it('saves the Plan state after modal signup success and reloads Plan', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...result,
        directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
        actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    await harness.controller.calculate();
    harness.listener('[data-plan-export-open]', 'click')?.();
    const originalFormData = globalThis.FormData;
    vi.stubGlobal('FormData', class {
      entries: [string, string][];
      constructor(form: { fields: [string, string][] }) { this.entries = form.fields; }
      forEach(callback: (value: string, key: string) => void) { this.entries.forEach(([key, value]) => callback(value, key)); }
    });
    try {
      await harness.listener('[data-plan-signup-form]', 'submit')?.({ preventDefault: vi.fn() });
    } finally {
      vi.stubGlobal('FormData', originalFormData);
    }

    const saved = JSON.parse(harness.sessionStorage.setItem.mock.calls[0]![1]);
    expect(saved).toMatchObject({
      version: 1, anchors: result.anchors, priority: 'balanced', thermalVisible: true,
      mapPosition: { longitude: -104.5, latitude: 39.5, zoom: 8 }, resumeIntent: 'export',
    });
    expect(harness.location.assign).toHaveBeenCalledWith('/plan');
  });

  it('restores an export intent, recalculates, and reopens export when authorized', async () => {
    const storedResume = JSON.stringify({
      version: 1, anchors: result.anchors, priority: 'thermal', thermalVisible: false,
      mapPosition: { longitude: -104.7, latitude: 39.7, zoom: 9 }, resumeIntent: 'export',
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
      actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: true, fetchImpl, storedResume });

    await harness.handlers.get('load')?.();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/v1/plan/route', expect.anything()));
    await vi.waitFor(() => expect(harness.exportDialog.showModal).toHaveBeenCalledOnce());

    expect(harness.controller.anchors).toEqual(result.anchors);
    expect(harness.priorities.find((priority) => priority.checked)?.value).toBe('thermal');
    expect(harness.map.setCenter).toHaveBeenCalledWith([-104.7, 39.7]);
    expect(harness.map.setZoom).toHaveBeenCalledWith(9);
    expect(harness.exportDialog.showModal).toHaveBeenCalledOnce();
    expect(harness.sessionStorage.removeItem).toHaveBeenCalledWith('glidehero.plan.resume.v1');
  });

  it('discards the removed collect-cells resume intent', async () => {
    const storedResume = JSON.stringify({
      version: 1, anchors: result.anchors, priority: 'balanced', thermalVisible: true,
      mapPosition: { longitude: -104.7, latitude: 39.7, zoom: 9 }, resumeIntent: 'collect-cells',
    });
    const fetchImpl = vi.fn();
    const harness = makePlanHarness({ authenticated: true, fetchImpl, storedResume });

    await harness.handlers.get('load')?.();

    expect(harness.controller.anchors).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.sessionStorage.removeItem).toHaveBeenCalledWith('glidehero.plan.resume.v1');
  });
});

describe('Saved Plan controller', () => {
  it('keeps the Save and Share accordion sections mutually exclusive', () => {
    const harness = makePlanHarness();
    const saveSection = harness.nodes.get('[data-plan-save-section]');
    const shareSection = harness.nodes.get('[data-plan-share-section]');

    shareSection.open = true;
    harness.listener('[data-plan-share-section]', 'toggle')?.();
    expect(saveSection.open).toBe(false);

    shareSection.open = false;
    saveSection.open = true;
    harness.listener('[data-plan-save-section]', 'toggle')?.();
    expect(shareSection.open).toBe(false);
  });

  it('renders an active Plan snapshot without recalculating it', async () => {
    const fetchImpl = vi.fn();
    const harness = makePlanHarness({ fetchImpl, bootstrap: { savedPlans: [], activePlan } });

    await harness.handlers.get('load')?.();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.controller.anchors).toEqual(result.anchors);
    expect(harness.nodes.get('[data-plan-name]').value).toBe('Boulder triangle');
    expect(harness.nodes.get('[data-plan-route-distance]').textContent).toBe('1.1 km');
    expect(harness.nodes.get('[data-plan-save]').disabled).toBe(false);
  });

  it('creates a ready named Plan and replaces the browser URL', async () => {
    const created = { ...activePlan, name: 'Morning route' };
    const fetchImpl = vi.fn(async (input: string) => input === '/v1/plan/route'
      ? new Response(JSON.stringify({ ...generatedRoute, anchors: result.anchors }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ plan: created }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    await harness.controller.calculate();
    harness.nodes.get('[data-plan-name]').value = '  Morning route  ';
    harness.listener('[data-plan-name]', 'input')?.();

    await harness.listener('[data-plan-save]', 'click')?.();

    expect(fetchImpl).toHaveBeenCalledWith('/v1/plans', expect.objectContaining({ method: 'POST' }));
    const createCall = fetchImpl.mock.calls.find(([input]) => input === '/v1/plans') as unknown as [string, RequestInit];
    const body = JSON.parse(String(createCall[1].body));
    expect(body).toMatchObject({ name: 'Morning route', turnpoints: result.anchors, routingPriority: 'balanced' });
    expect(body.generatedRoute).not.toHaveProperty('anchors');
    expect(harness.history.replaceState).toHaveBeenCalledWith({}, '', `/plan/${activePlan.planId}`);
    expect(fetchImpl).toHaveBeenCalledWith(`/v1/plans/${activePlan.planId}/visibility`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ visibility: 'private', sharedGroupId: null }),
    }));
    expect(harness.nodes.get('[data-plan-mutation-status]').textContent).toBe('Plan saved privately.');

    harness.nodes.get('[data-plan-name]').value = 'Morning route changed';
    harness.listener('[data-plan-name]', 'input')?.();
    expect(harness.nodes.get('[data-plan-mutation-status]').textContent).toBe('');
  });

  it('updates a name without recalculating the stored route', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ plan: { ...activePlan, name: 'Renamed' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const harness = makePlanHarness({ fetchImpl, bootstrap: { savedPlans: [], activePlan } });
    await harness.handlers.get('load')?.();
    harness.nodes.get('[data-plan-name]').value = 'Renamed';
    harness.listener('[data-plan-name]', 'input')?.();

    await harness.listener('[data-plan-save]', 'click')?.();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(`/v1/plans/${activePlan.planId}`, expect.objectContaining({ method: 'PATCH' }));
    expect(fetchImpl).toHaveBeenCalledWith(`/v1/plans/${activePlan.planId}/visibility`, expect.objectContaining({ method: 'PATCH' }));
  });

  it('asks before clearing a dirty Plan and starts blank after confirmation', async () => {
    const harness = makePlanHarness({ bootstrap: { savedPlans: [], activePlan } });
    await harness.handlers.get('load')?.();
    harness.nodes.get('[data-plan-name]').value = 'Changed';
    harness.listener('[data-plan-name]', 'input')?.();
    harness.confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);

    harness.listener('[data-plan-new]', 'click')?.();
    expect(harness.controller.anchors).toEqual(result.anchors);
    harness.listener('[data-plan-new]', 'click')?.();

    expect(harness.controller.anchors).toEqual([]);
    expect(harness.nodes.get('[data-plan-name]').value).toBe('');
    expect(harness.history.replaceState).toHaveBeenCalledWith({}, '', '/plan');
  });

  it('asks before navigating from a dirty Plan to another saved Plan', async () => {
    const harness = makePlanHarness({ bootstrap: { savedPlans: [], activePlan } });
    await harness.handlers.get('load')?.();
    harness.nodes.get('[data-plan-name]').value = 'Changed';
    harness.listener('[data-plan-name]', 'input')?.();
    const link = { href: '/plan/another', closest: vi.fn(() => null) };
    const event = { target: { closest: vi.fn((selector: string) => selector === '[data-plan-open]' ? link : null) }, preventDefault: vi.fn() };
    harness.confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);

    harness.listener('[data-plan-saved-list]', 'click')?.(event);
    expect(harness.location.assign).not.toHaveBeenCalled();
    harness.listener('[data-plan-saved-list]', 'click')?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(harness.location.assign).toHaveBeenCalledWith('/plan/another');
  });

  it('preserves the name through guest authentication without automatically saving', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...generatedRoute }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    await harness.controller.calculate();
    harness.nodes.get('[data-plan-name]').value = 'Guest route';
    harness.listener('[data-plan-name]', 'input')?.();
    harness.listener('[data-plan-save]', 'click')?.();
    const originalFormData = globalThis.FormData;
    vi.stubGlobal('FormData', class {
      entries: [string, string][];
      constructor(form: { fields: [string, string][] }) { this.entries = form.fields; }
      forEach(callback: (value: string, key: string) => void) { this.entries.forEach(([key, value]) => callback(value, key)); }
    });
    try {
      await harness.listener('[data-plan-login-form]', 'submit')?.({ preventDefault: vi.fn() });
    } finally {
      vi.stubGlobal('FormData', originalFormData);
    }

    const saved = JSON.parse(harness.sessionStorage.setItem.mock.calls[0]![1]);
    expect(saved).toMatchObject({
      name: 'Guest route', resumeIntent: 'save', anchors: result.anchors,
      visibility: 'private', sharedGroupId: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(harness.location.assign).toHaveBeenCalledWith('/plan');
  });

  it('deletes the active Plan from its saved row and clears to a blank Plan', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const harness = makePlanHarness({ fetchImpl, bootstrap: { savedPlans: [], activePlan } });
    await harness.handlers.get('load')?.();
    const savedItem = { remove: vi.fn() };
    harness.nodes.get('[data-plan-saved-list]').querySelector.mockImplementation((selector: string) => (
      selector === `[data-plan-list-item="${activePlan.planId}"]` ? savedItem : null
    ));
    const deleteButton = { dataset: { planDeleteSavedId: activePlan.planId } };
    const event = { target: { closest: vi.fn((selector: string) => selector === '[data-plan-delete-saved-id]' ? deleteButton : null) }, preventDefault: vi.fn() };

    await harness.listener('[data-plan-saved-list]', 'click')?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.confirm).toHaveBeenCalledWith('Delete this Plan?');
    expect(fetchImpl).toHaveBeenCalledWith(`/v1/plans/${activePlan.planId}`, {
      method: 'DELETE', headers: { accept: 'application/json' },
    });
    expect(harness.controller.anchors).toEqual([]);
    expect(savedItem.remove).toHaveBeenCalledOnce();
    expect(harness.nodes.get('[data-plan-name]').value).toBe('');
    expect(harness.history.replaceState).toHaveBeenCalledWith({}, '', '/plan');
  });

  it('deletes an inactive saved Plan without clearing the active Plan', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const harness = makePlanHarness({ fetchImpl, bootstrap: { savedPlans: [], activePlan } });
    await harness.handlers.get('load')?.();
    const inactiveId = '00000000-0000-4000-8000-000000000999';
    const savedItem = { remove: vi.fn() };
    harness.nodes.get('[data-plan-saved-list]').querySelector.mockImplementation((selector: string) => (
      selector === `[data-plan-list-item="${inactiveId}"]` ? savedItem : null
    ));
    const deleteButton = { dataset: { planDeleteSavedId: inactiveId } };
    const event = { target: { closest: vi.fn((selector: string) => selector === '[data-plan-delete-saved-id]' ? deleteButton : null) }, preventDefault: vi.fn() };

    await harness.listener('[data-plan-saved-list]', 'click')?.(event);

    expect(fetchImpl).toHaveBeenCalledWith(`/v1/plans/${inactiveId}`, {
      method: 'DELETE', headers: { accept: 'application/json' },
    });
    expect(savedItem.remove).toHaveBeenCalledOnce();
    expect(harness.controller.anchors).toEqual(result.anchors);
    expect(harness.history.replaceState).not.toHaveBeenCalledWith({}, '', '/plan');
    expect(harness.nodes.get('[data-plan-mutation-status]').textContent).toBe('Plan deleted.');
  });

  it('saves visibility with the Plan and copies its link', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ plan: { ...activePlan, visibility: 'link' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const harness = makePlanHarness({ fetchImpl, bootstrap: { savedPlans: [], activePlan, groupOptions: [{ id: 'group-1', name: 'Front Range' }] } });
    harness.visibilityControls.forEach((control) => { control.checked = control.value === 'link'; });

    harness.visibilityControls[0].addEventListener.mock.calls.find((call: any[]) => call[0] === 'change')?.[1]?.();
    await harness.handlers.get('load')?.();
    await harness.listener('[data-plan-save]', 'click')?.();
    await harness.listener('[data-plan-sharing-copy]', 'click')?.();

    expect(fetchImpl).toHaveBeenCalledWith(`/v1/plans/${activePlan.planId}/visibility`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ visibility: 'link', sharedGroupId: null }),
    }));
    expect(harness.nodes.get('[data-plan-sharing-link]').hidden).toBe(false);
    expect(harness.clipboard.writeText).toHaveBeenCalledWith(`https://glidehero.test/plan/${activePlan.planId}`);
    expect(harness.nodes.get('[data-plan-sharing-status]').textContent).toBe('Link copied.');
  });

  it('keeps a shared non-owner Plan read-only while retaining view controls', async () => {
    const readOnlyPlan = { ...activePlan, isOwner: false, visibility: 'link' };
    const fetchImpl = vi.fn();
    const harness = makePlanHarness({ fetchImpl, bootstrap: { savedPlans: [], activePlan: readOnlyPlan, groupOptions: [] } });
    await harness.handlers.get('load')?.();

    harness.handlers.get('click')?.({ point: {}, lngLat: { lat: 41, lng: -103 } });
    harness.handlers.get('mousedown:plan-anchors')?.({ features: [{ properties: { index: 0 } }] });
    harness.priorities[0].value = 'shorter';
    harness.priorities[0].addEventListener.mock.calls.find((call: any[]) => call[0] === 'change')?.[1]?.();
    await harness.listener('[data-plan-save]', 'click')?.();
    const deleteButton = { dataset: { planDeleteSavedId: activePlan.planId } };
    await harness.listener('[data-plan-saved-list]', 'click')?.({
      target: { closest: (selector: string) => selector === '[data-plan-delete-saved-id]' ? deleteButton : null },
      preventDefault: vi.fn(),
    });

    expect(harness.controller.anchors).toEqual(result.anchors);
    expect(harness.map.dragPan.disable).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.nodes.get('[data-plan-save]').disabled).toBe(true);
    expect(harness.nodes.get('[data-plan-export-open]').disabled).toBe(false);
    harness.listener('[data-plan-fit-route]', 'click')?.();
    expect(harness.map.fitBounds).toHaveBeenCalled();
  });
});
