import { beforeEach, describe, expect, it, vi } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { colorCompetitionTerritory, competitionLeaderboardUrl, COMPETITION_TERRITORY_FILL_LAYER_ID, COMPETITION_TERRITORY_OUTLINE_LAYER_ID, COMPETITION_TERRITORY_SOURCE_ID, createCompetitionColorRegistry, formatBrowserLocalDate, formatBrowserLocalMonth, formatBrowserLocalMonthLabel, formatClaimedArea, formatClaimedPercentage, initializeDashboard, initializeMobileSheet, loadCompetitionTerritory, personalStatsUrl, renderCompetitionStats, renderPersonalStats } from '../../public/scripts/dashboard.js';

describe('Mobile dashboard sheet', () => {
  function interactiveElement() {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const listeners = new Map<string, (event: any) => void>();
    return {
      textContent: '',
      classList: {
        contains: (name: string) => classes.has(name),
        toggle(name: string, enabled: boolean) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      addEventListener(name: string, listener: (event: any) => void) { listeners.set(name, listener); },
      setAttribute(name: string, value: string) { attributes.set(name, value); },
      setPointerCapture: vi.fn(),
      dispatch(name: string, event: any = {}) { listeners.get(name)?.(event); },
      attribute: (name: string) => attributes.get(name),
      hasClass: (name: string) => classes.has(name),
    };
  }

  function setup() {
    const toggle = interactiveElement();
    const label = interactiveElement();
    const sheet = interactiveElement();
    const documentRef = {
      querySelector(selector: string) {
        if (selector === '[data-sheet-toggle]') return toggle;
        if (selector === '[data-sheet-toggle-label]') return label;
        if (selector === '[data-mobile-sheet]') return sheet;
        return null;
      },
    };
    initializeMobileSheet({ documentRef });
    return { label, sheet, toggle };
  }

  it('toggles the compact sheet by tap and updates its accessible state', () => {
    const { label, sheet, toggle } = setup();

    toggle.dispatch('click');
    expect(sheet.hasClass('is-expanded')).toBe(true);
    expect(toggle.attribute('aria-expanded')).toBe('true');
    expect(label.textContent).toBe('Collapse map information');

    toggle.dispatch('click');
    expect(sheet.hasClass('is-expanded')).toBe(false);
    expect(toggle.attribute('aria-expanded')).toBe('false');
    expect(label.textContent).toBe('Expand map information');
  });

  it('expands on an upward swipe and collapses on a downward swipe', () => {
    const { sheet, toggle } = setup();

    toggle.dispatch('pointerdown', { button: 0, clientY: 160, isPrimary: true, pointerId: 1 });
    toggle.dispatch('pointermove', { clientY: 100 });
    toggle.dispatch('pointerup', { clientY: 100 });
    expect(sheet.hasClass('is-expanded')).toBe(true);

    toggle.dispatch('pointerdown', { button: 0, clientY: 100, isPrimary: true, pointerId: 1 });
    toggle.dispatch('pointermove', { clientY: 160 });
    toggle.dispatch('pointerup', { clientY: 160 });
    expect(sheet.hasClass('is-expanded')).toBe(false);
  });

  it('does not change state for a short drag or its follow-up click', () => {
    const { sheet, toggle } = setup();

    toggle.dispatch('pointerdown', { button: 0, clientY: 100, isPrimary: true, pointerId: 1 });
    toggle.dispatch('pointermove', { clientY: 120 });
    toggle.dispatch('pointerup', { clientY: 120 });
    toggle.dispatch('click');

    expect(sheet.hasClass('is-expanded')).toBe(false);
  });
});

describe('Personal territory dashboard map', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [],
  };

  let loadHandler: (() => Promise<void>) | undefined;
  let addSource: ReturnType<typeof vi.fn>;
  let addLayer: ReturnType<typeof vi.fn>;
  let fetchPersonalTerritory: ReturnType<typeof vi.fn>;
  let mapStatus: { hidden: boolean; textContent: string };

  beforeEach(() => {
    loadHandler = undefined;
    addSource = vi.fn();
    addLayer = vi.fn();
    fetchPersonalTerritory = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(geojson), {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      }),
    );
    mapStatus = { hidden: true, textContent: '' };
  });

  function initialize() {
    const mapElement = {
      dataset: {
        mapStyleUrl: 'https://example.test/style.json',
        territoryColor: '#1769AA',
      },
    };
    const documentRef = {
      querySelector(selector: string) {
        if (selector === '[data-dashboard-map]') return mapElement;
        if (selector === '[data-map-empty-state]') return mapStatus;
        return null;
      },
    };
    const map = {
      addSource,
      addLayer,
      addControl: vi.fn(),
      once: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'load') loadHandler = handler;
      }),
    };
    const maplibre = {
      Map: vi.fn(function Map() {
        return map;
      }),
      NavigationControl: vi.fn(function NavigationControl() {}),
    };

    initializeDashboard({ documentRef, maplibre, fetchImpl: fetchPersonalTerritory });
  }

  it('loads exactly one aggregate GeoJSON source with personal fill and outline layers', async () => {
    initialize();
    expect(loadHandler).toBeTypeOf('function');

    await loadHandler?.();

    expect(fetchPersonalTerritory).toHaveBeenCalledWith('/v1/personal-territory', {
      credentials: 'same-origin',
      headers: { accept: 'application/geo+json' },
    });
    expect(addSource).toHaveBeenCalledTimes(1);
    expect(addSource).toHaveBeenCalledWith('personal-territory', {
      type: 'geojson',
      data: geojson,
    });
    expect(addLayer).toHaveBeenCalledTimes(2);
    expect(addLayer).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'personal-territory-fill',
      type: 'fill',
      source: 'personal-territory',
      paint: expect.objectContaining({ 'fill-color': '#1769AA' }),
    }));
    expect(addLayer).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'personal-territory-outline',
      type: 'line',
      source: 'personal-territory',
      paint: expect.objectContaining({ 'line-color': '#1769AA' }),
    }));
    expect(addSource.mock.calls.map(([id]) => id)).not.toContain('tracks');
    expect(addLayer.mock.calls.map(([layer]) => layer.source)).not.toContain('flight-areas');
  });

  it('shows a territory-specific status when the aggregate request fails', async () => {
    fetchPersonalTerritory.mockResolvedValue(new Response(null, { status: 500 }));
    initialize();

    await loadHandler?.();

    expect(mapStatus.hidden).toBe(false);
    expect(mapStatus.textContent).toBe('Unable to load your territory. Refresh the page.');
  });
});

describe('Competition territory dashboard map', () => {
  const currentUserId = '00000000-0000-4000-8000-000000000001';
  const otherUserId = '00000000-0000-4000-8000-000000000002';

  function feature(ownerUserId: string) {
    return {
      type: 'Feature',
      properties: {
        ownerUserId,
        cellId: `2026-07-01:1000:${ownerUserId}:0`,
        competitionMonth: '2026-07-01',
        cellSize: 1_000,
        x: 0,
        y: 0,
      },
      geometry: { type: 'Polygon', coordinates: [] },
    };
  }

  it('formats the browser calendar date without converting through UTC', () => {
    expect(formatBrowserLocalDate(new Date(2026, 6, 14, 23, 30))).toBe('2026-07-14');
    expect(formatBrowserLocalMonth(new Date(2026, 6, 14, 23, 30))).toBe('2026-07');
  });

  it('builds a YYYY-MM leaderboard URL from two viewport corners', () => {
    const url = competitionLeaderboardUrl({
      getWest: () => -107,
      getSouth: () => 39,
      getEast: () => -105,
      getNorth: () => 41,
    }, new Date(2026, 6, 14));

    expect(url).toBe('/v1/competition-leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41');
    expect(formatClaimedArea(2_500_000, 'en-US')).toBe('2.5 km²');
  });

  it('builds a personal stats URL from the normalized viewport', () => {
    const url = personalStatsUrl({
      getWest: () => -107,
      getSouth: () => 39,
      getEast: () => -105,
      getNorth: () => 41,
    });

    expect(url).toBe('/v1/personal-stats?west=-107&south=39&east=-105&north=41');
  });

  it('formats the competition month as month and year only', () => {
    expect(formatBrowserLocalMonthLabel(new Date(2026, 6, 14), 'en-US')).toBe('July 2026');
  });

  it('formats claimed percentages with one decimal place', () => {
    expect(formatClaimedPercentage(27.44, 'en-US')).toBe('27.4%');
  });

  it('keeps the current pilot color and assigns one temporary color per other owner', () => {
    const colored = colorCompetitionTerritory({
      type: 'FeatureCollection',
      features: [feature(currentUserId), feature(otherUserId), feature(otherUserId)],
    }, currentUserId, '#1769AA', () => 0.5);

    expect(colored.features[0].properties.displayColor).toBe('#1769AA');
    expect(colored.features[1].properties.displayColor).toMatch(/^#[0-9A-F]{6}$/);
    expect(colored.features[2].properties.displayColor).toBe(colored.features[1].properties.displayColor);
  });

  it('reuses owner colors between competition map and leaderboard consumers', () => {
    const registry = createCompetitionColorRegistry(currentUserId, '#1769AA', () => 0.5);
    expect(registry.colorFor(currentUserId)).toBe('#1769AA');
    expect(registry.colorFor(otherUserId)).toBe(registry.colorFor(otherUserId));
  });

  it('loads current ownership and uses shared data-driven fill and boundary styles', async () => {
    const geojson = { type: 'FeatureCollection', features: [feature(currentUserId), feature(otherUserId)] };
    const addSource = vi.fn();
    const addLayer = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(geojson), { status: 200 }));

    await loadCompetitionTerritory(
      { addSource, addLayer },
      {
        currentUserId,
        territoryColor: '#1769AA',
        date: new Date(2026, 6, 14, 23, 30),
        fetchImpl,
        random: () => 0,
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith('/v1/competition-territory?date=2026-07-14', {
      credentials: 'same-origin',
      headers: { accept: 'application/geo+json' },
    });
    expect(addSource).toHaveBeenCalledWith(COMPETITION_TERRITORY_SOURCE_ID, {
      type: 'geojson',
      data: expect.objectContaining({ type: 'FeatureCollection' }),
    });
    expect(addLayer).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: COMPETITION_TERRITORY_FILL_LAYER_ID,
      paint: { 'fill-color': ['get', 'displayColor'], 'fill-opacity': 0.42 },
    }));
    expect(addLayer).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: COMPETITION_TERRITORY_OUTLINE_LAYER_ID,
      paint: { 'line-color': ['get', 'displayColor'], 'line-width': 2 },
    }));
  });

  function modeButton(active = false) {
    let clickHandler: (() => Promise<void> | void) | undefined;
    const classes = new Set(active ? ['is-active'] : []);
    const attributes = new Map<string, string>(active ? [['aria-current', 'page']] : []);
    return {
      classList: {
        toggle(name: string, enabled: boolean) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains(name: string) {
          return classes.has(name);
        },
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
      addEventListener(event: string, handler: () => Promise<void> | void) {
        if (event === 'click') clickHandler = handler;
      },
      async click() {
        await clickHandler?.();
      },
    };
  }

  function initializeModeSwitch(competitionFeatures: ReturnType<typeof feature>[], competitionStatus = 200) {
    const personalButton = modeButton(true);
    const competitiveButton = modeButton();
    const mapStatus = { hidden: true, textContent: '' };
    const mapElement = {
      dataset: {
        mapStyleUrl: 'https://example.test/style.json',
        currentUserId,
        territoryColor: '#1769AA',
      },
    };
    const documentRef = {
      querySelector(selector: string) {
        if (selector === '[data-dashboard-map]') return mapElement;
        if (selector === '[data-map-empty-state]') return mapStatus;
        if (selector === '[data-personal-mode]') return personalButton;
        if (selector === '[data-competitive-mode]') return competitiveButton;
        return null;
      },
    };
    const layers = new Set<string>();
    let loadHandler: (() => Promise<void>) | undefined;
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
      addControl: vi.fn(),
      getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
      setLayoutProperty: vi.fn(),
      once: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'load') loadHandler = handler;
      }),
    };
    const maplibre = {
      Map: vi.fn(function Map() {
        return map;
      }),
      NavigationControl: vi.fn(function NavigationControl() {}),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        type: 'FeatureCollection',
        features: competitionFeatures,
      }), { status: competitionStatus }));

    initializeDashboard({ documentRef, maplibre, fetchImpl });
    return {
      competitiveButton,
      fetchImpl,
      load: async () => loadHandler?.(),
      map,
      mapStatus,
      personalButton,
    };
  }

  it('switches layers without moving the map and keeps competition data only for the page', async () => {
    const context = initializeModeSwitch([feature(currentUserId), feature(otherUserId)]);
    await context.load();
    await context.competitiveButton.click();

    expect(context.fetchImpl).toHaveBeenCalledTimes(2);
    expect(context.map.setLayoutProperty).toHaveBeenCalledWith('personal-territory-fill', 'visibility', 'none');
    expect(context.map.setLayoutProperty).toHaveBeenCalledWith('personal-territory-outline', 'visibility', 'none');
    expect(context.map.setLayoutProperty).toHaveBeenCalledWith(
      COMPETITION_TERRITORY_FILL_LAYER_ID,
      'visibility',
      'visible',
    );
    expect(context.competitiveButton.classList.contains('is-active')).toBe(true);
    expect(context.competitiveButton.getAttribute('aria-current')).toBe('page');
    expect(context.personalButton.getAttribute('aria-current')).toBeNull();
    expect(context.map).not.toHaveProperty('fitBounds');
    expect(context.map).not.toHaveProperty('jumpTo');

    await context.personalButton.click();
    expect(context.map.setLayoutProperty).toHaveBeenCalledWith(
      COMPETITION_TERRITORY_FILL_LAYER_ID,
      'visibility',
      'none',
    );
    expect(context.map.setLayoutProperty).toHaveBeenCalledWith('personal-territory-fill', 'visibility', 'visible');
    expect(context.personalButton.getAttribute('aria-current')).toBe('page');

    await context.competitiveButton.click();
    expect(context.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shows and clears the empty competition month message', async () => {
    const context = initializeModeSwitch([]);
    await context.load();
    await context.competitiveButton.click();

    expect(context.mapStatus.hidden).toBe(false);
    expect(context.mapStatus.textContent).toBe('No competition territory claimed this month.');

    await context.personalButton.click();
    expect(context.mapStatus.hidden).toBe(true);
  });

  it('shows a competition-specific message when ownership cannot be loaded', async () => {
    const context = initializeModeSwitch([], 500);
    await context.load();
    await context.competitiveButton.click();

    expect(context.mapStatus.hidden).toBe(false);
    expect(context.mapStatus.textContent).toBe('Unable to load competition territory. Try again.');
  });

  function element(): any {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const styles = new Map<string, string>();
    const node = {
      hidden: false,
      textContent: '',
      className: '',
      children: [] as ReturnType<typeof element>[],
      classList: {
        add(name: string) { classes.add(name); },
        toggle(name: string, enabled: boolean) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      style: { setProperty(name: string, value: string) { styles.set(name, value); } },
      setAttribute(name: string, value: string) { attributes.set(name, value); },
      removeAttribute(name: string) { attributes.delete(name); },
      append(...children: ReturnType<typeof element>[]) { node.children.push(...children); },
      replaceChildren(...children: ReturnType<typeof element>[]) { node.children = [...children]; },
    };
    return node;
  }

  it('renders populated and empty personal and competition stat cards', () => {
    const elements = new Map([
      ['[data-personal-stats]', element()],
      ['[data-personal-claimed-area]', element()],
      ['[data-personal-flights]', element()],
      ['[data-personal-claimed-percentage]', element()],
      ['[data-competition-stats]', element()],
      ['[data-competition-claimed-area]', element()],
      ['[data-competition-flights]', element()],
      ['[data-competition-pilots]', element()],
      ['[data-competition-my-flights]', element()],
      ['[data-competition-claimed-percentage]', element()],
    ]);
    const documentRef = { querySelector: (selector: string) => elements.get(selector) ?? null };

    renderPersonalStats({
      documentRef,
      locale: 'en-US',
      stats: {
        claimedCellCount: 2,
        claimedAreaSquareMeters: 2_500_000,
        flightCount: 2,
        visibleCellCount: 8,
        claimedPercentage: 25,
      },
    });
    expect(elements.get('[data-personal-claimed-area]')?.textContent).toBe('2.5 km²');
    expect(elements.get('[data-personal-flights]')?.textContent).toBe('2');
    expect(elements.get('[data-personal-claimed-percentage]')?.textContent).toBe('25.0%');

    renderCompetitionStats({
      documentRef,
      locale: 'en-US',
      stats: {
        claimedCellCount: 0,
        claimedAreaSquareMeters: 0,
        flightCount: 0,
        pilotCount: 0,
        currentPilotFlightCount: 0,
        visibleCellCount: 8,
        claimedPercentage: 0,
      },
    });
    for (const selector of [
      '[data-competition-claimed-area]',
      '[data-competition-flights]',
      '[data-competition-pilots]',
      '[data-competition-my-flights]',
      '[data-competition-claimed-percentage]',
    ]) expect(elements.get(selector)?.textContent).toBe('-');
  });

  function initializeLeaderboardDashboard(
    leaderboardResponse: unknown | ((url: string) => Promise<Response>),
    personalStatsResponse?: (url: string) => Promise<Response>,
  ) {
    const personalButton = modeButton(true);
    const competitiveButton = modeButton();
    const mapStatus = { hidden: true, textContent: '' };
    const mapElement = {
      dataset: {
        mapStyleUrl: 'https://example.test/style.json',
        currentUserId,
        territoryColor: '#1769AA',
      },
    };
    const leaderboardCard = element();
    const leaderboardStatus = element();
    const leaderboardList = element();
    const currentPilotResult = element();
    const personalStatsCard = element();
    const competitionStatsCard = element();
    const personalClaimedArea = element();
    const personalFlights = element();
    const personalClaimedPercentage = element();
    const competitionClaimedArea = element();
    const competitionFlights = element();
    const competitionPilots = element();
    const competitionMyFlights = element();
    const competitionClaimedPercentage = element();
    const documentRef = {
      createElement: () => element(),
      querySelector(selector: string) {
        if (selector === '[data-dashboard-map]') return mapElement;
        if (selector === '[data-map-empty-state]') return mapStatus;
        if (selector === '[data-personal-mode]') return personalButton;
        if (selector === '[data-competitive-mode]') return competitiveButton;
        if (selector === '[data-competition-leaderboard]') return leaderboardCard;
        if (selector === '[data-leaderboard-status]') return leaderboardStatus;
        if (selector === '[data-leaderboard-list]') return leaderboardList;
        if (selector === '[data-current-pilot-result]') return currentPilotResult;
        if (selector === '[data-personal-stats]') return personalStatsCard;
        if (selector === '[data-competition-stats]') return competitionStatsCard;
        if (selector === '[data-personal-claimed-area]') return personalClaimedArea;
        if (selector === '[data-personal-flights]') return personalFlights;
        if (selector === '[data-personal-claimed-percentage]') return personalClaimedPercentage;
        if (selector === '[data-competition-claimed-area]') return competitionClaimedArea;
        if (selector === '[data-competition-flights]') return competitionFlights;
        if (selector === '[data-competition-pilots]') return competitionPilots;
        if (selector === '[data-competition-my-flights]') return competitionMyFlights;
        if (selector === '[data-competition-claimed-percentage]') return competitionClaimedPercentage;
        return null;
      },
    };
    let loadHandler: (() => Promise<void>) | undefined;
    let moveEndHandler: (() => void) | undefined;
    const layers = new Set<string>();
    let bounds = { west: -107, south: 39, east: -105, north: 41 };
    const map = {
      addSource: vi.fn(),
      addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
      addControl: vi.fn(),
      getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
      setLayoutProperty: vi.fn(),
      getBounds: () => ({
        getWest: () => bounds.west,
        getSouth: () => bounds.south,
        getEast: () => bounds.east,
        getNorth: () => bounds.north,
      }),
      once: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'load') loadHandler = handler;
      }),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'moveend') moveEndHandler = handler;
      }),
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/v1/personal-territory') {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
      }
      if (url.startsWith('/v1/competition-territory')) {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature(otherUserId)] }), { status: 200 });
      }
      if (url.startsWith('/v1/personal-stats')) {
        if (personalStatsResponse) return personalStatsResponse(url);
        return new Response(JSON.stringify({
          claimedCellCount: 1,
          claimedAreaSquareMeters: 1_000_000,
          flightCount: 1,
          visibleCellCount: 10,
          claimedPercentage: 10,
        }), { status: 200 });
      }
      if (typeof leaderboardResponse === 'function') return leaderboardResponse(url);
      return new Response(JSON.stringify(leaderboardResponse), { status: 200 });
    });
    const maplibre = {
      Map: vi.fn(function Map() { return map; }),
      NavigationControl: vi.fn(function NavigationControl() {}),
    };

    initializeDashboard({ documentRef, maplibre, fetchImpl });
    return {
      competitiveButton,
      currentPilotResult,
      fetchImpl,
      leaderboardCard,
      leaderboardList,
      leaderboardStatus,
      competitionClaimedPercentage,
      competitionStatsCard,
      load: async () => loadHandler?.(),
      move: (nextBounds = bounds) => { bounds = nextBounds; moveEndHandler?.(); },
      personalButton,
      personalClaimedPercentage,
      personalStatsCard,
    };
  }

  it('shows and refreshes the leaderboard only in Competitive mode', async () => {
    const context = initializeLeaderboardDashboard({
      leaders: [{
        userId: otherUserId,
        displayName: 'Other Pilot',
        claimedCellCount: 2,
        claimedAreaSquareMeters: 2_000_000,
        rank: 1,
      }],
      currentPilot: {
        userId: currentUserId,
        displayName: 'Current Pilot',
        claimedCellCount: 0,
        claimedAreaSquareMeters: 0,
        rank: null,
      },
      stats: {
        claimedCellCount: 2,
        claimedAreaSquareMeters: 2_000_000,
        flightCount: 2,
        pilotCount: 1,
        currentPilotFlightCount: 0,
        visibleCellCount: 10,
        claimedPercentage: 20,
      },
    });
    await context.load();
    expect(context.leaderboardCard.hidden).toBe(true);
    expect(context.personalStatsCard.hidden).toBe(false);
    expect(context.personalClaimedPercentage.textContent).toBe('10.0%');

    await context.competitiveButton.click();
    expect(context.leaderboardCard.hidden).toBe(false);
    expect(context.competitionStatsCard.hidden).toBe(false);
    expect(context.competitionClaimedPercentage.textContent).toBe('20.0%');
    expect(context.leaderboardList.children).toHaveLength(1);
    expect(context.currentPilotResult.hidden).toBe(false);
    expect(context.fetchImpl.mock.calls[3]?.[0]).toContain(
      '/v1/competition-leaderboard?month=',
    );

    context.move({ west: -106, south: 39, east: -104, north: 41 });
    await vi.waitFor(() => expect(context.fetchImpl).toHaveBeenCalledTimes(5));
    expect(context.fetchImpl.mock.calls[4]?.[0]).toContain('west=-106');

    await context.personalButton.click();
    expect(context.leaderboardCard.hidden).toBe(true);
    await vi.waitFor(() => expect(context.fetchImpl).toHaveBeenCalledTimes(6));
    context.move();
    await vi.waitFor(() => expect(context.fetchImpl).toHaveBeenCalledTimes(7));
    expect(context.fetchImpl.mock.calls[6]?.[0]).toContain('/v1/personal-stats');
  });

  it('ignores an older viewport response that finishes after a newer one', async () => {
    const pending: Array<(response: Response) => void> = [];
    let requestCount = 0;
    const responseFor = (displayName: string) => new Response(JSON.stringify({
      leaders: [{
        userId: otherUserId,
        displayName,
        claimedCellCount: 1,
        claimedAreaSquareMeters: 1_000_000,
        rank: 1,
      }],
      currentPilot: null,
      stats: {
        claimedCellCount: 1,
        claimedAreaSquareMeters: 1_000_000,
        flightCount: 1,
        pilotCount: 1,
        currentPilotFlightCount: 0,
        visibleCellCount: 10,
        claimedPercentage: 10,
      },
    }), { status: 200 });
    const context = initializeLeaderboardDashboard(async () => {
      requestCount += 1;
      if (requestCount === 1) return responseFor('Initial Pilot');
      return new Promise<Response>((resolve) => pending.push(resolve));
    });
    await context.load();
    await context.competitiveButton.click();

    context.move({ west: -106, south: 39, east: -105, north: 41 });
    context.move({ west: -104, south: 39, east: -103, north: 41 });
    expect(pending).toHaveLength(2);
    pending[1]!(responseFor('Newest Pilot'));
    await vi.waitFor(() => {
      expect(context.leaderboardList.children[0]?.children[2]?.textContent).toBe('Newest Pilot');
    });

    pending[0]!(responseFor('Stale Pilot'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.leaderboardList.children[0]?.children[2]?.textContent).toBe('Newest Pilot');
  });

  it('ignores an older personal stats response that finishes after a newer one', async () => {
    const pending: Array<(response: Response) => void> = [];
    let requestCount = 0;
    const responseFor = (claimedPercentage: number) => new Response(JSON.stringify({
      claimedCellCount: 1,
      claimedAreaSquareMeters: 1_000_000,
      flightCount: 1,
      visibleCellCount: 10,
      claimedPercentage,
    }), { status: 200 });
    const context = initializeLeaderboardDashboard(
      { leaders: [], currentPilot: null, stats: {
        claimedCellCount: 0,
        claimedAreaSquareMeters: 0,
        flightCount: 0,
        pilotCount: 0,
        currentPilotFlightCount: 0,
        visibleCellCount: 10,
        claimedPercentage: 0,
      } },
      async () => {
        requestCount += 1;
        if (requestCount === 1) return responseFor(10);
        return new Promise<Response>((resolve) => pending.push(resolve));
      },
    );
    await context.load();

    context.move({ west: -106, south: 39, east: -105, north: 41 });
    context.move({ west: -104, south: 39, east: -103, north: 41 });
    expect(pending).toHaveLength(2);
    pending[1]!(responseFor(30));
    await vi.waitFor(() => expect(context.personalClaimedPercentage.textContent).toBe('30.0%'));

    pending[0]!(responseFor(20));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(context.personalClaimedPercentage.textContent).toBe('30.0%');
  });
});
