import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  competitionGridClaims,
  flights,
  igcFiles,
  personalGridClaims,
  pilotFollows,
  profiles,
  trackPoints,
  users,
} from '../../src/db/schema.js';
import { createCellFlightTrackService } from '../../src/services/cellFlightTrackService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createPilot(displayName = 'Pilot') {
  const [pilot] = await database.db.insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
  }).returning({ userId: users.id });
  if (!pilot) throw new Error('Expected a pilot.');
  await database.db.insert(profiles).values({ userId: pilot.userId, displayName });
  return pilot.userId;
}

async function createFlight(
  userId: string,
  input: {
    launchTimezone?: string;
    points?: Array<[longitude: number, latitude: number]>;
    status?: 'processing' | 'completed' | 'failed';
    startedAt?: Date;
    distanceMeters?: number;
  } = {},
) {
  const [file] = await database.db.insert(igcFiles).values({
    userId,
    originalFilename: 'track.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flights/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!file) throw new Error('Expected an IGC file.');
  const [flight] = await database.db.insert(flights).values({
    userId,
    igcFileId: file.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: input.status ?? 'completed',
    launchTimezone: input.launchTimezone ?? 'UTC',
    startedAt: input.startedAt,
    distanceMeters: input.distanceMeters,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Expected a flight.');
  const points = input.points ?? [[-105, 40], [-104.9, 40.1]];
  if (points.length) {
    await database.db.insert(trackPoints).values(points.map(([longitude, latitude], sequenceNumber) => ({
      flightId: flight.id,
      sequenceNumber,
      recordedAt: new Date(Date.UTC(2026, 6, 1, 0, sequenceNumber)),
      latitude,
      longitude,
      gpsAltitudeMeters: 1_000,
      pressureAltitudeMeters: 1_000,
    })));
  }
  return flight.id;
}

describe('CellFlightTrackService', () => {
  it('returns the selected cell and separate ordered completed Personal flight tracks in scope', async () => {
    const pilot = await createPilot();
    const juneFlight = await createFlight(pilot, {
      launchTimezone: 'America/Denver',
      points: [[-105, 40], [-104.9, 40.1], [-104.8, 40.2]],
    });
    const shortFlight = await createFlight(pilot, { points: [[-103, 39]] });
    const failedFlight = await createFlight(pilot, { status: 'failed' });
    await database.db.insert(personalGridClaims).values([
      {
        x: 0, y: 0, claimFlight: juneFlight, claimUser: pilot,
        claimTimestamp: new Date('2026-07-01T05:30:00Z'),
      },
      {
        x: 0, y: 0, claimFlight: shortFlight, claimUser: pilot,
        claimTimestamp: new Date('2026-06-15T00:00:00Z'),
      },
      {
        x: 0, y: 0, claimFlight: failedFlight, claimUser: pilot,
        claimTimestamp: new Date('2026-06-16T00:00:00Z'),
      },
    ]);

    const result = await createCellFlightTrackService(database.db, { cellSize: 1_000 }).getPersonal({
      x: 0,
      y: 0,
      userId: pilot,
      period: { competitionMonth: '2026-06' },
    });

    expect(result.cell).toMatchObject({
      type: 'Feature',
      properties: { cellId: '1000:0:0', x: 0, y: 0 },
      geometry: { type: 'Polygon' },
    });
    expect(result.tracks.features).toEqual([{
      type: 'Feature',
      properties: { flightId: juneFlight, pilotUserId: pilot },
      geometry: {
        type: 'LineString',
        coordinates: [[-105, 40], [-104.9, 40.1], [-104.8, 40.2]],
      },
    }]);
  });

  it('returns every Competition claiming flight and a deduplicated pilot list in scope', async () => {
    const alpha = await createPilot('Alpha Pilot');
    const bravo = await createPilot('Bravo Pilot');
    const alphaOlder = await createFlight(alpha, {
      points: [[-105, 40], [-104.9, 40.1]],
      startedAt: new Date('2026-07-01T15:00:00Z'),
      distanceMeters: 10_500,
    });
    const alphaLatest = await createFlight(alpha, {
      points: [[-104, 39], [-103.9, 39.1]],
      startedAt: new Date('2026-07-02T16:00:00Z'),
      distanceMeters: 20_250,
    });
    const bravoFlight = await createFlight(bravo, {
      points: [[-103, 38], [-102.9, 38.1]],
      startedAt: new Date('2026-07-03T17:00:00Z'),
      distanceMeters: 30_750,
    });
    const shortFlight = await createFlight(bravo, {
      points: [[-102, 37]],
      startedAt: new Date('2026-07-04T18:00:00Z'),
      distanceMeters: 1_250,
    });
    await database.db.insert(competitionGridClaims).values([
      {
        competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: alphaOlder, claimUser: alpha,
        claimTimestamp: new Date('2026-07-01T00:00:00Z'),
      },
      {
        competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: alphaLatest, claimUser: alpha,
        claimTimestamp: new Date('2026-07-02T00:00:00Z'),
      },
      {
        competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: bravoFlight, claimUser: bravo,
        claimTimestamp: new Date('2026-07-03T00:00:00Z'),
      },
      {
        competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: shortFlight, claimUser: bravo,
        claimTimestamp: new Date('2026-07-04T00:00:00Z'),
      },
    ]);
    let executionCount = 0;
    const originalExecute = database.db.execute.bind(database.db);
    const trackedDatabase = {
      execute: ((query: Parameters<typeof originalExecute>[0]) => {
        executionCount += 1;
        return originalExecute(query);
      }) as typeof database.db.execute,
    };
    const service = createCellFlightTrackService(trackedDatabase, { cellSize: 1_000 });

    const result = await service.getCompetition({
      x: -1,
      y: 2,
      period: { competitionMonth: '2026-07' },
    });
    expect(result.tracks.features.map((feature) => feature.properties)).toEqual([
      { flightId: bravoFlight, pilotUserId: bravo },
      { flightId: alphaLatest, pilotUserId: alpha },
      { flightId: alphaOlder, pilotUserId: alpha },
    ]);
    expect(result.tracks.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [[-103, 38], [-102.9, 38.1]],
      [[-104, 39], [-103.9, 39.1]],
      [[-105, 40], [-104.9, 40.1]],
    ]);
    expect(result.flights).toEqual([
      {
        flightId: shortFlight, userId: bravo, displayName: 'Bravo Pilot',
        startedAt: '2026-07-04T18:00:00.000Z', launchTimezone: 'UTC', distanceMeters: 1_250,
      },
      {
        flightId: bravoFlight, userId: bravo, displayName: 'Bravo Pilot',
        startedAt: '2026-07-03T17:00:00.000Z', launchTimezone: 'UTC', distanceMeters: 30_750,
      },
      {
        flightId: alphaLatest, userId: alpha, displayName: 'Alpha Pilot',
        startedAt: '2026-07-02T16:00:00.000Z', launchTimezone: 'UTC', distanceMeters: 20_250,
      },
      {
        flightId: alphaOlder, userId: alpha, displayName: 'Alpha Pilot',
        startedAt: '2026-07-01T15:00:00.000Z', launchTimezone: 'UTC', distanceMeters: 10_500,
      },
    ]);
    expect(executionCount).toBe(2);

    const selected = await service.getCompetition({
      x: -1,
      y: 2,
      period: { period: 'all-time' },
      pilotUserId: alpha,
    });
    expect(selected.tracks.features.map((feature) => feature.properties.flightId)).toEqual([
      alphaLatest,
      alphaOlder,
    ]);
    expect(selected.flights?.map((flight) => flight.flightId)).toEqual([alphaLatest, alphaOlder]);
  });

  it('filters Following competition tracks to viewer and followed pilots', async () => {
    const viewer = await createPilot('Viewer Pilot');
    const followed = await createPilot('Followed Pilot');
    const outsider = await createPilot('Outsider Pilot');
    await database.db.insert(pilotFollows).values({ followerUserId: viewer, followedUserId: followed });
    const viewerFlight = await createFlight(viewer);
    const followedFlight = await createFlight(followed);
    const outsiderFlight = await createFlight(outsider);
    await database.db.insert(competitionGridClaims).values([
      { competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: viewerFlight, claimUser: viewer, claimTimestamp: new Date('2026-07-01T00:00:00Z') },
      { competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: followedFlight, claimUser: followed, claimTimestamp: new Date('2026-07-02T00:00:00Z') },
      { competitionMonth: '2026-07-01', x: -1, y: 2, claimFlight: outsiderFlight, claimUser: outsider, claimTimestamp: new Date('2026-07-03T00:00:00Z') },
    ]);
    const result = await createCellFlightTrackService(database.db, { cellSize: 1_000 }).getCompetition({
      x: -1, y: 2, period: { competitionMonth: '2026-07' }, currentUserId: viewer, scope: 'following',
    });
    expect(result.tracks.features.map((feature) => feature.properties.pilotUserId)).toEqual([followed, viewer]);
    expect(result.tracks.features.some((feature) => feature.properties.pilotUserId === outsider)).toBe(false);
  });
});
