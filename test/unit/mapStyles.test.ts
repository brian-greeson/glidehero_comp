import { describe, expect, it } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { createTerritoryBoundaryLayer, createTerritoryFillLayer } from '../../public/scripts/mapStyles.js';

describe('territory map styles', () => {
  it('builds a reusable territory fill layer', () => {
    expect(createTerritoryFillLayer({
      id: 'personal-fill',
      source: 'personal-source',
      color: '#1769AA',
      minzoom: 4,
      sourceLayer: 'personal-territory',
    })).toEqual({
      id: 'personal-fill',
      type: 'fill',
      source: 'personal-source',
      'source-layer': 'personal-territory',
      minzoom: 4,
      paint: { 'fill-color': '#1769AA', 'fill-opacity': 0.42 },
    });
  });

  it('builds a reusable two-pixel territory boundary layer', () => {
    expect(createTerritoryBoundaryLayer({
      id: 'personal-boundary',
      source: 'personal-source',
      color: '#1769AA',
      minzoom: 4,
      sourceLayer: 'personal-territory',
    })).toEqual({
      id: 'personal-boundary',
      type: 'line',
      source: 'personal-source',
      'source-layer': 'personal-territory',
      minzoom: 4,
      paint: { 'line-color': '#1769AA', 'line-width': 2 },
    });
  });
});
