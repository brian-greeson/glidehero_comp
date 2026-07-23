import type { IgcFix } from './types.js';

export const TOTAL_DISTANCE_CALC_VERSION = 1;
export const SIX_POINT_DISTANCE_CALC_VERSION = 1;

const EARTH_RADIUS_METERS = 6_371_000;
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

export type SixPointIndices = readonly [number, number, number, number, number, number];

export type SixPointDistance = {
  distanceMeters: number;
  pointIndices: SixPointIndices;
};

export type SixPointDistancePointMetadata = {
  sequenceNumber: number;
  recordedAt: string;
  latitude: number;
  longitude: number;
  gpsAltitudeMeters: number;
};

export type SixPointDistanceMetadata = SixPointDistance & {
  calculationVersion: typeof SIX_POINT_DISTANCE_CALC_VERSION;
  points: readonly [
    SixPointDistancePointMetadata,
    SixPointDistancePointMetadata,
    SixPointDistancePointMetadata,
    SixPointDistancePointMetadata,
    SixPointDistancePointMetadata,
    SixPointDistancePointMetadata,
  ];
};

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
 * Finds the exact longest five-leg path through six chronologically ordered
 * fixes. All fixes are considered; callers that need isolation from the event
 * loop should use calculateSixPointDistanceInWorker.
 */
export function calculateSixPointDistance(points: readonly DistanceCoordinate[]): SixPointDistance {
  const pointCount = points.length;
  if (pointCount < SIX_POINT_COUNT) {
    throw new RangeError(`Six-point distance requires at least ${SIX_POINT_COUNT} points.`);
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
  }

  let finalIndex = LEG_COUNT;
  for (let index = LEG_COUNT + 1; index < pointCount; index += 1) {
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

  const indices = new Array<number>(SIX_POINT_COUNT);
  indices[LEG_COUNT] = finalIndex;
  for (let leg = LEG_COUNT; leg > 0; leg -= 1) {
    indices[leg - 1] = predecessorLayers[leg - 1]![indices[leg]!]!;
  }

  return {
    distanceMeters: previousScores[finalIndex]!,
    pointIndices: indices as unknown as SixPointIndices,
  };
}

export function mapSixPointDistanceMetadata(
  points: readonly MetadataSourcePoint[],
  distance: SixPointDistance,
): SixPointDistanceMetadata {
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
  }) as unknown as SixPointDistanceMetadata['points'];

  return {
    ...distance,
    calculationVersion: SIX_POINT_DISTANCE_CALC_VERSION,
    points: selectedPoints,
  };
}
