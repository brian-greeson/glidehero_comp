import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { arenaCoverageLeaderboardUrl, competitionCellTracksUrl, coverageTerritoryTileUrl, globalCoverageLeaderboardUrl } from '../../public/scripts/competitionCoverageApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { createCompetitionColorRegistry } from '../../public/scripts/competitionColors.js';
// @ts-expect-error Browser assets remain JavaScript.
import { assignLoadedCoverageColors, coverageCellFeatureAtPoint, installCoverageSource, updateCoverageTiles } from '../../public/scripts/competitionCoverageMap.js';
// @ts-expect-error Browser assets remain JavaScript.
import { renderCoverageLeaderboard } from '../../public/scripts/competitionCoverageLeaderboard.js';

describe('competition coverage browser contracts', () => {
  it('builds canonical Global, Arena, territory, and selected-cell track URLs', () => {
    const bounds = {
      getWest: () => -107,
      getSouth: () => 39,
      getEast: () => -105,
      getNorth: () => 41,
    };
    expect(globalCoverageLeaderboardUrl(bounds)).toBe(
      '/v1/competition-leaderboard?west=-107&south=39&east=-105&north=41',
    );
    expect(globalCoverageLeaderboardUrl(bounds, '2026-07')).toContain('month=2026-07');
    expect(arenaCoverageLeaderboardUrl('745', '2026-07')).toBe(
      '/v1/arenas/745/competition-leaderboard?month=2026-07',
    );
    expect(competitionCellTracksUrl(1, 2, {
      month: '2026-07',
      pilotUserId: 'pilot',
    })).toBe(
      '/v1/competition-cells/1/2/tracks?month=2026-07&pilot=pilot',
    );
    expect(coverageTerritoryTileUrl({ month: '2026-07', pilotUserId: 'pilot' })).toBe(
      '/v1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-07&pilot=pilot',
    );
    expect(coverageTerritoryTileUrl({ arenaSourceId: '745' })).toBe(
      '/v1/arenas/745/competition-territory/tiles/{z}/{x}/{y}.mvt',
    );
    expect(coverageTerritoryTileUrl({}, 'https://glidehero.test')).toBe(
      'https://glidehero.test/v1/competition-territory/tiles/{z}/{x}/{y}.mvt',
    );
  });

  it('assigns stable colors shared by map and leaderboard consumers', () => {
    const registry = createCompetitionColorRegistry('current', '#1769AA', () => 0.5);
    expect(registry.colorFor('current')).toBe('#1769AA');
    expect(registry.colorFor('other')).toBe(registry.colorFor('other'));
  });

  it('reports null when the selected leaderboard pilot is tapped again', () => {
    const handlers = new Map<string, (event?: any) => void>();
    const element = () => {
      const attributes = new Map<string, string>();
      return {
        hidden: false,
        textContent: '',
        className: '',
        children: [] as any[],
        classList: { add() {} },
        style: { setProperty() {} },
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
        getAttribute(name: string) {
          return attributes.get(name) ?? null;
        },
        addEventListener(event: string, handler: (event?: any) => void) {
          handlers.set(event, handler);
        },
        append(...children: any[]) {
          this.children.push(...children);
        },
        replaceChildren(...children: any[]) {
          this.children = children;
        },
      };
    };
    const elements = new Map([
      ['[data-territory-list]', element()],
      ['[data-territory-status]', element()],
      ['[data-territory-current-pilot]', element()],
    ]);
    const pilot = {
      userId: 'pilot',
      displayName: 'Pilot',
      rank: 1,
      claimedCellCount: 1,
      exclusiveCellCount: 1,
      sharedCellCount: 0,
      claimedAreaSquareMeters: 1_000_000,
    };
    const onSelect = vi.fn();
    renderCoverageLeaderboard({
      documentRef: {
        createElement: element,
        querySelector: (selector: string) => elements.get(selector) ?? null,
      },
      leaderboard: { leaders: [pilot], currentPilot: null },
      selectedPilotId: 'pilot',
      currentUserId: 'another-pilot',
      colorRegistry: { colorFor: () => '#1769AA' },
      onSelect,
    });
    const row = elements.get('[data-territory-list]')?.children[0] as any;
    expect(row.children).toHaveLength(3);
    expect(row.getAttribute('role')).toBe('row');
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.children[0].children[1].textContent).toBe('1.');
    expect(row.children[0].children[2].getAttribute('href')).toBe('/pilots/pilot');
    expect(row.children[0].children[2].textContent).toBe('Pilot');
    handlers.get('click')?.({ target: row.children[0].children[2] });
    expect(onSelect).not.toHaveBeenCalled();
    handlers.get('click')?.();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('renders the full result and a synchronized top-three compact result', () => {
    const element = () => {
      const attributes = new Map<string, string>();
      const classes = new Set<string>();
      const style = new Map<string, string>();
      const listeners = new Map<string, (event?: any) => void>();
      const node = {
        hidden: false,
        textContent: '',
        className: '',
        children: [] as any[],
        dataset: {} as Record<string, string>,
        classList: {
          add(name: string) {
            classes.add(name);
          },
          contains(name: string) {
            return classes.has(name);
          },
        },
        style: {
          setProperty(name: string, value: string) {
            style.set(name, value);
          },
          getPropertyValue(name: string) {
            return style.get(name) ?? '';
          },
        },
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
        getAttribute(name: string) {
          return attributes.get(name) ?? null;
        },
        addEventListener(name: string, listener: (event?: any) => void) {
          listeners.set(name, listener);
        },
        click(event?: any) {
          listeners.get('click')?.(event);
        },
        append(...children: any[]) {
          node.children.push(...children);
        },
        replaceChildren(...children: any[]) {
          node.children = children;
        },
      };
      return node;
    };
    const view = (variant: 'full' | 'compact') => {
      const list = element();
      const status = element();
      const current = variant === 'full' ? element() : null;
      const container: any = element();
      container.dataset.territoryLeaderboardVariant = variant;
      container.querySelector = (selector: string) =>
        new Map<string, any>([
          ['[data-territory-list]', list],
          ['[data-territory-status]', status],
          ['[data-territory-current-pilot]', current],
        ]).get(selector) ?? null;
      return { container, list, status, current };
    };
    const full = view('full');
    const compact = view('compact');
    const leaders = Array.from({ length: 5 }, (_, index) => ({
      userId: `pilot-${index + 1}`,
      displayName: `Pilot ${index + 1}`,
      rank: index + 1,
      claimedCellCount: 5 - index,
      claimedAreaSquareMeters: (5 - index) * 1_000_000,
    }));
    const currentPilot = {
      userId: 'current-pilot',
      displayName: 'Current Pilot',
      rank: 12,
      claimedCellCount: 1,
      claimedAreaSquareMeters: 500_000,
    };
    const colors = new Map(leaders.map((leader, index) => [leader.userId, `color-${index}`]));
    const onSelect = vi.fn();

    renderCoverageLeaderboard({
      documentRef: {
        createElement: element,
        querySelectorAll: () => [full.container, compact.container],
      },
      leaderboard: { leaders, currentPilot },
      selectedPilotId: 'pilot-2',
      currentUserId: 'current-pilot',
      colorRegistry: { colorFor: (userId: string) => colors.get(userId) ?? 'current-color' },
      onSelect,
    });

    expect(full.list.children).toHaveLength(5);
    expect(full.current?.children).toHaveLength(1);
    expect(compact.list.children).toHaveLength(3);
    expect(compact.current).toBeNull();
    for (const rendered of [full, compact]) {
      const selectedRow = rendered.list.children[1];
      expect(selectedRow.getAttribute('aria-pressed')).toBe('true');
      expect(selectedRow.classList.contains('is-selected')).toBe(true);
      expect(selectedRow.children[0].children[0].style.getPropertyValue('--pilot-color'))
        .toBe('color-1');
      expect(selectedRow.children[0].children[2].getAttribute('href')).toBe('/pilots/pilot-2');
      expect(selectedRow.children[0].children[2].textContent).toBe('Pilot 2');
    }
    expect(compact.status.hidden).toBe(false);
    expect(compact.status.children[0].getAttribute('href')).toBe('/pilots/pilot-2');

    compact.list.children[1].click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('returns the claimed competition cell at a click point', () => {
    const queryRenderedFeatures = vi.fn().mockReturnValue([]);
    const getLayer = vi.fn().mockReturnValue({ id: 'competition-territory-fill' });
    expect(coverageCellFeatureAtPoint({ getLayer, queryRenderedFeatures }, { x: 40, y: 50 })).toBeNull();
    expect(queryRenderedFeatures).toHaveBeenCalledWith(
      { x: 40, y: 50 },
      { layers: ['competition-territory-fill'] },
    );

    getLayer.mockReturnValue(undefined);
    queryRenderedFeatures.mockClear();
    expect(coverageCellFeatureAtPoint({ getLayer, queryRenderedFeatures }, { x: 40, y: 50 })).toBeNull();
    expect(queryRenderedFeatures).not.toHaveBeenCalled();
  });

  it('installs zoom 4-14 vector layers and changes tiles without changing paint', () => {
    const sources = new Map<string, any>();
    const layers: any[] = [];
    const map = {
      getSource: vi.fn((id: string) => sources.get(id)),
      addSource: vi.fn((id: string, source: any) => sources.set(id, { ...source, setTiles: vi.fn() })),
      addLayer: vi.fn((layer: any) => layers.push(layer)),
      setPaintProperty: vi.fn(),
      querySourceFeatures: vi.fn(() => [
        { properties: { pilotUserId: 'pilot-one' } },
        { properties: { pilotUserId: 'pilot-one' } },
      ]),
    };
    installCoverageSource(map, '/tiles/{z}/{x}/{y}.mvt', {
      minimumZoom: 4,
      maximumZoom: 14,
    });
    expect(map.addSource).toHaveBeenCalledWith('competition-coverage', {
      type: 'vector', tiles: ['/tiles/{z}/{x}/{y}.mvt'], minzoom: 4, maxzoom: 14,
    });
    expect(layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'competition-territory-fill', source: 'competition-coverage',
        'source-layer': 'competition-coverage', minzoom: 4,
      }),
      expect.objectContaining({
        id: 'competition-territory-outline', source: 'competition-coverage',
        'source-layer': 'competition-coverage', minzoom: 4,
      }),
    ]));
    expect(JSON.stringify(layers.find((layer) => layer.id === 'competition-territory-outline')))
      .not.toContain('["match",["get","pilotUserId"],"#94a3b8"]');

    updateCoverageTiles(map, '/next/{z}/{x}/{y}.mvt');
    expect(sources.get('competition-coverage').setTiles).toHaveBeenCalledWith([
      '/next/{z}/{x}/{y}.mvt',
    ]);
    assignLoadedCoverageColors(map, { colorFor: () => '#1769AA' });
    expect(map.setPaintProperty).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(map.setPaintProperty.mock.calls[0]?.[2])).toContain('#1769AA');
  });
});
