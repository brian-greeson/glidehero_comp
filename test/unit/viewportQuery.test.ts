import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { competitionLeaderboardUrl, normalizeViewportBounds, personalStatsUrl } from '../../public/scripts/viewportQuery.js';

function bounds(west = -107, east = -105) {
  return {
    getWest: () => west,
    getSouth: () => 39,
    getEast: () => east,
    getNorth: () => 41,
  };
}

describe('Viewport queries', () => {
  it('builds monthly and all-time competition leaderboard URLs', () => {
    expect(competitionLeaderboardUrl(bounds(), '2026-07')).toBe(
      '/v1/competition-leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41',
    );
    expect(competitionLeaderboardUrl(bounds())).toBe(
      '/v1/competition-leaderboard?west=-107&south=39&east=-105&north=41',
    );
  });

  it('builds personal stats URLs', () => {
    expect(personalStatsUrl(bounds())).toBe(
      '/v1/personal-stats?west=-107&south=39&east=-105&north=41',
    );
  });

  it('normalizes wrapped and world-spanning viewports', () => {
    expect(normalizeViewportBounds(bounds(181, 183))).toMatchObject({ west: -179, east: -177 });
    expect(normalizeViewportBounds(bounds(-200, 200))).toMatchObject({ west: -180, east: 180 });
  });
});
