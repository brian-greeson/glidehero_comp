import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  competitionGridClaims,
  flights,
  igcFiles,
  personalGridClaims,
  pilotFollows,
  trackPoints,
  users,
} from '../../src/db/schema.js';
import { createCellFlightTrackService } from '../../src/services/cellFlightTrackService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createPilot() {
  const [pilot] = await database.db.insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
  }).returning({ userId: users.id });
  if (!pilot) throw new Error('Expected a pilot.');
  return pilot.userId;
}

async function createFlight(
  userId: string,
  input: {
    launchTimezone?: string;
    points?: Array<[longitude: number, latitude: number]>;
    status?: 'processing' | 'completed' | 'failed';
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

  it('returns each pilot latest Competition claim in scope and supports a selected pilot', async () => {
    const alpha = await createPilot();
    const bravo = await createPilot();
    const alphaOlder = await createFlight(alpha, { points: [[-105, 40], [-104.9, 40.1]] });
    const alphaLatest = await createFlight(alpha, { points: [[-104, 39], [-103.9, 39.1]] });
    const bravoFlight = await createFlight(bravo, { points: [[-103, 38], [-102.9, 38.1]] });
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
    ]);
    const service = createCellFlightTrackService(database.db, { cellSize: 1_000 });

    const result = await service.getCompetition({
      x: -1,
      y: 2,
      period: { competitionMonth: '2026-07' },
    });
    expect(result.tracks.features.map((feature) => feature.properties)).toEqual([
      { flightId: bravoFlight, pilotUserId: bravo },
      { flightId: alphaLatest, pilotUserId: alpha },
    ]);
    expect(result.tracks.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [[-103, 38], [-102.9, 38.1]],
      [[-104, 39], [-103.9, 39.1]],
    ]);

    const selected = await service.getCompetition({
      x: -1,
      y: 2,
      period: { period: 'all-time' },
      pilotUserId: alpha,
    });
    expect(selected.tracks.features.map((feature) => feature.properties.flightId)).toEqual([alphaLatest]);
  });

  it('filters Following competition tracks to viewer and followed pilots', async () => {
    const viewer = await createPilot();
    const followed = await createPilot();
    const outsider = await createPilot();
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
