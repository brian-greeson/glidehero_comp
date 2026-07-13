import { describe, expect, it } from 'vitest';
import { emptyPersonalTerritoryGeoJson } from '../../src/domain/territory/personalTerritoryGeoJson.js';

describe('personal territory GeoJSON', () => {
  it('creates a new empty FeatureCollection for pilots with no territory', () => {
    const first = emptyPersonalTerritoryGeoJson();
    const second = emptyPersonalTerritoryGeoJson();

    expect(first).toEqual({ type: 'FeatureCollection', features: [] });
    expect(second).toEqual({ type: 'FeatureCollection', features: [] });
    expect(second).not.toBe(first);
  });
});
