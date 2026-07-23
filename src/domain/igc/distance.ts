import type { IgcFix } from './types.js';

export const TOTAL_DISTANCE_CALC_VERSION = 1;
export const THREE_POINT_DISTANCE_CALC_VERSION = 1;
export const FOUR_POINT_DISTANCE_CALC_VERSION = 1;
export const FIVE_POINT_DISTANCE_CALC_VERSION = 1;
export const SIX_POINT_DISTANCE_CALC_VERSION = 1;

const EARTH_RADIUS_METERS = 6_371_000;
const MINIMUM_POINT_COUNT = 3;
const SIX_POINT_COUNT = 6;
const LEG_COUNT = SIX_POINT_COUNT - 1;

const radians = (degrees: number) => degrees * Math.PI / 180;

export function totalDistanceMeters(points: readonly IgcFix[]): number {
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index]!;
    const dLat = radians(point.latitude - previous.latitude);
    const dLon = radians(point.longitude - previous.longitude);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(radians(previous.latitude)) * Math.cos(radians(point.latitude)) * Math.sin(dLon / 2) ** 2;
    return total + EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, 0);
}

export type DistanceCoordinate = {
  latitude: number;
  longitude: number;
};

export type NPointCount = 3 | 4 | 5 | 6;

type PointIndicesByCount = {
  3: readonly [number, number, number];
  4: readonly [number, number, number, number];
  5: readonly [number, number, number, number, number];
  6: readonly [number, number, number, number, number, number];
};

export type PointDistance<PointCount extends NPointCount> = {
  distanceMeters: number;
  pointIndices: PointIndicesByCount[PointCount];
};

export type PointDistancePointMetadata = {
  sequenceNumber: number;
  recordedAt: string;
  latitude: number;
  longitude: number;
  gpsAltitudeMeters: number;
};

type PointMetadataByCount = {
  3: readonly [PointDistancePointMetadata, PointDistancePointMetadata, PointDistancePointMetadata];
  4: readonly [
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
  ];
  5: readonly [
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
  ];
  6: readonly [
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
    PointDistancePointMetadata,
  ];
};

type CalculationVersionByCount = {
  3: typeof THREE_POINT_DISTANCE_CALC_VERSION;
  4: typeof FOUR_POINT_DISTANCE_CALC_VERSION;
  5: typeof FIVE_POINT_DISTANCE_CALC_VERSION;
  6: typeof SIX_POINT_DISTANCE_CALC_VERSION;
};

export type PointDistanceMetadata<PointCount extends NPointCount> = PointDistance<PointCount> & {
  calculationVersion: CalculationVersionByCount[PointCount];
  points: PointMetadataByCount[PointCount];
};

export type NPointDistances = {
  threePointDistance: PointDistance<3>;
  fourPointDistance: PointDistance<4>;
  fivePointDistance: PointDistance<5>;
  sixPointDistance: PointDistance<6>;
};

export type NPointDistanceMetadata = {
  threePointDistance: PointDistanceMetadata<3>;
  fourPointDistance: PointDistanceMetadata<4>;
  fivePointDistance: PointDistanceMetadata<5>;
  sixPointDistance: PointDistanceMetadata<6>;
};

export type SixPointIndices = PointIndicesByCount[6];
export type SixPointDistance = PointDistance<6>;
export type SixPointDistancePointMetadata = PointDistancePointMetadata;
export type SixPointDistanceMetadata = PointDistanceMetadata<6>;

type MetadataSourcePoint = DistanceCoordinate & {
  sequenceNumber: number;
  recordedAt: Date | string;
  gpsAltitudeMeters: number;
};

function rankPaths(
  predecessorRanks: Int32Array,
  predecessors: Int32Array,
  minimumIndex: number,
): Int32Array<ArrayBuffer> {
  const rankedIndices: number[] = [];
  for (let index = minimumIndex; index < predecessors.length; index += 1) {
    if (predecessors[index]! >= 0) rankedIndices.push(index);
  }
  rankedIndices.sort((left, right) => {
    const predecessorRankDifference = predecessorRanks[predecessors[left]!]!
      - predecessorRanks[predecessors[right]!]!;
    return predecessorRankDifference || left - right;
  });

  const ranks = new Int32Array(predecessors.length);
  ranks.fill(-1);
  for (let rank = 0; rank < rankedIndices.length; rank += 1) {
    ranks[rankedIndices[rank]!] = rank;
  }
  return ranks;
}

function distanceBetweenUnitVectors(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  left: number,
  right: number,
): number {
  const dx = x[right]! - x[left]!;
  const dy = y[right]! - y[left]!;
  const dz = z[right]! - z[left]!;
  const halfChord = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(halfChord);
}

/**
 * Finds the exact longest paths through three, four, five, and six
 * chronologically ordered fixes in one dynamic-programming pass. All fixes are
 * considered.
 */
export function calculateNPointDistances(points: readonly DistanceCoordinate[]): NPointDistances {
  const pointCount = points.length;
  if (pointCount < SIX_POINT_COUNT) {
    throw new RangeError(`N-point solver requires at least ${SIX_POINT_COUNT} points.`);
  }

  const x = new Float64Array(pointCount);
  const y = new Float64Array(pointCount);
  const z = new Float64Array(pointCount);
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index]!;
    const latitude = radians(point.latitude);
    const longitude = radians(point.longitude);
    const cosLatitude = Math.cos(latitude);
    x[index] = cosLatitude * Math.cos(longitude);
    y[index] = cosLatitude * Math.sin(longitude);
    z[index] = Math.sin(latitude);
  }

  let previousScores = new Float64Array(pointCount);
  let previousRanks = Int32Array.from({ length: pointCount }, (_, index) => index);
  const predecessorLayers: Int32Array[] = [];
  const distances: Partial<NPointDistances> = {};

  for (let leg = 1; leg <= LEG_COUNT; leg += 1) {
    const scores = new Float64Array(pointCount);
    scores.fill(Number.NEGATIVE_INFINITY);
    const predecessors = new Int32Array(pointCount);
    predecessors.fill(-1);

    for (let right = leg; right < pointCount; right += 1) {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestPredecessor = -1;
      let bestPredecessorRank = Number.MAX_SAFE_INTEGER;
      for (let left = leg - 1; left < right; left += 1) {
        const candidateScore = previousScores[left]!
          + distanceBetweenUnitVectors(x, y, z, left, right);
        const candidateRank = previousRanks[left]!;
        if (
          candidateScore > bestScore
          || (candidateScore === bestScore && candidateRank < bestPredecessorRank)
        ) {
          bestScore = candidateScore;
          bestPredecessor = left;
          bestPredecessorRank = candidateRank;
        }
      }
      scores[right] = bestScore;
      predecessors[right] = bestPredecessor;
    }

    predecessorLayers.push(predecessors);
    previousScores = scores;
    previousRanks = rankPaths(previousRanks, predecessors, leg);

    if (leg >= MINIMUM_POINT_COUNT - 1) {
      let finalIndex = leg;
      for (let index = leg + 1; index < pointCount; index += 1) {
        if (
          previousScores[index]! > previousScores[finalIndex]!
          || (
            previousScores[index] === previousScores[finalIndex]
            && previousRanks[index]! < previousRanks[finalIndex]!
          )
        ) {
          finalIndex = index;
        }
      }

      const pointCountForResult = leg + 1 as NPointCount;
      const indices = new Array<number>(pointCountForResult);
      indices[leg] = finalIndex;
      for (let predecessorLeg = leg; predecessorLeg > 0; predecessorLeg -= 1) {
        indices[predecessorLeg - 1]
          = predecessorLayers[predecessorLeg - 1]![indices[predecessorLeg]!]!;
      }

      const distance = {
        distanceMeters: previousScores[finalIndex]!,
        pointIndices: indices,
      };
      if (pointCountForResult === 3) {
        distances.threePointDistance = distance as unknown as PointDistance<3>;
      } else if (pointCountForResult === 4) {
        distances.fourPointDistance = distance as unknown as PointDistance<4>;
      } else if (pointCountForResult === 5) {
        distances.fivePointDistance = distance as unknown as PointDistance<5>;
      } else {
        distances.sixPointDistance = distance as unknown as PointDistance<6>;
      }
    }
  }

  return distances as NPointDistances;
}

function mapPointDistanceMetadata<PointCount extends NPointCount>(
  points: readonly MetadataSourcePoint[],
  distance: PointDistance<PointCount>,
  calculationVersion: CalculationVersionByCount[PointCount],
): PointDistanceMetadata<PointCount> {
  const selectedPoints = distance.pointIndices.map((index) => {
    const point = points[index];
    if (!point) throw new RangeError(`Point index ${index} is outside the supplied metadata.`);
    return {
      sequenceNumber: point.sequenceNumber,
      recordedAt: point.recordedAt instanceof Date ? point.recordedAt.toISOString() : point.recordedAt,
      latitude: point.latitude,
      longitude: point.longitude,
      gpsAltitudeMeters: point.gpsAltitudeMeters,
    };
  }) as unknown as PointMetadataByCount[PointCount];

  return {
    ...distance,
    calculationVersion,
    points: selectedPoints,
  };
}

export function mapNPointDistanceMetadata(
  points: readonly MetadataSourcePoint[],
  distances: NPointDistances,
): NPointDistanceMetadata {
  return {
    threePointDistance: mapPointDistanceMetadata(
      points,
      distances.threePointDistance,
      THREE_POINT_DISTANCE_CALC_VERSION,
    ),
    fourPointDistance: mapPointDistanceMetadata(
      points,
      distances.fourPointDistance,
      FOUR_POINT_DISTANCE_CALC_VERSION,
    ),
    fivePointDistance: mapPointDistanceMetadata(
      points,
      distances.fivePointDistance,
      FIVE_POINT_DISTANCE_CALC_VERSION,
    ),
    sixPointDistance: mapPointDistanceMetadata(
      points,
      distances.sixPointDistance,
      SIX_POINT_DISTANCE_CALC_VERSION,
    ),
  };
}

/** @deprecated Use calculateNPointDistances to calculate every route in one pass. */
export function calculateSixPointDistance(points: readonly DistanceCoordinate[]): SixPointDistance {
  return calculateNPointDistances(points).sixPointDistance;
}

/** @deprecated Use mapNPointDistanceMetadata to map every route in one call. */
export function mapSixPointDistanceMetadata(
  points: readonly MetadataSourcePoint[],
  distance: SixPointDistance,
): SixPointDistanceMetadata {
  return mapPointDistanceMetadata<6>(points, distance, SIX_POINT_DISTANCE_CALC_VERSION);
}
