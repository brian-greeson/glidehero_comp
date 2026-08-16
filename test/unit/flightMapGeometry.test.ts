import { describe, expect, it } from 'vitest';
import {
  FLIGHT_MAP_LOD_DEFINITIONS,
  FLIGHT_MAP_PROJECTION_VERSION,
  buildFlightMapProjection,
  exactFlightMapBounds,
  simplifyTrackSegment,
  splitTrackAtAntimeridian,
} from '../../src/domain/flightMap/flightMapGeometry.js';

const point = (sequenceNumber: number, longitude: number, latitude = 40) => ({ sequenceNumber, longitude, latitude });

describe('flight map geometry', () => {
  it('computes ordinary exact bounds from every source fix', () => {
    expect(exactFlightMapBounds([
      point(0, -105, 40), point(1, -104, 39), point(2, -103, 41),
    ])).toEqual({ west: -105, south: 39, east: -103, north: 41, crossesAntimeridian: false });
  });

  it('uses a wrapped exact interval for antimeridian-crossing flights', () => {
    expect(exactFlightMapBounds([
      point(0, 179, 10), point(1, -179, 11), point(2, 178, 12),
    ])).toEqual({ west: 178, south: 10, east: -179, north: 12, crossesAntimeridian: true });
  });

  it('splits crossings into local lines with interpolated dateline endpoints', () => {
    const result = splitTrackAtAntimeridian([point(0, 179, 10), point(1, -179, 12)]);
    expect(result.segments).toEqual([
      [[179, 10], [180, 11]],
      [[-180, 11], [-179, 12]],
    ]);
    expect(result.sourceLocations.get(1)).toEqual({ segmentIndex: 1, pointIndex: 1 });
  });

  it('does not create a degenerate segment for a fix exactly on the dateline', () => {
    expect(splitTrackAtAntimeridian([point(0, -180, 10), point(1, 179, 11)]).segments)
      .toEqual([[[180, 10], [179, 11]]]);
  });

  it('duplicates an exact dateline fix locally instead of creating a world-spanning edge', () => {
    expect(splitTrackAtAntimeridian([
      point(0, 179, 10), point(1, 180, 11), point(2, -179, 12),
    ]).segments).toEqual([
      [[179, 10], [180, 11]],
      [[-180, 11], [-179, 12]],
    ]);
    expect(splitTrackAtAntimeridian([
      point(0, -179, 10), point(1, -180, 11), point(2, 179, 12),
    ]).segments).toEqual([
      [[-179, 10], [-180, 11]],
      [[180, 11], [179, 12]],
    ]);
  });

  it('preserves protected points that Douglas-Peucker would otherwise remove', () => {
    const coordinates = [[-105, 40], [-104.5, 40], [-104, 40]];
    expect(simplifyTrackSegment(coordinates, 1_000_000)).toEqual([coordinates[0], coordinates[2]]);
    expect(simplifyTrackSegment(coordinates, 1_000_000, new Set([1]))).toEqual(coordinates);
  });

  it('builds versioned rendering-only LODs while retaining the complete trajectory', () => {
    const points = [
      point(0, -105, 40), point(1, -104.75, 40), point(2, -104.5, 40),
      point(3, -104.25, 40), point(4, -104, 40),
    ];
    const projection = buildFlightMapProjection(points, new Set([2]));
    expect(projection.projectionVersion).toBe(FLIGHT_MAP_PROJECTION_VERSION);
    expect(projection.fullTrack.coordinates[0]).toHaveLength(points.length);
    expect(projection.sourcePointCount).toBe(points.length);
    expect(projection.lods).toHaveLength(FLIGHT_MAP_LOD_DEFINITIONS.length);
    for (const lod of projection.lods) expect(lod.geometry.coordinates[0]).toContainEqual([-104.5, 40]);
    expect(projection.landingLongitude).toBe(-104);
  });

  it('simplifies a long worst-case oscillating track without consuming the call stack', () => {
    const coordinates = Array.from({ length: 10_001 }, (_, index) => [
      -105 + index * 0.00001,
      40 + (index % 2 === 0 ? -0.001 : 0.001),
    ]);
    const simplified = simplifyTrackSegment(coordinates, 1);
    expect(simplified[0]).toEqual(coordinates[0]);
    expect(simplified.at(-1)).toEqual(coordinates.at(-1));
    expect(simplified.length).toBeGreaterThan(9_000);
  });

  it('builds exact bounds and a projection for more than 150k fixes without argument-stack overflow', () => {
    const points = Array.from({ length: 150_001 }, (_, sequenceNumber) => ({
      sequenceNumber,
      longitude: -105 + sequenceNumber / 10_000_000,
      latitude: 39 + sequenceNumber / 20_000_000,
    }));
    const projection = buildFlightMapProjection(points);
    expect(projection.sourcePointCount).toBe(points.length);
    expect(projection.bounds.west).toBeCloseTo(-105);
    expect(projection.bounds.south).toBeCloseTo(39);
    expect(projection.bounds.east).toBeCloseTo(-104.985);
    expect(projection.bounds.north).toBeCloseTo(39.0075);
    expect(projection.bounds.crossesAntimeridian).toBe(false);
    expect(projection.fullTrack.coordinates[0]).toHaveLength(points.length);
  });
});
