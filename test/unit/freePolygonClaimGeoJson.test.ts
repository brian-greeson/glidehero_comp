import { describe, expect, it } from 'vitest';
import { emptyFreePolygonClaimGeoJson } from '../../src/domain/territory/freePolygonClaimGeoJson.js';

describe('FreePolygonClaim GeoJSON', () => {
  it('creates a new empty FeatureCollection for pilots with no claim projection', () => {
    const first = emptyFreePolygonClaimGeoJson();
    const second = emptyFreePolygonClaimGeoJson();

    expect(first).toEqual({ type: 'FeatureCollection', features: [] });
    expect(second).not.toBe(first);
  });
});
