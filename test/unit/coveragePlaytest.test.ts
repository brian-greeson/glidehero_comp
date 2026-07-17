import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { arenaCoverageLeaderboardUrl, coverageTerritoryUrl, globalCoverageLeaderboardUrl } from '../../public/scripts/coveragePlaytestApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { colorCoverageTerritory } from '../../public/scripts/coveragePlaytestMap.js';
// @ts-expect-error Browser assets remain JavaScript.
import { renderCoverageLeaderboard } from '../../public/scripts/coveragePlaytestLeaderboard.js';

describe('coverage playtest browser contracts', () => {
  it('preserves the month/all-time API contract for Global and Arena scopes', () => {
    const bounds = { getWest: () => -107, getSouth: () => 39, getEast: () => -105, getNorth: () => 41 };
    expect(globalCoverageLeaderboardUrl(bounds)).toBe(
      '/v1/playtest/coverage/global/leaderboard?west=-107&south=39&east=-105&north=41',
    );
    expect(globalCoverageLeaderboardUrl(bounds, '2026-07')).toContain('month=2026-07');
    expect(arenaCoverageLeaderboardUrl('745', '2026-07')).toBe(
      '/v1/playtest/coverage/arenas/745/leaderboard?month=2026-07',
    );
    expect(coverageTerritoryUrl({ arenaSourceId: '745', pilotUserId: 'pilot', month: '2026-07' }))
      .toBe('/v1/playtest/coverage/arenas/745/territory?month=2026-07&pilot=pilot');
  });

  it('colors overview and selected-pilot cells from the leaderboard color registry', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { claimantCount: 1, isShared: false, pilotUserId: 'pilot' }, geometry: null },
        { type: 'Feature', properties: { claimantCount: 2, isShared: true }, geometry: null },
      ],
    };
    const colored = colorCoverageTerritory(geojson, { colorFor: () => '#1769AA' });
    expect(colored.features[0].properties).toEqual({
      claimantCount: 1, isShared: false, pilotUserId: 'pilot', displayColor: '#1769AA',
    });
    expect(colored.features[1].properties).toEqual({
      claimantCount: 2, isShared: true,
    });
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
      addEventListener(event: string, handler: () => void) { handlers.set(event, handler); },
      append(...children: any[]) { this.children.push(...children); },
      replaceChildren(...children: any[]) { this.children = children; },
    });
    const list = element();
    const status = element();
    const current = element();
    const documentRef = {
      createElement: element,
      querySelector(selector: string) {
        return new Map([
          ['[data-coverage-list]', list],
          ['[data-coverage-status]', status],
          ['[data-coverage-current-pilot]', current],
        ]).get(selector) ?? null;
      },
    };
    const pilot = {
      userId: 'pilot', displayName: 'Pilot', rank: 1, claimedCellCount: 1,
      exclusiveCellCount: 1, sharedCellCount: 0, claimedAreaSquareMeters: 1_000_000,
    };
    const onSelect = vi.fn();
    renderCoverageLeaderboard({
      documentRef,
      leaderboard: { leaders: [pilot], currentPilot: null },
      selectedPilotId: 'pilot',
      currentUserId: 'another-pilot',
      colorRegistry: { colorFor: () => '#1769AA' },
      onSelect,
    });
    handlers.get('click')?.();
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
