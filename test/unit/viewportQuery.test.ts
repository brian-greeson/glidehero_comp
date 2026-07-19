import { describe, expect, it } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { expandViewportBounds, normalizeViewportBounds, personalStatsUrl, viewportContains } from '../../public/scripts/viewportQuery.js';

function bounds(west = -107, east = -105) {
  return {
    getWest: () => west,
    getSouth: () => 39,
    getEast: () => east,
    getNorth: () => 41,
  };
}

describe('Viewport queries', () => {
  it('builds personal stats URLs', () => {
    expect(personalStatsUrl(bounds())).toBe(
      '/v1/personal-stats?west=-107&south=39&east=-105&north=41',
    );
  });

  it('normalizes wrapped and world-spanning viewports', () => {
    expect(normalizeViewportBounds(bounds(181, 183))).toMatchObject({ west: -179, east: -177 });
    expect(normalizeViewportBounds(bounds(-200, 200))).toMatchObject({ west: -180, east: 180 });
  });

  it('expands a viewport by half of its size on every edge', () => {
    expect(expandViewportBounds(bounds())).toEqual({ west: -108, south: 38, east: -104, north: 42 });
  });

  it('handles antimeridian buffer containment', () => {
    expect(expandViewportBounds({ west: 179, south: 88, east: -179, north: 89 })).toEqual({
      west: 178, south: 87.5, east: -178, north: 89.5,
    });
    expect(viewportContains(
      { west: 178, south: -2, east: -178, north: 2 },
      { west: 179, south: -1, east: -179, north: 1 },
    )).toBe(true);
  });
});
