import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { arenaCoverageLeaderboardUrl, coverageCellClaimantsUrl, coverageTerritoryUrl, globalCoverageLeaderboardUrl } from '../../public/scripts/competitionCoverageApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { createCompetitionColorRegistry } from '../../public/scripts/competitionColors.js';
// @ts-expect-error Browser assets remain JavaScript.
import { colorCoverageTerritory, coverageCellFeatureAtPoint, isExclusiveCoverageFeature, positionCoverageCellPopup, setCoverageData } from '../../public/scripts/competitionCoverageMap.js';
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
    expect(
      coverageTerritoryUrl({ arenaSourceId: '745', bounds, pilotUserId: 'pilot', month: '2026-07' }),
    ).toBe('/v1/arenas/745/competition-territory?month=2026-07&west=-107&south=39&east=-105&north=41&pilot=pilot');
    expect(coverageCellClaimantsUrl(1, 2, '2026-07')).toBe(
      '/v1/competition-cells/1/2/claimants?month=2026-07',
    );
  });

  it('assigns stable colors shared by map and leaderboard consumers', () => {
    const registry = createCompetitionColorRegistry('current', '#1769AA', () => 0.5);
    expect(registry.colorFor('current')).toBe('#1769AA');
    expect(registry.colorFor('other')).toBe(registry.colorFor('other'));
  });

  it('colors selected-pilot cells from the leaderboard color registry', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { claimantCount: 1, isShared: false, pilotUserId: 'pilot' },
          geometry: null,
        },
        { type: 'Feature', properties: { claimantCount: 2, isShared: true }, geometry: null },
      ],
    };
    const colored = colorCoverageTerritory(geojson, { colorFor: () => '#1769AA' });
    expect(colored.features[0].properties.displayColor).toBe('#1769AA');
    expect(colored.features[1].properties).not.toHaveProperty('displayColor');
  });

  it('reports null when the selected leaderboard pilot is tapped again', () => {
    const handlers = new Map<string, () => void>();
    const element = () => ({
      hidden: false,
      textContent: '',
      className: '',
      children: [] as any[],
      classList: { add() {} },
      style: { setProperty() {} },
      setAttribute() {},
      addEventListener(event: string, handler: () => void) {
        handlers.set(event, handler);
      },
      append(...children: any[]) {
        this.children.push(...children);
      },
      replaceChildren(...children: any[]) {
        this.children = children;
      },
    });
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
    expect((elements.get('[data-territory-list]')?.children[0] as any).children).toHaveLength(3);
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

  it('adds coverage fill and outline layers without hover highlights', () => {
    const layers = new Map<string, any>();
    const map = {
      addSource: vi.fn(),
      getSource: vi.fn(),
      addLayer: vi.fn((layer: any) => layers.set(layer.id, layer)),
      getLayer: vi.fn((id: string) => layers.get(id)),
      setFilter: vi.fn(),
    };

    setCoverageData(map, { type: 'FeatureCollection', features: [] });
    expect(layers.has('competition-territory-fill')).toBe(true);
    expect(layers.has('competition-territory-outline')).toBe(true);
    expect([...layers].some((layerId) => layerId.includes('hover'))).toBe(false);
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
});
