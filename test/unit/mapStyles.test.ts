import { describe, expect, it } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { createTerritoryBoundaryLayer, createTerritoryFillLayer, MINIMUM_TERRITORY_PREFETCH_ZOOM, MINIMUM_TERRITORY_ZOOM } from '../../public/scripts/mapStyles.js';

describe('territory map styles', () => {
  it('builds a reusable territory fill layer', () => {
    expect(createTerritoryFillLayer({
      id: 'personal-fill',
      source: 'personal-source',
      color: '#1769AA',
    })).toEqual({
      id: 'personal-fill',
      type: 'fill',
      source: 'personal-source',
      minzoom: MINIMUM_TERRITORY_ZOOM,
      paint: { 'fill-color': '#1769AA', 'fill-opacity': 0.42 },
    });
  });

  it('builds a reusable two-pixel territory boundary layer', () => {
    expect(createTerritoryBoundaryLayer({
      id: 'personal-boundary',
      source: 'personal-source',
      color: '#1769AA',
    })).toEqual({
      id: 'personal-boundary',
      type: 'line',
      source: 'personal-source',
      minzoom: MINIMUM_TERRITORY_ZOOM,
      paint: { 'line-color': '#1769AA', 'line-width': 2 },
    });
  });

  it('shares the territory visibility and prefetch thresholds', () => {
    expect(MINIMUM_TERRITORY_ZOOM).toBe(8);
    expect(MINIMUM_TERRITORY_PREFETCH_ZOOM).toBe(9);
  });
});
