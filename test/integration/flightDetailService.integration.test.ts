import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  achievements,
  flightProgress,
  flightScores,
  flights,
  igcFiles,
  personalGridClaims,
  trackPoints,
} from '../../src/db/schema.js';
import { createAuthService } from '../../src/services/authService.js';
import { createFlightDetailService } from '../../src/services/flightDetailService.js';
import { resetAndMigrateTestDatabase } from './database.js';

type ProjectedCoordinate = readonly [x: number, y: number];

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users, arenas CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function toWgs84(coordinates: readonly ProjectedCoordinate[]) {
  const values = coordinates
    .map(([,], index) => `($${index * 2 + 1}::double precision, $${index * 2 + 2}::double precision)`)
    .join(', ');
  return (await database.pool.query<{ longitude: number; latitude: number }>(
    `SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS longitude,
            ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS latitude
     FROM (VALUES ${values}) AS input(x, y)`,
    coordinates.flat(),
  )).rows;
}

async function insertFlight(userId: string, processingStatus: 'processing' | 'completed') {
  const [igc] = await database.db.insert(igcFiles).values({
    userId,
    originalFilename: `${crypto.randomUUID()}.igc`,
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flight-detail/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!igc) throw new Error('IGC insert returned no row.');
  const startedAt = new Date('2026-07-20T18:00:00Z');
  const endedAt = new Date('2026-07-20T18:10:00Z');
  const [flight] = await database.db.insert(flights).values({
    userId,
    igcFileId: igc.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus,
    startedAt,
    endedAt,
    durationSeconds: 600,
    launchTimezone: 'America/Denver',
    launchLatitude: 0.0045,
    launchLongitude: 0.0052,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');
  return { id: flight.id, startedAt, endedAt };
}

describe('flightDetailService', () => {
  it('loads a completed flight summary with raw progress, scores, and shared accomplishments', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'flight-detail@example.com',
      password: 'correct horse battery staple',
      displayName: 'Detail Pilot',
    });
    const flight = await insertFlight(pilot.user.userId, 'completed');
    await database.pool.query(
      'UPDATE profiles SET territory_color = $1 WHERE user_id = $2',
      ['#123456', pilot.user.userId],
    );
    await database.db.insert(flightProgress).values({
      flightId: flight.id,
      userId: pilot.user.userId,
      directCellCount: 8,
      enclosedCellCount: 1,
      newPersonalCellCount: 7,
      personalCellTotalAfter: 42,
    });
    const pointMetadata = {
      points: [{
        sequenceNumber: 0,
        recordedAt: flight.startedAt.toISOString(),
        latitude: 0.0045,
        longitude: 0.0052,
        gpsAltitudeMeters: 1_000,
      }],
    };
    await database.db.insert(flightScores).values({
      flightId: flight.id,
      totalDistanceMeters: 12_345,
      totalDistanceCalcVersion: 2,
      totalDistanceMetadata: {},
      threePointDistanceMeters: 10_003,
      threePointDistanceCalcVersion: 3,
      threePointDistanceMetadata: pointMetadata,
      fourPointDistanceMeters: 10_004,
      fourPointDistanceCalcVersion: 4,
      fourPointDistanceMetadata: pointMetadata,
      fivePointDistanceMeters: 10_005,
      fivePointDistanceCalcVersion: 5,
      fivePointDistanceMetadata: pointMetadata,
      sixPointDistanceMeters: 10_006,
      sixPointDistanceCalcVersion: 6,
      sixPointDistanceMetadata: pointMetadata,
    });
    await database.db.insert(achievements).values({
      userId: pilot.user.userId,
      achievementType: 'unique_cells_milestone',
      achievementKey: `unique-cells:${flight.id}`,
      sourceFlightId: flight.id,
      earnedAt: flight.endedAt,
      details: { milestone: 10, newCells: 7, newTotal: 42 },
    });

    const summary = await createFlightDetailService(database.db, { cellSize: 1_000 }).getSummary(flight.id);

    expect(summary).toMatchObject({
      id: flight.id,
      ownerUserId: pilot.user.userId,
      ownerDisplayName: 'Detail Pilot',
      territoryColor: '#123456',
      startedAt: flight.startedAt,
      endedAt: flight.endedAt,
      launchTimezone: 'America/Denver',
      durationSeconds: 600,
      progress: {
        directCellCount: 8,
        enclosedCellCount: 1,
        newPersonalCellCount: 7,
        personalCellTotalAfter: 42,
      },
      scores: {
        track: { distanceMeters: 12_345, calcVersion: 2, metadata: {} },
        threePoint: { distanceMeters: 10_003, calcVersion: 3, metadata: pointMetadata },
        fourPoint: { distanceMeters: 10_004, calcVersion: 4, metadata: pointMetadata },
        fivePoint: { distanceMeters: 10_005, calcVersion: 5, metadata: pointMetadata },
        sixPoint: { distanceMeters: 10_006, calcVersion: 6, metadata: pointMetadata },
      },
    });
    expect(summary?.accomplishments).toEqual([
      expect.objectContaining({ achievementKey: 'unique_cells_milestone', title: '10 Unique Cells' }),
    ]);
  });

  it('returns the ordered full track and flight-only direct/enclosed WGS84 cells', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'flight-map@example.com',
      password: 'correct horse battery staple',
      displayName: 'Map Pilot',
    });
    const otherPilot = await auth.signup({
      email: 'other-flight-map@example.com',
      password: 'correct horse battery staple',
      displayName: 'Other Map Pilot',
    });
    const flight = await insertFlight(pilot.user.userId, 'completed');
    const projected = [
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500],
    ] as const;
    const wgs84 = await toWgs84(projected);
    await database.db.insert(trackPoints).values(wgs84.map((point, index) => ({
      flightId: flight.id,
      sequenceNumber: projected.length - index,
      recordedAt: new Date(flight.startedAt.getTime() + index * 1_000),
      latitude: point.latitude,
      longitude: point.longitude,
      gpsAltitudeMeters: 1_000 + index,
      pressureAltitudeMeters: 900 + index,
    })));
    await database.db.insert(personalGridClaims).values([
      { x: 0, y: 0, claimFlight: flight.id, claimUser: pilot.user.userId, claimTimestamp: flight.startedAt },
      { x: 2, y: 1, claimFlight: flight.id, claimUser: pilot.user.userId, claimTimestamp: flight.startedAt },
      { x: 1, y: 1, claimFlight: flight.id, claimUser: pilot.user.userId, claimTimestamp: flight.startedAt },
      // A persisted non-candidate cell must not leak into the map payload.
      { x: 99, y: 99, claimFlight: flight.id, claimUser: pilot.user.userId, claimTimestamp: flight.startedAt },
      // A corrupt cross-owner claim associated with this flight must not be exposed.
      { x: 0, y: 0, claimFlight: flight.id, claimUser: otherPilot.user.userId, claimTimestamp: flight.startedAt },
    ]);

    const map = await createFlightDetailService(database.db, { cellSize: 1_000 }).getMapData(flight.id);

    expect(map?.track.map((point) => point.sequenceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(map?.launch).toEqual({
      latitude: wgs84[8]?.latitude,
      longitude: wgs84[8]?.longitude,
    });
    expect(map?.landing).toEqual({
      latitude: wgs84[0]?.latitude,
      longitude: wgs84[0]?.longitude,
    });
    expect(map?.directCells.features).toHaveLength(2);
    expect(map?.enclosedCells.features).toHaveLength(1);
    expect(map?.directCells.features.map((feature) => feature.properties)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 1 },
    ]);
    expect(map?.directCells.features[0]).toMatchObject({
      type: 'Feature',
      geometry: { type: 'Polygon' },
      properties: { x: expect.any(Number), y: expect.any(Number) },
    });
    const coordinate = map?.directCells.features[0]?.geometry.coordinates[0]?.[0];
    expect(coordinate?.[0]).toBeGreaterThanOrEqual(-180);
    expect(coordinate?.[0]).toBeLessThanOrEqual(180);
    expect(coordinate?.[1]).toBeGreaterThanOrEqual(-90);
    expect(coordinate?.[1]).toBeLessThanOrEqual(90);
  });

  it('does not expose processing flights through either read', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'flight-processing@example.com',
      password: 'correct horse battery staple',
      displayName: 'Processing Pilot',
    });
    const flight = await insertFlight(pilot.user.userId, 'processing');
    const service = createFlightDetailService(database.db, { cellSize: 1_000 });

    await expect(service.getSummary(flight.id)).resolves.toBeNull();
    await expect(service.getMapData(flight.id)).resolves.toBeNull();
  });
});
