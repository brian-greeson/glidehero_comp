import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeGlobalDashboard } from '../../public/scripts/globalDashboard.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializePersonalDashboard } from '../../public/scripts/personalDashboard.js';

function element(): any {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Array<(event?: any) => any>>();
  const classes = new Set<string>();
  const node = {
    hidden: true,
    textContent: '',
    className: '',
    dataset: {} as Record<string, string>,
    children: [] as any[],
    offsetWidth: 100,
    offsetHeight: 40,
    classList: {
      add(className: string) {
        classes.add(className);
      },
      toggle(className: string, force?: boolean) {
        if (force ?? !classes.has(className)) classes.add(className);
        else classes.delete(className);
      },
      contains(className: string) {
        return classes.has(className);
      },
    },
    style: {
      left: '',
      top: '',
      setProperty() {},
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    addEventListener(name: string, listener: (event?: any) => any) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    async emit(name: string, event?: any) {
      await Promise.all((listeners.get(name) ?? []).map((listener) => listener(event)));
    },
    click() {
      return node.emit('click');
    },
    append(...children: any[]) {
      node.children.push(...children);
    },
    replaceChildren(...children: any[]) {
      node.children = children;
    },
  };
  return node;
}

function mapHarness() {
  let loadHandler: (() => Promise<void>) | undefined;
  const moveHandlers: Array<() => void> = [];
  let errorHandler: (() => void) | undefined;
  let clickHandler: ((event: any) => Promise<void>) | undefined;
  let mousemoveHandler: ((event: any) => Promise<void>) | undefined;
  let mouseleaveHandler: (() => void) | undefined;
  let idleHandler: (() => void) | undefined;
  const layers = new Set<string>();
  let viewport = { west: -107, east: -105 };
  let renderedFeatures: any[] = [];
  const sources = new Map<string, any>();
  const map = {
    addSource: vi.fn((id: string, source: any) => sources.set(id, {
      ...source,
      setData: vi.fn(),
      setTiles: vi.fn(),
    })),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    addControl: vi.fn(),
    getSource: vi.fn((id: string) => sources.get(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    setFilter: vi.fn(),
    setLayoutProperty: vi.fn(),
    setPaintProperty: vi.fn(),
    querySourceFeatures: vi.fn(() => []),
    getCanvas: vi.fn(() => ({ style: { cursor: '' } })),
    queryRenderedFeatures: vi.fn(() => renderedFeatures),
    getBounds: () => ({
      getWest: () => viewport.west,
      getSouth: () => 39,
      getEast: () => viewport.east,
      getNorth: () => 41,
    }),
    once: vi.fn((event: string, handler: () => Promise<void>) => {
      if (event === 'load') loadHandler = handler;
      if (event === 'error') errorHandler = handler;
    }),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'moveend') moveHandlers.push(handler);
      if (event === 'click') clickHandler = handler;
      if (event === 'mousemove') mousemoveHandler = handler;
      if (event === 'mouseleave') mouseleaveHandler = handler;
      if (event === 'idle') idleHandler = handler;
    }),
  };
  return {
    map,
    maplibre: {
      Map: vi.fn(function Map() {
        return map;
      }),
      NavigationControl: vi.fn(function NavigationControl() {}),
    },
    load: async () => loadHandler?.(),
    move(next = viewport) {
      viewport = next;
      moveHandlers.forEach((handler) => handler());
    },
    error() {
      errorHandler?.();
    },
    click(point = { x: 50, y: 80 }) {
      return clickHandler?.({ point });
    },
    hover(point = { x: 50, y: 80 }) {
      return mousemoveHandler?.({ point });
    },
    leave() {
      mouseleaveHandler?.();
    },
    idle() {
      idleHandler?.();
    },
    setRenderedFeatures(features: any[]) {
      renderedFeatures = features;
    },
  };
}

function pilot(userId: string, displayName = userId, claimedCellCount = 3) {
  return {
    userId,
    displayName,
    rank: 1,
    claimedCellCount,
    exclusiveCellCount: claimedCellCount,
    sharedCellCount: 0,
    claimedAreaSquareMeters: claimedCellCount * 250_000,
  };
}

function globalDashboardHarness(fetchImpl: any, search = '') {
  const map = mapHarness();
  const mapElement = element();
  mapElement.dataset = {
    mapStyleUrl: 'map-style',
    currentUserId: 'current-user',
    territoryColor: '#1769AA',
    territoryTileMinimumZoom: '4',
    territoryTileMaximumZoom: '14',
  };
  mapElement.clientWidth = 600;
  const allTime = element();
  allTime.dataset.competitionPeriodOption = 'all-time';
  const currentMonth = element();
  currentMonth.dataset.competitionPeriodOption = 'current-month';
  const elements = new Map<string, any>([
    ['[data-competition-coverage]', element()],
    ['[data-territory-map]', mapElement],
    ['[data-map-empty-state]', element()],
    ['[data-territory-leaderboard]', element()],
    ['[data-territory-allpilots]', element()],
    ['[data-territory-status]', element()],
    ['[data-territory-list]', element()],
    ['[data-territory-current-pilot]', element()],
    ['[data-territory-cell-popup]', element()],
    ['[data-current-month-option]', currentMonth],
  ]);
  const documentRef = {
    createElement: () => element(),
    querySelector: (selector: string) => elements.get(selector) ?? null,
    querySelectorAll: (selector: string) =>
      selector === '[data-competition-period-option]' ? [allTime, currentMonth] : [],
  };
  const historyRef = { replaceState: vi.fn() };
  initializeGlobalDashboard({
    documentRef,
    maplibre: map.maplibre,
    fetchImpl,
    locationRef: { pathname: '/global', search },
    historyRef,
    now: () => new Date(2026, 6, 17),
  });
  return {
    ...map,
    elements,
    allTime,
    currentMonth,
    historyRef,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Personal dashboard controller', () => {
  it('loads Personal territory and refreshes stats after viewport movement', async () => {
    const harness = mapHarness();
    const mapElement = {
      dataset: {
        mapStyleUrl: 'map-style',
        territoryColor: '#1769AA',
        territoryTileMinimumZoom: '4',
        territoryTileMaximumZoom: '14',
      },
    };
    const emptyState = element();
    const statsCard = element();
    const claimedArea = element();
    const flights = element();
    const documentRef = {
      createElement: element,
      querySelector(selector: string) {
        return (
          new Map<string, any>([
            ['[data-dashboard-map]', mapElement],
            ['[data-map-empty-state]', emptyState],
            ['[data-personal-stats]', statsCard],
            ['[data-personal-claimed-area]', claimedArea],
            ['[data-personal-flights]', flights],
          ]).get(selector) ?? null
        );
      },
    };
    const fetchImpl = vi.fn(async (url: string) => {
      return new Response(
        JSON.stringify({
          claimedCellCount: 1,
          claimedAreaSquareMeters: 1_000_000,
          flightCount: 1,
        }),
        { status: 200 },
      );
    });

    initializePersonalDashboard({ documentRef, maplibre: harness.maplibre, fetchImpl });
    harness.move({ west: -106, east: -104 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await harness.load();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/v1/personal-stats?west=-106&south=39&east=-104&north=41',
    ]);
    expect(harness.map.addSource).toHaveBeenCalledWith('personal-territory', {
      type: 'vector',
      tiles: ['/v1/personal-territory/tiles/{z}/{x}/{y}.mvt'],
      minzoom: 4,
      maxzoom: 14,
    });
    expect(claimedArea.textContent).toBe('1 km²');

    harness.move({ west: -105, east: -103 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/v1/personal-stats?west=-105');
  });
});

describe('Global dashboard controller', () => {
  it('loads competition territory and refreshes viewport results on moveend', async () => {
    const harness = mapHarness();
    const mapElement = {
      dataset: {
        mapStyleUrl: 'map-style',
        currentUserId: 'current-user',
        territoryColor: '#1769AA',
        territoryTileMinimumZoom: '4',
        territoryTileMaximumZoom: '14',
      },
    };
    const emptyState = element();
    const elements = new Map<string, any>([
      ['[data-competition-coverage]', element()],
      ['[data-territory-map]', mapElement],
      ['[data-map-empty-state]', emptyState],
      ['[data-territory-leaderboard]', element()],
      ['[data-territory-allpilots]', element()],
      ['[data-territory-status]', element()],
      ['[data-territory-list]', element()],
      ['[data-territory-current-pilot]', element()],
      ['[data-territory-cell-popup]', element()],
    ]);
    const documentRef = {
      createElement: () => element(),
      querySelector: (selector: string) => elements.get(selector) ?? null,
      querySelectorAll: () => [],
    };
    const leaderboard = {
      leaders: [],
      currentPilot: null,
    };
    const fetchImpl = vi.fn(async (url: string) => {
      return new Response(JSON.stringify(leaderboard), { status: 200 });
    });

    initializeGlobalDashboard({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl,
      locationRef: { pathname: '/global', search: '' },
      historyRef: { replaceState: vi.fn() },
    });
    await harness.load();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/v1/competition-leaderboard?west=-107'),
    ]);
    expect(harness.map.addSource).toHaveBeenCalledWith('competition-coverage', {
      type: 'vector',
      tiles: ['/v1/competition-territory/tiles/{z}/{x}/{y}.mvt'],
      minzoom: 4,
      maxzoom: 14,
    });
    harness.idle();
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.textContent).toBe('No territory for this zoom level or area.');

    harness.move({ west: -106, east: -104 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('/v1/competition-leaderboard?west=-106');
  });

  it('selects a pilot and returns to the overview', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      return jsonResponse({ leaders: [pilot('pilot-one', 'Pilot One')], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();

    const list = harness.elements.get('[data-territory-list]');
    const overview = harness.elements.get('[data-territory-allpilots]');
    const source = harness.map.getSource('competition-coverage');
    source.setTiles.mockClear();
    await list.children[0].click();
    expect(source.setTiles).toHaveBeenCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?pilot=pilot-one',
    ]);
    expect(list.children[0].getAttribute('aria-pressed')).toBe('true');
    expect(overview.getAttribute('aria-pressed')).toBe('false');

    await overview.click();
    expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt',
    ]);
    expect(list.children[0].getAttribute('aria-pressed')).toBe('false');
    expect(overview.getAttribute('aria-pressed')).toBe('true');
  });

  it('resets pilot selection and refreshes territory and rankings when the period changes', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      return jsonResponse({ leaders: [pilot('pilot-one')], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    const source = harness.map.getSource('competition-coverage');
    source.setTiles.mockClear();
    const list = harness.elements.get('[data-territory-list]');
    const overview = harness.elements.get('[data-territory-allpilots]');
    await list.children[0].click();
    expect(source.setTiles).toHaveBeenCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?pilot=pilot-one',
    ]);

    await harness.currentMonth.click();

    expect(harness.historyRef.replaceState).toHaveBeenCalledWith(null, '', '/global?month=2026-07');
    expect(overview.getAttribute('aria-pressed')).toBe('true');
    expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07',
    ]);
    expect(requestedUrls).toContain(
      '/v1/competition-leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41',
    );
    expect(source.setTiles.mock.calls.at(-1)?.[0]?.[0]).not.toContain('pilot=pilot-one');
  });

  it('returns to overview when the selected pilot leaves the refreshed leaderboard', async () => {
    let leaderboard = { leaders: [pilot('pilot-one')], currentPilot: null };
    const fetchImpl = vi.fn(async (url: string) => {
      return jsonResponse(leaderboard);
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    const source = harness.map.getSource('competition-coverage');
    source.setTiles.mockClear();
    await harness.elements.get('[data-territory-list]').children[0].click();
    expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?pilot=pilot-one',
    ]);

    leaderboard = { leaders: [], currentPilot: null };
    harness.move({ west: -106, east: -104 });

    await vi.waitFor(() => expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt',
    ]));
    expect(harness.elements.get('[data-territory-allpilots]').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(harness.elements.get('[data-territory-list]').children).toHaveLength(0);
  });

  it('renders cell claimants and ignores a stale popup response after dismissal', async () => {
    const firstClaimants = deferred<Response>();
    let claimantRequestCount = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('/v1/competition-cells/')) {
        claimantRequestCount += 1;
        if (claimantRequestCount === 1) return firstClaimants.promise;
        return jsonResponse({ claimants: [{ userId: 'pilot-one', displayName: 'Pilot One' }] });
      }
      return jsonResponse({ leaders: [], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    const popup = harness.elements.get('[data-territory-cell-popup]');
    harness.setRenderedFeatures([{ properties: {
      cellId: '500:12:-3', x: 12, y: -3, claimantCount: 1, isShared: false, pilotUserId: 'pilot-one',
    } }]);
    const staleClick = harness.click({ x: 50, y: 80 });
    await vi.waitFor(() => expect(claimantRequestCount).toBe(1));

    harness.setRenderedFeatures([]);
    await harness.click({ x: 70, y: 90 });
    firstClaimants.resolve(
      jsonResponse({ claimants: [{ userId: 'stale', displayName: 'Stale Pilot' }] }),
    );
    await staleClick;
    expect(popup.hidden).toBe(true);
    expect(popup.children).toHaveLength(0);

    harness.setRenderedFeatures([{ properties: {
      cellId: '500:12:-3', x: 12, y: -3, claimantCount: 1, isShared: false, pilotUserId: 'pilot-one',
    } }]);
    await harness.click({ x: 50, y: 80 });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/v1/competition-cells/12/-3/claimants',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(popup.hidden).toBe(false);
    expect(popup.children[0].textContent).toBe('Claimed by');
    expect(popup.children[1].children[0].textContent).toBe('Pilot One');
    expect(popup.style.left).toBe('58px');
    expect(popup.dataset.placement).toBe('above');

    harness.setRenderedFeatures([]);
    await harness.click();
    expect(popup.hidden).toBe(true);
  });

  it('shows exclusive-cell information on hover and clears it on leave', async () => {
    let claimantRequestCount = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('/v1/competition-cells/')) {
        claimantRequestCount += 1;
        return jsonResponse({ claimants: [{ userId: 'pilot-one', displayName: 'Pilot One' }] });
      }
      return jsonResponse({ leaders: [], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    harness.setRenderedFeatures([
      {
        properties: {
          cellId: '500:12:-3',
          x: 12,
          y: -3,
          claimantCount: 1,
          isShared: false,
          pilotUserId: 'pilot-one',
        },
      },
    ]);

    await harness.hover({ x: 50, y: 80 });
    expect(harness.map.setFilter).toHaveBeenCalledWith(
      'competition-territory-hover-outline',
      ['==', ['get', 'cellId'], '500:12:-3'],
    );
    expect(harness.elements.get('[data-territory-cell-popup]').children[1].children[0].textContent)
      .toBe('Pilot One');

    await harness.hover({ x: 55, y: 85 });
    expect(claimantRequestCount).toBe(1);
    harness.leave();
    expect(harness.elements.get('[data-territory-cell-popup]').hidden).toBe(true);
    expect(harness.map.setFilter).toHaveBeenLastCalledWith(
      'competition-territory-hover-outline',
      ['==', ['get', 'cellId'], ''],
    );
  });

  it('does not add hover interaction to shared cells', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      return jsonResponse({ leaders: [], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    harness.map.setFilter.mockClear();
    harness.setRenderedFeatures([
      {
        properties: {
          cellId: '500:12:-3',
          x: 12,
          y: -3,
          claimantCount: 2,
          isShared: true,
        },
      },
    ]);

    await harness.hover();

    expect(fetchImpl.mock.calls.some(([url]) => url.startsWith('/v1/competition-cells/'))).toBe(
      false,
    );
    expect(harness.elements.get('[data-territory-cell-popup]').hidden).toBe(true);
    expect(harness.map.setFilter).toHaveBeenLastCalledWith(
      'competition-territory-hover-outline',
      ['==', ['get', 'cellId'], ''],
    );
  });

  it('ignores an exclusive-cell response after the pointer moves onto a shared cell', async () => {
    const claimants = deferred<Response>();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('/v1/competition-cells/')) return claimants.promise;
      return jsonResponse({ leaders: [], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    harness.setRenderedFeatures([
      {
        properties: {
          cellId: '500:12:-3',
          x: 12,
          y: -3,
          claimantCount: 1,
          isShared: false,
          pilotUserId: 'pilot-one',
        },
      },
    ]);
    const exclusiveHover = harness.hover();
    await vi.waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([url]) => url.startsWith('/v1/competition-cells/')),
      ).toBe(true),
    );

    harness.setRenderedFeatures([
      {
        properties: {
          cellId: '500:13:-3',
          x: 13,
          y: -3,
          claimantCount: 2,
          isShared: true,
        },
      },
    ]);
    await harness.hover();
    claimants.resolve(
      jsonResponse({ claimants: [{ userId: 'pilot-one', displayName: 'Pilot One' }] }),
    );
    await exclusiveHover;

    expect(harness.elements.get('[data-territory-cell-popup]').hidden).toBe(true);
    expect(harness.elements.get('[data-territory-cell-popup]').children).toHaveLength(0);
  });

  it('shows distinct ranking and map error states without fetching GeoJSON territory', async () => {
    const fetchImpl = vi.fn(async (_url: string) => jsonResponse({}, 502));
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();

    expect(fetchImpl.mock.calls.some(([url]) => url.includes('competition-territory'))).toBe(false);
    expect(harness.elements.get('[data-territory-status]').textContent).toBe(
      'Unable to update coverage rankings.',
    );
    expect(harness.elements.get('[data-territory-leaderboard]').getAttribute('aria-busy')).toBe(
      null,
    );

    harness.error();
    expect(harness.elements.get('[data-map-empty-state]').textContent).toBe(
      'Map unavailable. Check your connection and try again.',
    );
  });
});
