import { beforeEach, describe, expect, it, vi } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { colorCompetitionTerritory, COMPETITION_TERRITORY_FILL_LAYER_ID, COMPETITION_TERRITORY_OUTLINE_LAYER_ID, COMPETITION_TERRITORY_SOURCE_ID, formatBrowserLocalDate, initializeDashboard, loadCompetitionTerritory } from '../../public/scripts/dashboard.js';

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

    expect(fetchPersonalTerritory).toHaveBeenCalledWith('/v1/personal-territory?type=grid', {
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
      properties: { ownerUserId },
      geometry: { type: 'Polygon', coordinates: [] },
    };
  }

  it('formats the browser calendar date without converting through UTC', () => {
    expect(formatBrowserLocalDate(new Date(2026, 6, 14, 23, 30))).toBe('2026-07-14');
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
});
