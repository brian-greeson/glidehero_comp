import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { initializeGlobalDashboard } from '../../public/scripts/globalDashboard.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializePersonalDashboard } from '../../public/scripts/personalDashboard.js';

function element(): any {
  const attributes = new Map<string, string>();
  const node = {
    hidden: true,
    textContent: '',
    className: '',
    children: [] as any[],
    classList: { add() {}, toggle() {} },
    style: { setProperty() {} },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    removeAttribute(name: string) { attributes.delete(name); },
    addEventListener() {},
    append(...children: any[]) { node.children.push(...children); },
    replaceChildren(...children: any[]) { node.children = children; },
  };
  return node;
}

function mapHarness() {
  let loadHandler: (() => Promise<void>) | undefined;
  let moveHandler: (() => void) | undefined;
  const layers = new Set<string>();
  let viewport = { west: -107, east: -105 };
  const map = {
    addSource: vi.fn(),
    addLayer: vi.fn((layer: { id: string }) => layers.add(layer.id)),
    addControl: vi.fn(),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    setLayoutProperty: vi.fn(),
    getBounds: () => ({
      getWest: () => viewport.west,
      getSouth: () => 39,
      getEast: () => viewport.east,
      getNorth: () => 41,
    }),
    once: vi.fn((event: string, handler: () => Promise<void>) => {
      if (event === 'load') loadHandler = handler;
    }),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'moveend') moveHandler = handler;
    }),
  };
  return {
    map,
    maplibre: {
      Map: vi.fn(function Map() { return map; }),
      NavigationControl: vi.fn(function NavigationControl() {}),
    },
    load: async () => loadHandler?.(),
    move(next = viewport) { viewport = next; moveHandler?.(); },
  };
}

describe('Personal dashboard controller', () => {
  it('loads Personal territory and refreshes stats after viewport movement', async () => {
    const harness = mapHarness();
    const mapElement = { dataset: { mapStyleUrl: 'map-style', territoryColor: '#1769AA' } };
    const emptyState = element();
    const statsCard = element();
    const claimedArea = element();
    const flights = element();
    const documentRef = {
      querySelector(selector: string) {
        return new Map<string, any>([
          ['[data-dashboard-map]', mapElement],
          ['[data-map-empty-state]', emptyState],
          ['[data-personal-stats]', statsCard],
          ['[data-personal-claimed-area]', claimedArea],
          ['[data-personal-flights]', flights],
        ]).get(selector) ?? null;
      },
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/v1/personal-territory') {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        claimedCellCount: 1, claimedAreaSquareMeters: 1_000_000, flightCount: 1,
      }), { status: 200 });
    });

    initializePersonalDashboard({ documentRef, maplibre: harness.maplibre, fetchImpl });
    harness.move({ west: -106, east: -104 });
    expect(fetchImpl).not.toHaveBeenCalled();
    await harness.load();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/v1/personal-territory',
      '/v1/personal-stats?west=-106&south=39&east=-104&north=41',
    ]);
    expect(claimedArea.textContent).toBe('1 km²');

    harness.move({ west: -105, east: -103 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(fetchImpl.mock.calls[2]?.[0]).toContain('west=-105');
  });
});

describe('Global dashboard controller', () => {
  it('loads competition territory and refreshes viewport results on moveend', async () => {
    const harness = mapHarness();
    const mapElement = {
      dataset: {
        mapStyleUrl: 'map-style', currentUserId: 'current-user', territoryColor: '#1769AA',
      },
    };
    const emptyState = element();
    const elements = new Map<string, any>([
      ['[data-competition-coverage]', element()],
      ['[data-coverage-map]', mapElement],
      ['[data-map-empty-state]', emptyState],
      ['[data-coverage-leaderboard]', element()],
      ['[data-coverage-overview]', element()],
      ['[data-coverage-status]', element()],
      ['[data-coverage-list]', element()],
      ['[data-coverage-current-pilot]', element()],
      ['[data-coverage-cell-popup]', element()],
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
      if (url.startsWith('/v1/competition-territory')) {
        return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
      }
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
    expect(fetchImpl.mock.calls.slice(0, 2).map(([url]) => url)).toEqual(expect.arrayContaining([
      '/v1/competition-territory',
      expect.stringContaining('/v1/competition-leaderboard?west=-107'),
    ]));
    expect(emptyState.hidden).toBe(false);
    expect(emptyState.textContent).toBe('No coverage for this selection.');

    harness.move({ west: -106, east: -104 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(fetchImpl.mock.calls[2]?.[0]).toContain('west=-106');
  });
});
