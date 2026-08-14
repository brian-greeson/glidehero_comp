import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { initializePlanPage, requestPlanExport, routeBounds } from '../../public/scripts/app-ui/plan.js';

const result = {
  exportToken: '00000000-0000-4000-8000-000000000099',
  anchors: [{ latitude: 39, longitude: -105 }, { latitude: 40, longitude: -104 }],
  route: [{ latitude: 39, longitude: -105 }, { latitude: 39.5, longitude: -104.6 }, { latitude: 40, longitude: -104 }],
};

function makePlanHarness({
  authenticated = true,
  fetchImpl = vi.fn(),
  storedResume = null as string | null,
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
  const nodes = new Map<string, any>([
    ['[data-plan-page]', { dataset: { planAuthenticated: String(authenticated) } }],
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
    ...[
      '[data-plan-status]', '[data-plan-status-mobile]', '[data-plan-undo]', '[data-plan-delete]', '[data-plan-reset]',
      '[data-plan-fit-route]', '[data-plan-direct-distance]', '[data-plan-route-distance]', '[data-plan-extra-distance]',
      '[data-plan-maximum-distance]', '[data-plan-direct-cells]', '[data-plan-enclosed-cells]', '[data-plan-new-cells]',
      '[data-plan-export-open]', '[data-plan-collect-cells]',
    ].map((selector) => [selector, node()] as const),
  ]);
  const back = node();
  const close = node();
  const documentRef = {
    querySelector: (selector: string) => nodes.get(selector) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-plan-priority]') return priorities;
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
  const location = { assign: vi.fn() };
  const windowRef = { sessionStorage, location, matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })) };
  const controller = initializePlanPage({
    documentRef, fetchImpl, windowRef,
    maplibre: { Map: class { constructor() { return map; } }, NavigationControl: class {} },
  });
  const listener = (selector: string, event: string) => nodes.get(selector)?.addEventListener.mock.calls
    .find((call: any[]) => call[0] === event)?.[1];
  return { controller, handlers, map, nodes, priorities, authDialog, exportDialog, back, close, sessionStorage, location, listener };
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
  it('requests a server-authorized export without resubmitting route coordinates', async () => {
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
      variant: 'main-turnpoints', format: 'cup', prefix: 'GH', exportToken: result.exportToken,
    });
  });

  it('rejects export attempts without a server authorization', async () => {
    await expect(requestPlanExport({
      fetchImpl: vi.fn(), result: { anchors: result.anchors, route: result.route },
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
        '[data-plan-maximum-distance]', '[data-plan-direct-cells]', '[data-plan-enclosed-cells]',
        '[data-plan-new-cells]', '[data-plan-export-open]',
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
      claims: { direct: [], enclosed: [], newPersonal: [] },
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

  it('gates a calculated guest export with the auth choice modal and accepts null personal claims', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result, exportToken: undefined,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_100, actualExtraDistanceMeters: 100,
      actualDeviationPercent: 10, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'available',
      claims: { direct: [], enclosed: [], newPersonal: null },
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

  it('opens both auth form steps from the guest modal and returns to its choice step', () => {
    const harness = makePlanHarness({ authenticated: false });
    harness.listener('[data-plan-collect-cells]', 'click')?.();
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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
    }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    harness.listener('[data-plan-collect-cells]', 'click')?.();
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
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    const harness = makePlanHarness({ authenticated: false, fetchImpl });
    harness.controller.anchors.push(...result.anchors);
    harness.listener('[data-plan-collect-cells]', 'click')?.();
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
      mapPosition: { longitude: -104.5, latitude: 39.5, zoom: 8 }, resumeIntent: 'collect-cells',
    });
    expect(harness.location.assign).toHaveBeenCalledWith('/plan');
  });

  it.each([
    ['export', 1],
    ['collect-cells', 0],
  ])('restores a %s intent, recalculates, and only reopens export when authorized', async (resumeIntent, exportOpens) => {
    const storedResume = JSON.stringify({
      version: 1, anchors: result.anchors, priority: 'thermal', thermalVisible: false,
      mapPosition: { longitude: -104.7, latitude: 39.7, zoom: 9 }, resumeIntent,
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...result,
      directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualExtraDistanceMeters: 0,
      actualDeviationPercent: 0, maximumRouteDistanceMeters: 1_250, thermalCoverage: 'unavailable',
      claims: { direct: [], enclosed: [], newPersonal: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const harness = makePlanHarness({ authenticated: true, fetchImpl, storedResume });

    await harness.handlers.get('load')?.();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('/v1/plan/route', expect.anything()));
    if (resumeIntent === 'export') {
      await vi.waitFor(() => expect(harness.exportDialog.showModal).toHaveBeenCalledOnce());
    }

    expect(harness.controller.anchors).toEqual(result.anchors);
    expect(harness.priorities.find((priority) => priority.checked)?.value).toBe('thermal');
    expect(harness.map.setCenter).toHaveBeenCalledWith([-104.7, 39.7]);
    expect(harness.map.setZoom).toHaveBeenCalledWith(9);
    expect(harness.exportDialog.showModal).toHaveBeenCalledTimes(exportOpens);
    expect(harness.sessionStorage.removeItem).toHaveBeenCalledWith('glidehero.plan.resume.v1');
  });
});
