import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  calculateNPointDistances,
  calculateSixPointDistance,
  FIVE_POINT_DISTANCE_CALC_VERSION,
  FOUR_POINT_DISTANCE_CALC_VERSION,
  mapNPointDistanceMetadata,
  mapSixPointDistanceMetadata,
  SIX_POINT_DISTANCE_CALC_VERSION,
  THREE_POINT_DISTANCE_CALC_VERSION,
  TOTAL_DISTANCE_CALC_VERSION,
  type DistanceCoordinate,
  type NPointCount,
} from '../../src/domain/igc/distance.js';
import { parseIgcFlight } from '../../src/domain/igc/parseIgcFlight.js';

const EARTH_RADIUS_METERS = 6_371_000;

function distanceBetween(left: DistanceCoordinate, right: DistanceCoordinate): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const deltaLatitude = rightLatitude - leftLatitude;
  const deltaLongitude = radians(right.longitude - left.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bruteForceLongestPath(points: readonly DistanceCoordinate[], pointCount: NPointCount) {
  let bestDistance = Number.NEGATIVE_INFINITY;
  let bestIndices: number[] = [];

  const visit = (indices: number[], nextIndex: number) => {
    if (indices.length === pointCount) {
      const distance = indices.slice(1).reduce((total, index, offset) => (
        total + distanceBetween(points[indices[offset]!]!, points[index]!)
      ), 0);
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndices = [...indices];
      }
      return;
    }

    const remaining = pointCount - indices.length;
    for (let index = nextIndex; index <= points.length - remaining; index += 1) {
      visit([...indices, index], index + 1);
    }
  };

  visit([], 0);
  return { distanceMeters: bestDistance, pointIndices: bestIndices };
}

function createDeterministicPoints(seed: number, pointCount: number): DistanceCoordinate[] {
  let state = seed;
  const random = () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  return Array.from({ length: pointCount }, () => ({
    latitude: 39 + random() * 2,
    longitude: -106 + random() * 2,
  }));
}

describe('calculateNPointDistances', () => {
  it('matches brute-force optima for every route length', () => {
    const resultKeys = {
      3: 'threePointDistance',
      4: 'fourPointDistance',
      5: 'fivePointDistance',
      6: 'sixPointDistance',
    } as const;

    for (let seed = 1; seed <= 12; seed += 1) {
      const points = createDeterministicPoints(seed, 8);
      const results = calculateNPointDistances(points);
      for (const pointCount of [3, 4, 5, 6] as const) {
        const expected = bruteForceLongestPath(points, pointCount);
        const actual = results[resultKeys[pointCount]];
        expect(actual.pointIndices, `seed ${seed}, ${pointCount} points`)
          .toEqual(expected.pointIndices);
        expect(actual.distanceMeters, `seed ${seed}, ${pointCount} points`)
          .toBeCloseTo(expected.distanceMeters, 5);
      }
    }
  });

  it('selects the independently lexicographically earliest route at every length', () => {
    const points = Array.from({ length: 8 }, () => ({ latitude: 40, longitude: -105 }));

    expect(calculateNPointDistances(points)).toEqual({
      threePointDistance: { distanceMeters: 0, pointIndices: [0, 1, 2] },
      fourPointDistance: { distanceMeters: 0, pointIndices: [0, 1, 2, 3] },
      fivePointDistance: { distanceMeters: 0, pointIndices: [0, 1, 2, 3, 4] },
      sixPointDistance: { distanceMeters: 0, pointIndices: [0, 1, 2, 3, 4, 5] },
    });
  });

  it('maps every selected route to independently versioned metadata', () => {
    const points = Array.from({ length: 6 }, (_, index) => ({
      sequenceNumber: index + 10,
      recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      latitude: index,
      longitude: index === 0 ? 0 : -index,
      gpsAltitudeMeters: 1_000 + index,
    }));

    const metadata = mapNPointDistanceMetadata(points, calculateNPointDistances(points));

    expect(metadata.threePointDistance.calculationVersion).toBe(THREE_POINT_DISTANCE_CALC_VERSION);
    expect(metadata.fourPointDistance.calculationVersion).toBe(FOUR_POINT_DISTANCE_CALC_VERSION);
    expect(metadata.fivePointDistance.calculationVersion).toBe(FIVE_POINT_DISTANCE_CALC_VERSION);
    expect(metadata.sixPointDistance.calculationVersion).toBe(SIX_POINT_DISTANCE_CALC_VERSION);
    expect(metadata.threePointDistance.points).toHaveLength(3);
    expect(metadata.fourPointDistance.points).toHaveLength(4);
    expect(metadata.fivePointDistance.points).toHaveLength(5);
    expect(metadata.sixPointDistance.points).toHaveLength(6);
    expect(metadata.threePointDistance.points[0]).toEqual({
      sequenceNumber: 10,
      recordedAt: '2026-01-01T00:00:00.000Z',
      latitude: 0,
      longitude: 0,
      gpsAltitudeMeters: 1_000,
    });
  });

  it('requires enough fixes to calculate every route', () => {
    expect(() => calculateNPointDistances(Array.from(
      { length: 5 },
      () => ({ latitude: 0, longitude: 0 }),
    ))).toThrow('requires at least 6 points');
  });
});

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
