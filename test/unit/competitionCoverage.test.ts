import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { arenaCoverageLeaderboardUrl, coverageCellClaimantsUrl, coverageTerritoryTileUrl, globalCoverageLeaderboardUrl } from '../../public/scripts/competitionCoverageApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { createCompetitionColorRegistry } from '../../public/scripts/competitionColors.js';
// @ts-expect-error Browser assets remain JavaScript.
import { assignLoadedCoverageColors, coverageCellFeatureAtPoint, installCoverageSource, isExclusiveCoverageFeature, positionCoverageCellPopup, updateCoverageTiles } from '../../public/scripts/competitionCoverageMap.js';
// @ts-expect-error Browser assets remain JavaScript.
import { renderCoverageLeaderboard } from '../../public/scripts/competitionCoverageLeaderboard.js';

describe('competition coverage browser contracts', () => {
  it('builds canonical Global, Arena, territory, and claimant URLs', () => {
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
    expect(coverageCellClaimantsUrl(1, 2, '2026-07')).toBe(
      '/v1/competition-cells/1/2/claimants?month=2026-07',
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

  it('positions claimant popups and distinguishes claimed-cell taps', () => {
    const popup = {
      offsetWidth: 120,
      offsetHeight: 80,
      dataset: {} as Record<string, string>,
      style: { left: '', top: '' },
    };
    positionCoverageCellPopup(popup, { x: 10, y: 40 }, 320);
    expect(popup.style).toEqual({ left: '68px', top: '40px' });
    expect(popup.dataset.placement).toBe('below');
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

  it('only treats exclusively claimed cells as hoverable', () => {
    expect(
      isExclusiveCoverageFeature({
        properties: {
          cellId: '500:12:-3',
          claimantCount: 1,
          isShared: false,
          pilotUserId: 'pilot-one',
        },
      }),
    ).toBe(true);
    expect(
      isExclusiveCoverageFeature({
        properties: {
          cellId: '500:12:-3',
          claimantCount: 2,
          isShared: true,
        },
      }),
    ).toBe(false);
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
