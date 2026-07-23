import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateSixPointDistance,
  mapSixPointDistanceMetadata,
  SIX_POINT_DISTANCE_CALC_VERSION,
  TOTAL_DISTANCE_CALC_VERSION,
} from '../../src/domain/igc/distance.js';
import { parseIgcFlight } from '../../src/domain/igc/parseIgcFlight.js';

describe('calculateSixPointDistance', () => {
  it('finds the exact longest five-leg path', () => {
    const points = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 10 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 11 },
      { latitude: 0, longitude: 2 },
      { latitude: 0, longitude: 12 },
      { latitude: 0, longitude: 3 },
    ];

    expect(calculateSixPointDistance(points).pointIndices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('selects the lexicographically earliest indices when distances tie', () => {
    const points = Array.from({ length: 8 }, () => ({ latitude: 40, longitude: -105 }));

    expect(calculateSixPointDistance(points)).toEqual({
      distanceMeters: 0,
      pointIndices: [0, 1, 2, 3, 4, 5],
    });
  });

  it('requires six points', () => {
    expect(() => calculateSixPointDistance(Array.from(
      { length: 5 },
      () => ({ latitude: 0, longitude: 0 }),
    ))).toThrow('requires at least 6 points');
  });

  it('maps the selected fixes to a versioned JSON-safe metadata snapshot', () => {
    const points = Array.from({ length: 6 }, (_, index) => ({
      sequenceNumber: index + 10,
      recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      latitude: index,
      longitude: index === 0 ? 0 : -index,
      gpsAltitudeMeters: 1_000 + index,
    }));
    const distance = calculateSixPointDistance(points);

    expect(TOTAL_DISTANCE_CALC_VERSION).toBe(1);
    const metadata = mapSixPointDistanceMetadata(points, distance);
    expect(metadata).toMatchObject({
      calculationVersion: SIX_POINT_DISTANCE_CALC_VERSION,
      pointIndices: [0, 1, 2, 3, 4, 5],
    });
    expect(metadata.points).toHaveLength(6);
    expect(metadata.points[0]).toEqual({
      sequenceNumber: 10,
      recordedAt: '2026-01-01T00:00:00.000Z',
      latitude: 0,
      longitude: 0,
      gpsAltitudeMeters: 1_000,
    });
  });

  it('matches the known optimum for the real 10,835-fix flight', { timeout: 120_000 }, () => {
    const source = readFileSync(
      new URL('../inputs/2026-05-10-XNA-54F3F9B76F42505D1B592F21726CAF48-01.igc', import.meta.url),
      'utf8',
    );
    const flight = parseIgcFlight(source);

    expect(calculateSixPointDistance(flight.points).pointIndices)
      .toEqual([1490, 2692, 7161, 9223, 9634, 10708]);
  });
});
