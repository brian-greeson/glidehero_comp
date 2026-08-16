export const FLIGHT_MAP_PROJECTION_VERSION = 1;
export const FLIGHT_MAP_FULL_GEOMETRY_MIN_ZOOM = 13;

const WEB_MERCATOR_RADIUS_METERS = 6_378_137;
const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
const TILE_SIZE_PIXELS = 512;
const RENDER_ERROR_PIXELS = 0.75;

export type FlightMapPoint = {
  sequenceNumber: number;
  latitude: number;
  longitude: number;
};

export type FlightMapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
  crossesAntimeridian: boolean;
};

export type FlightMapLodDefinition = {
  minZoom: number;
  maxZoom: number;
  toleranceMeters: number;
};

export type FlightMapProjection = {
  projectionVersion: typeof FLIGHT_MAP_PROJECTION_VERSION;
  fullTrack: GeoJSONMultiLineString;
  bounds: FlightMapBounds;
  landingLatitude: number;
  landingLongitude: number;
  sourcePointCount: number;
  lods: Array<FlightMapLodDefinition & { geometry: GeoJSONMultiLineString; pointCount: number }>;
};

export type GeoJSONMultiLineString = {
  type: 'MultiLineString';
  coordinates: number[][][];
};

export const FLIGHT_MAP_LOD_DEFINITIONS: readonly FlightMapLodDefinition[] = [
  { minZoom: 0, maxZoom: 7, toleranceMeters: webMercatorMetersPerPixel(7) * RENDER_ERROR_PIXELS },
  { minZoom: 8, maxZoom: 10, toleranceMeters: webMercatorMetersPerPixel(10) * RENDER_ERROR_PIXELS },
  { minZoom: 11, maxZoom: 12, toleranceMeters: webMercatorMetersPerPixel(12) * RENDER_ERROR_PIXELS },
];

function webMercatorMetersPerPixel(zoom: number): number {
  return (2 * Math.PI * WEB_MERCATOR_RADIUS_METERS) / (TILE_SIZE_PIXELS * 2 ** zoom);
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function projected(point: readonly number[]): readonly [number, number] {
  const latitude = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, point[1]!));
  return [
    WEB_MERCATOR_RADIUS_METERS * point[0]! * Math.PI / 180,
    WEB_MERCATOR_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)),
  ];
}

function squareDistanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const [px, py] = point;
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (dx === 0 && dy === 0) return (px - sx) ** 2 + (py - sy) ** 2;
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx ** 2 + dy ** 2)));
  return (px - (sx + t * dx)) ** 2 + (py - (sy + t * dy)) ** 2;
}

function simplifyRanges(
  points: readonly (readonly [number, number])[],
  ranges: Array<readonly [number, number]>,
  toleranceSquared: number,
  keep: Set<number>,
): void {
  while (ranges.length > 0) {
    const [first, last] = ranges.pop()!;
    let furthest = -1;
    let furthestDistance = toleranceSquared;
    for (let index = first + 1; index < last; index += 1) {
      const distance = squareDistanceToSegment(points[index]!, points[first]!, points[last]!);
      if (distance > furthestDistance) {
        furthest = index;
        furthestDistance = distance;
      }
    }
    if (furthest < 0) continue;
    keep.add(furthest);
    ranges.push([furthest, last], [first, furthest]);
  }
}

/** Douglas-Peucker in Web Mercator, divided at protected source fixes. */
export function simplifyTrackSegment(
  points: readonly number[][],
  toleranceMeters: number,
  protectedIndexes: ReadonlySet<number> = new Set(),
): number[][] {
  if (points.length <= 2 || toleranceMeters <= 0) return points.map((point) => [...point]);
  const anchors = [...new Set([0, points.length - 1, ...protectedIndexes])]
    .filter((index) => index >= 0 && index < points.length)
    .sort((left, right) => left - right);
  const keep = new Set(anchors);
  const projectedPoints = points.map(projected);
  const ranges: Array<readonly [number, number]> = [];
  for (let index = 1; index < anchors.length; index += 1) {
    ranges.push([anchors[index - 1]!, anchors[index]!]);
  }
  simplifyRanges(projectedPoints, ranges, toleranceMeters ** 2, keep);
  return [...keep].sort((left, right) => left - right).map((index) => [...points[index]!]);
}

/**
 * Splits a track at the antimeridian. Interpolated +/-180 boundary points keep
 * each stored line local, so PostGIS indexes do not span almost the whole world.
 */
export function splitTrackAtAntimeridian(points: readonly FlightMapPoint[]): {
  segments: number[][][];
  sourceLocations: Map<number, { segmentIndex: number; pointIndex: number }>;
  datelineSequenceNumbers: Set<number>;
} {
  if (points.length < 2) throw new RangeError('A flight map trajectory requires at least two points.');
  const first = points[0]!;
  const segments: number[][][] = [[[normalizeLongitude(first.longitude), first.latitude]]];
  const sourceLocations = new Map<number, { segmentIndex: number; pointIndex: number }>();
  const datelineSequenceNumbers = new Set<number>();
  sourceLocations.set(first.sequenceNumber, { segmentIndex: 0, pointIndex: 0 });
  let previous = first;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index]!;
    let segment = segments.at(-1)!;
    let previousLongitude = segment.at(-1)![0]!;
    let currentLongitude = normalizeLongitude(current.longitude);
    const delta = currentLongitude - previousLongitude;
    if (Math.abs(delta) > 180) {
      // A fix exactly on the dateline can be represented on either side. Keep
      // a first fix with its neighbour. Otherwise duplicate the boundary onto
      // the new local segment instead of mutating the preceding line into a
      // world-spanning 179 -> -180 edge.
      if (Math.abs(previousLongitude) === 180) {
        const localBoundary = Math.sign(delta) * 180;
        if (segment.length === 1) {
          segment.at(-1)![0] = localBoundary;
          segment.push([currentLongitude, current.latitude]);
        } else {
          segments.push([[localBoundary, previous.latitude], [currentLongitude, current.latitude]]);
          segment = segments.at(-1)!;
          datelineSequenceNumbers.add(previous.sequenceNumber);
          datelineSequenceNumbers.add(current.sequenceNumber);
        }
      } else if (Math.abs(currentLongitude) === 180) {
        currentLongitude = -Math.sign(delta) * 180;
        segment.push([currentLongitude, current.latitude]);
      } else {
        datelineSequenceNumbers.add(previous.sequenceNumber);
        datelineSequenceNumbers.add(current.sequenceNumber);
        const unwrappedCurrent = currentLongitude + (delta > 180 ? -360 : 360);
        const boundary = delta > 180 ? -180 : 180;
        const fraction = (boundary - previousLongitude) / (unwrappedCurrent - previousLongitude);
        const latitude = previous.latitude + fraction * (current.latitude - previous.latitude);
        segment.push([boundary, latitude]);
        segments.push([[-boundary, latitude], [currentLongitude, current.latitude]]);
        segment = segments.at(-1)!;
      }
    } else {
      segment.push([currentLongitude, current.latitude]);
    }
    sourceLocations.set(current.sequenceNumber, { segmentIndex: segments.length - 1, pointIndex: segment.length - 1 });
    previous = current;
  }
  return { segments, sourceLocations, datelineSequenceNumbers };
}

/** Minimal circular longitude interval; west > east denotes a dateline crossing. */
export function exactFlightMapBounds(points: readonly FlightMapPoint[]): FlightMapBounds {
  if (!points.length) throw new RangeError('Flight map bounds require at least one point.');
  const longitudes: number[] = [];
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    longitudes.push(normalizeLongitude(point.longitude));
    if (point.latitude < south) south = point.latitude;
    if (point.latitude > north) north = point.latitude;
  }
  longitudes.sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;
  for (let index = 0; index < longitudes.length; index += 1) {
    const current = longitudes[index]!;
    const next = index === longitudes.length - 1 ? longitudes[0]! + 360 : longitudes[index + 1]!;
    if (next - current > largestGap) {
      largestGap = next - current;
      gapIndex = index;
    }
  }
  const west = longitudes[(gapIndex + 1) % longitudes.length]!;
  const east = longitudes[gapIndex]!;
  return {
    west,
    south,
    east,
    north,
    crossesAntimeridian: west > east,
  };
}

export function buildFlightMapProjection(
  points: readonly FlightMapPoint[],
  protectedSequenceNumbers: ReadonlySet<number> = new Set(),
): FlightMapProjection {
  const { segments, sourceLocations, datelineSequenceNumbers } = splitTrackAtAntimeridian(points);
  const protectedBySegment = segments.map(() => new Set<number>());
  for (const sequenceNumber of new Set([...protectedSequenceNumbers, ...datelineSequenceNumbers])) {
    const location = sourceLocations.get(sequenceNumber);
    if (location) protectedBySegment[location.segmentIndex]!.add(location.pointIndex);
  }
  const lods = FLIGHT_MAP_LOD_DEFINITIONS.map((definition) => {
    const coordinates = segments.map((segment, segmentIndex) =>
      simplifyTrackSegment(segment, definition.toleranceMeters, protectedBySegment[segmentIndex]));
    return {
      ...definition,
      geometry: { type: 'MultiLineString' as const, coordinates },
      pointCount: coordinates.reduce((total, segment) => total + segment.length, 0),
    };
  });
  const landing = points.at(-1)!;
  return {
    projectionVersion: FLIGHT_MAP_PROJECTION_VERSION,
    fullTrack: { type: 'MultiLineString', coordinates: segments },
    bounds: exactFlightMapBounds(points),
    landingLatitude: landing.latitude,
    landingLongitude: normalizeLongitude(landing.longitude),
    sourcePointCount: points.length,
    lods,
  };
}
