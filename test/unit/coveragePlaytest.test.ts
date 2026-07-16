import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { arenaCoverageLeaderboardUrl, coverageTerritoryUrl, globalCoverageLeaderboardUrl } from '../../public/scripts/coveragePlaytestApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { colorCoverageTerritory } from '../../public/scripts/coveragePlaytestMap.js';

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

  it('adds selected-pilot color properties without changing overview features', () => {
    const geojson = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { claimantCount: 2, isShared: true }, geometry: null }],
    };
    expect(colorCoverageTerritory(geojson, '#1769AA', 'pilot').features[0].properties).toEqual({
      claimantCount: 2, isShared: true, pilotUserId: 'pilot', displayColor: '#1769AA',
    });
    expect(colorCoverageTerritory(geojson, null, null).features[0].properties).toEqual({
      claimantCount: 2, isShared: true,
    });
  });
});
