import { describe, expect, it } from 'vitest';
import { routeDistanceMeters, thermalGuidedLeg } from '../../src/domain/thermal/thermalRoute.js';

describe('thermal-guided route domain', () => {
  const start = { latitude: 39, longitude: -105 };
  const end = { latitude: 39, longitude: -104.9 };
  const candidate = { latitude: 39.01, longitude: -104.95, relativeScore: 1, areaSquareMeters: 250_000 };

  it('keeps zero-percent routes direct', () => {
    const result = thermalGuidedLeg({ start, end, maximumDeviationPercent: 0, candidates: [candidate] });
    expect(result.points).toEqual([start, end]);
    expect(result.routeDistanceMeters).toBe(result.directDistanceMeters);
  });

  it('may visit favorable lift without exceeding the per-leg ceiling', () => {
    const result = thermalGuidedLeg({ start, end, maximumDeviationPercent: 100, candidates: [candidate] });
    expect(result.points).toContainEqual(candidate);
    expect(result.routeDistanceMeters).toBeLessThanOrEqual(result.maximumDistanceMeters);
    expect(routeDistanceMeters(result.points)).toBeCloseTo(result.routeDistanceMeters);
  });

  it('does not insert duplicate candidate points', () => {
    const result = thermalGuidedLeg({
      start, end, maximumDeviationPercent: 100,
      candidates: [candidate, { ...candidate }],
    });
    expect(result.points.filter((point) => point.latitude === candidate.latitude && point.longitude === candidate.longitude)).toHaveLength(1);
  });

  it('does not spend deviation on an excessively distant area', () => {
    const result = thermalGuidedLeg({
      start, end, maximumDeviationPercent: 10,
      candidates: [{ latitude: 40, longitude: -104.95, relativeScore: 1, areaSquareMeters: 1_000_000 }],
    });
    expect(result.points).toEqual([start, end]);
  });
});
