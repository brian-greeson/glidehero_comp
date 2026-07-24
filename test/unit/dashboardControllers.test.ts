import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeArenaSearch } from '../../public/scripts/arenaSearch.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeCompetitionCoverage } from '../../public/scripts/competitionCoverageController.js';
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
    fitBounds: vi.fn(),
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
    getCenter: () => ({ lat: 39.2, lng: -106.2 }),
    getZoom: () => 7,
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

function globalDashboardHarness(fetchImpl: any, search = '', dataset: Record<string, string> = {}) {
  const map = mapHarness();
  const mapElement = element();
  mapElement.dataset = {
    mapStyleUrl: 'map-style',
    currentUserId: 'current-user',
    territoryColor: '#1769AA',
    territoryTileMinimumZoom: '4',
    territoryTileMaximumZoom: '14',
    ...dataset,
  };
  mapElement.clientWidth = 600;
  const allTime = element();
  allTime.dataset.competitionPeriodOption = 'all-time';
  const currentMonth = element();
  currentMonth.dataset.competitionPeriodOption = 'current-month';
  const personalModeLink = element();
  personalModeLink.setAttribute('href', '/personal');
  const leaderboardView = (variant: 'full' | 'compact') => {
    const card = element();
    const overview = element();
    const status = element();
    const list = element();
    const current = variant === 'full' ? element() : null;
    card.dataset.territoryLeaderboardVariant = variant;
    card.querySelector = (selector: string) =>
      new Map<string, any>([
        ['[data-territory-status]', status],
        ['[data-territory-list]', list],
        ['[data-territory-current-pilot]', current],
      ]).get(selector) ?? null;
    return { card, overview, status, list, current };
  };
  const fullLeaderboard = leaderboardView('full');
  const compactLeaderboard = leaderboardView('compact');
  const elements = new Map<string, any>([
    ['[data-competition-coverage]', element()],
    ['[data-territory-map]', mapElement],
    ['[data-map-empty-state]', element()],
    ['[data-territory-leaderboard]', fullLeaderboard.card],
    ['[data-territory-allpilots]', fullLeaderboard.overview],
    ['[data-territory-status]', fullLeaderboard.status],
    ['[data-territory-list]', fullLeaderboard.list],
    ['[data-territory-current-pilot]', fullLeaderboard.current],
    ['[data-territory-cell-popup]', element()],
    ['[data-current-month-option]', currentMonth],
  ]);
  const documentRef = {
    createElement: () => element(),
    querySelector: (selector: string) => elements.get(selector) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-competition-period-option]') return [allTime, currentMonth];
      if (selector === '[data-map-mode-link]') return [personalModeLink];
      if (selector === '[data-territory-leaderboard]') {
        return [fullLeaderboard.card, compactLeaderboard.card];
      }
      if (selector === '[data-territory-allpilots]') {
        return [fullLeaderboard.overview, compactLeaderboard.overview];
      }
      if (selector === '[data-territory-status]') {
        return [fullLeaderboard.status, compactLeaderboard.status];
      }
      return [];
    },
  };
  const historyRef = { replaceState: vi.fn() };
  initializeCompetitionCoverage({
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
    personalModeLink,
    leaderboards: {
      full: fullLeaderboard,
      compact: compactLeaderboard,
    },
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
  it('initializes Arena search on the Personal dashboard', async () => {
    vi.useFakeTimers();
    try {
      const dashboardRoot = element();
      dashboardRoot.dataset.dashboardMode = 'personal';
      const searchRoot = element();
      const searchInput = element();
      searchInput.value = 'Boulder';
      const searchResults = element();
      const elements = new Map<string, any>([
        ['[data-dashboard]', dashboardRoot],
        ['[data-arena-search]', searchRoot],
        ['[data-arena-search-input]', searchInput],
        ['[data-arena-search-results]', searchResults],
      ]);
      const documentRef = {
        createElement: element,
        querySelector: (selector: string) => elements.get(selector) ?? null,
        querySelectorAll: () => [],
      };
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ arenas: [] }), { status: 200 }));

      initializeArenaSearch({ documentRef, fetchImpl });
      await searchInput.emit('input');
      await vi.advanceTimersByTimeAsync(200);

      expect(fetchImpl).toHaveBeenCalledWith('/v1/arenas?q=Boulder', expect.objectContaining({
        credentials: 'same-origin',
      }));
      expect(searchResults.children[0]?.textContent).toBe('No Arenas found.');
    } finally {
      vi.useRealTimers();
    }
  });

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
      '/v1/personal-stats?month=2026-07&west=-106&south=39&east=-104&north=41',
    ]);
    expect(harness.map.addSource).toHaveBeenCalledWith('personal-territory', {
      type: 'vector',
      tiles: ['/v1/personal-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07'],
      minzoom: 4,
      maxzoom: 14,
    });
    expect(claimedArea.textContent).toBe('1 km²');

    harness.move({ west: -105, east: -103 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('west=-105');
  });
});

describe('Launch Arena map focus', () => {
  it('loads and fits the launch boundary while keeping global coverage', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/v1/arenas/745/boundary') {
        return jsonResponse({ bbox: [-106, 39, -105, 40], type: 'Feature', geometry: {} });
      }
      return jsonResponse({ leaders: [], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl, '', { focusArenaSourceId: '745' });

    await harness.load();

    expect(fetchImpl).toHaveBeenCalledWith('/v1/arenas/745/boundary', expect.any(Object));
    expect(harness.map.addSource).toHaveBeenCalledWith(
      'arena-focus-boundary',
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(harness.map.fitBounds).toHaveBeenCalledWith(
      [[-106, 39], [-105, 40]],
      { padding: 60, duration: 0 },
    );
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/competition-territory'))).toBe(false);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/v1/arenas/745/competition-leaderboard'))).toBe(false);
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

    initializeCompetitionCoverage({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl,
      locationRef: { pathname: '/global', search: '' },
      historyRef: { replaceState: vi.fn() },
    });
    await harness.load();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/v1/competition-leaderboard?month=2026-07&west=-107'),
    ]);
    expect(harness.map.addSource).toHaveBeenCalledWith('competition-coverage', {
      type: 'vector',
      tiles: ['/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07'],
      minzoom: 4,
      maxzoom: 14,
    });
    harness.idle();
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.textContent).toBe('No territory for this zoom level or area.');

    harness.move({ west: -106, east: -104 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('west=-106');
  });

  it('selects a pilot and returns to the overview', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      return jsonResponse({ leaders: [pilot('pilot-one', 'Pilot One')], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();

    expect(harness.personalModeLink.href).toContain('/personal?month=2026-07');
    const list = harness.elements.get('[data-territory-list]');
    const overview = harness.elements.get('[data-territory-allpilots]');
    const source = harness.map.getSource('competition-coverage');
    source.setTiles.mockClear();
    await list.children[0].click();
    expect(source.setTiles).toHaveBeenCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07&pilot=pilot-one',
    ]);
    expect(list.children[0].getAttribute('aria-pressed')).toBe('true');
    expect(overview.getAttribute('aria-pressed')).toBe('false');
    const status = harness.elements.get('[data-territory-status]');
    expect(status.children).toHaveLength(1);
    expect(status.children[0].getAttribute('href')).toBe('/pilots/pilot-one');
    expect(status.children[0].textContent).toBe('View Pilot One’s progress');
    expect(list.children[0].getAttribute('href')).toBeNull();

    await overview.click();
    expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07',
    ]);
    expect(list.children[0].getAttribute('aria-pressed')).toBe('false');
    expect(overview.getAttribute('aria-pressed')).toBe('true');
    expect(status.children).toHaveLength(0);
    expect(status.textContent).toBe('Select a pilot to view their coverage.');
  });

  it('keeps both leaderboard selections synchronized when either Show All is used', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ leaders: [pilot('pilot-one', 'Pilot One')], currentPilot: null }),
    );
    const harness = globalDashboardHarness(fetchImpl);
    await harness.load();
    const full = harness.leaderboards.full;
    const compact = harness.leaderboards.compact;
    const source = harness.map.getSource('competition-coverage');

    await full.list.children[0].click();
    expect(full.list.children[0].getAttribute('aria-pressed')).toBe('true');
    expect(compact.list.children[0].getAttribute('aria-pressed')).toBe('true');
    expect(full.overview.getAttribute('aria-pressed')).toBe('false');
    expect(compact.overview.getAttribute('aria-pressed')).toBe('false');

    await compact.overview.click();
    expect(full.list.children[0].getAttribute('aria-pressed')).toBe('false');
    expect(compact.list.children[0].getAttribute('aria-pressed')).toBe('false');
    expect(full.overview.getAttribute('aria-pressed')).toBe('true');
    expect(compact.overview.getAttribute('aria-pressed')).toBe('true');

    await compact.list.children[0].click();
    await full.overview.click();
    expect(full.overview.getAttribute('aria-pressed')).toBe('true');
    expect(compact.overview.getAttribute('aria-pressed')).toBe('true');
    expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07',
    ]);
  });

  it('applies leaderboard busy state to both views', async () => {
    const leaderboardResponse = deferred<Response>();
    const fetchImpl = vi.fn(async () => leaderboardResponse.promise);
    const harness = globalDashboardHarness(fetchImpl);

    const loading = harness.load();
    await vi.waitFor(() => {
      expect(harness.leaderboards.full.card.getAttribute('aria-busy')).toBe('true');
      expect(harness.leaderboards.compact.card.getAttribute('aria-busy')).toBe('true');
    });
    leaderboardResponse.resolve(jsonResponse({ leaders: [], currentPilot: null }));
    await loading;

    expect(harness.leaderboards.full.card.getAttribute('aria-busy')).toBeNull();
    expect(harness.leaderboards.compact.card.getAttribute('aria-busy')).toBeNull();
  });

  it('resets pilot selection and refreshes territory and rankings when the period changes', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      return jsonResponse({ leaders: [pilot('pilot-one')], currentPilot: null });
    });
    const harness = globalDashboardHarness(fetchImpl, '?period=all-time');
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
    expect(harness.personalModeLink.href).toContain('/personal?month=2026-07');
    expect(harness.personalModeLink.href).not.toContain('period=all-time');
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
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07&pilot=pilot-one',
    ]);

    leaderboard = { leaders: [], currentPilot: null };
    harness.move({ west: -106, east: -104 });

    await vi.waitFor(() => expect(source.setTiles).toHaveBeenLastCalledWith([
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07',
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
      '/v1/competition-cells/12/-3/claimants?month=2026-07',
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
    expect(harness.leaderboards.compact.status.textContent).toBe(
      'Unable to update coverage rankings.',
    );
    expect(harness.leaderboards.compact.status.hidden).toBe(false);
    expect(harness.leaderboards.compact.card.getAttribute('aria-busy')).toBeNull();

    harness.error();
    expect(harness.elements.get('[data-map-empty-state]').textContent).toBe(
      'Map unavailable. Check your connection and try again.',
    );
  });
});
