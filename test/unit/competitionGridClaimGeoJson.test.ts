import { describe, expect, it } from 'vitest';
import { emptyCompetitionGridClaimGeoJson } from '../../src/domain/territory/competitionGridClaimGeoJson.js';

describe('CompetitionGridClaimGeoJson', () => {
  it('creates a fresh empty FeatureCollection', () => {
    const first = emptyCompetitionGridClaimGeoJson();
    const second = emptyCompetitionGridClaimGeoJson();

    expect(first).toEqual({ type: 'FeatureCollection', features: [] });
    expect(second).not.toBe(first);
  });
});
