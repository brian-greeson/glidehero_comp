import { describe, expect, it } from 'vitest';
import { emptyGridClaimGeoJson } from '../../src/domain/territory/gridClaimGeoJson.js';

describe('GridClaim GeoJSON', () => {
  it('creates a new empty FeatureCollection for pilots with no grid claims', () => {
    const first = emptyGridClaimGeoJson();
    const second = emptyGridClaimGeoJson();

    expect(first).toEqual({ type: 'FeatureCollection', features: [] });
    expect(second).not.toBe(first);
  });
});
