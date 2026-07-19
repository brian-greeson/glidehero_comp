import { describe, expect, it, vi } from 'vitest';

// The Arena browser entry point intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeArena } from '../../public/scripts/arena.js';

function element(): any {
  const attributes = new Map<string, string>();
  const node = {
    hidden: true,
    textContent: '',
    children: [] as any[],
    classList: { add() {}, contains: () => false, toggle() {} },
    style: { setProperty() {} },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    addEventListener() {},
    append(...children: any[]) {
      node.children.push(...children);
    },
    replaceChildren(...children: any[]) {
      node.children = children;
    },
  };
  return node;
}

function arenaHarness() {
  let loadHandler: (() => Promise<void>) | undefined;
  const sources = new Map<string, any>();
  const map = {
    addControl: vi.fn(),
    addLayer: vi.fn(),
    addSource: vi.fn((id: string, source: any) => sources.set(id, { ...source, setTiles: vi.fn() })),
    fitBounds: vi.fn(),
    getBounds: vi.fn(() => ({
      getWest: () => -107,
      getSouth: () => 39,
      getEast: () => -105,
      getNorth: () => 41,
    })),
    getSource: vi.fn((id: string) => sources.get(id)),
    once: vi.fn((event: string, handler: () => Promise<void>) => {
      if (event === 'load') loadHandler = handler;
    }),
    on: vi.fn(),
  };
  return {
    map,
    maplibre: {
      Map: vi.fn(function MapStub() {
        return map;
      }),
      NavigationControl: vi.fn(),
    },
    load: async () => loadHandler?.(),
  };
}

function arenaDocument() {
  const mapElement = {
    dataset: {
      arenaSourceId: '745',
      mapStyleUrl: 'map-style',
      currentUserId: 'user-1',
      territoryColor: '#1769AA',
    },
  };
  const elements = new Map<string, any>([
    ['[data-competition-coverage]', element()],
    ['[data-territory-map]', mapElement],
    ['[data-territory-leaderboard]', element()],
    ['[data-territory-allpilots]', element()],
    ['[data-map-empty-state]', element()],
    ['[data-territory-status]', element()],
    ['[data-territory-list]', element()],
    ['[data-territory-current-pilot]', element()],
    ['[data-territory-cell-popup]', element()],
  ]);
  return {
    elements,
    documentRef: {
      createElement: () => element(),
      querySelector: (selector: string) => elements.get(selector) ?? null,
      querySelectorAll: () => [],
    } as any,
  };
}

describe('Arena dashboard', () => {
  it('loads the Arena boundary, coverage, and rankings for the selected month', async () => {
    const harness = arenaHarness();
    const { documentRef } = arenaDocument();
    const boundary = {
      type: 'Feature',
      properties: { sourceId: 745 },
      geometry: { type: 'Polygon', coordinates: [] },
      bbox: [-106, 39, -105, 40],
    };
    const leaderboard = { leaders: [], currentPilot: null };
    const fetchImpl = vi.fn(async (url: string) => {
      const payload = url.endsWith('/boundary')
        ? boundary
        : leaderboard;
      return new Response(JSON.stringify(payload), { status: 200 });
    });

    initializeArena({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl,
      locationRef: { pathname: '/arena/us/boulder-745', search: '?month=2026-07' },
      historyRef: { replaceState: vi.fn() },
    });
    await harness.load();

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/v1/arenas/745/boundary',
      '/v1/arenas/745/competition-leaderboard?month=2026-07',
    ]);
    expect(harness.map.addSource).toHaveBeenCalledWith('competition-coverage', {
      type: 'vector',
      tiles: ['/v1/arenas/745/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07'],
      minzoom: 7,
      maxzoom: 14,
    });
    expect(harness.map.addSource).toHaveBeenCalledWith('competition-arena-boundary', {
      type: 'geojson',
      data: boundary,
    });
    expect(harness.map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'competition-arena-boundary',
        source: 'competition-arena-boundary',
        type: 'line',
      }),
    );
    expect(harness.map.fitBounds).toHaveBeenCalledWith(
      [
        [-106, 39],
        [-105, 40],
      ],
      { padding: 60, duration: 0 },
    );
    expect(harness.map.on).toHaveBeenCalledWith('moveend', expect.any(Function));
  });

  it('registers the shared competition hover interaction', () => {
    const harness = arenaHarness();
    const { documentRef } = arenaDocument();

    initializeArena({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl: vi.fn(),
      locationRef: { pathname: '/arena/us/boulder-745', search: '' },
    });

    expect(harness.map.on).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(harness.map.on).toHaveBeenCalledWith('mouseleave', expect.any(Function));
  });

  it('shows a recoverable status when the Arena boundary cannot load', async () => {
    const harness = arenaHarness();
    const { documentRef, elements } = arenaDocument();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));

    initializeArena({
      documentRef,
      maplibre: harness.maplibre,
      fetchImpl,
      locationRef: { pathname: '/arena/us/boulder-745', search: '' },
    });
    await harness.load();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      '/v1/arenas/745/boundary',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(harness.map.fitBounds).not.toHaveBeenCalled();
    expect(elements.get('[data-map-empty-state]')).toMatchObject({
      hidden: false,
      textContent: 'Unable to load competition coverage. Try again.',
    });
  });
});
