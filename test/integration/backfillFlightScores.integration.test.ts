import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { flightScores, flights, igcFiles, trackPoints, users } from '../../src/db/schema.js';
import type { SixPointDistanceMetadata } from '../../src/domain/igc/distance.js';
import {
  runFlightScoreBackfill,
  upsertFlightScores,
} from '../../src/scripts/backfillFlightScores.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  if (database) await database.pool.end();
});

async function createFlight(status: 'processing' | 'completed') {
  const [user] = await database.db.insert(users).values({
    email: `flight-score-${crypto.randomUUID()}@example.com`,
  }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');
  const [igcFile] = await database.db.insert(igcFiles).values({
    userId: user.id,
    originalFilename: 'score.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `score/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');
  const [flight] = await database.db.insert(flights).values({
    userId: user.id,
    igcFileId: igcFile.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: status,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  const recordedAt = new Date('2026-07-23T12:00:00.000Z');
  await database.db.insert(trackPoints).values(
    [0, 8, 1, 9, 2, 10, 3].map((longitude, sequenceNumber) => ({
      flightId: flight.id,
      sequenceNumber,
      recordedAt: new Date(recordedAt.getTime() + sequenceNumber * 1_000),
      latitude: 40,
      longitude,
      gpsAltitudeMeters: 1_000 + sequenceNumber,
      pressureAltitudeMeters: 900 + sequenceNumber,
    })),
  );
  return flight.id;
}

describe('flight-score backfill with PostgreSQL', () => {
  it('dry-runs without writes, applies completed flights, and reruns without recalculation', async () => {
    const completedFlightId = await createFlight('completed');
    await createFlight('processing');

    const dryRun = await runFlightScoreBackfill(database.db, { apply: false, batchSize: 1 });
    expect(dryRun).toMatchObject({
      inspected: 1,
      calculated: 1,
      skipped: 0,
      written: 0,
      failed: 0,
    });
    expect(await database.db.select().from(flightScores)).toEqual([]);

    const applied = await runFlightScoreBackfill(database.db, { apply: true, batchSize: 1 });
    expect(applied).toMatchObject({
      inspected: 1,
      calculated: 1,
      skipped: 0,
      written: 1,
      failed: 0,
    });
    const [stored] = await database.db.select().from(flightScores)
      .where(eq(flightScores.flightId, completedFlightId));
    expect(stored).toMatchObject({
      flightId: completedFlightId,
      totalDistanceCalcVersion: 1,
      totalDistanceMetadata: {},
      sixPointDistanceCalcVersion: 1,
    });
    expect(stored?.totalDistanceMeters).toBeGreaterThan(0);
    expect(stored?.sixPointDistanceMeters).toBeGreaterThan(0);
    expect(stored?.sixPointDistanceMetadata).toMatchObject({
      calculationVersion: 1,
      pointIndices: [0, 1, 2, 3, 4, 5],
      points: [
        { sequenceNumber: 0, recordedAt: '2026-07-23T12:00:00.000Z' },
        { sequenceNumber: 1, recordedAt: '2026-07-23T12:00:01.000Z' },
        { sequenceNumber: 2, recordedAt: '2026-07-23T12:00:02.000Z' },
        { sequenceNumber: 3, recordedAt: '2026-07-23T12:00:03.000Z' },
        { sequenceNumber: 4, recordedAt: '2026-07-23T12:00:04.000Z' },
        { sequenceNumber: 5, recordedAt: '2026-07-23T12:00:05.000Z' },
      ],
    });

    const rerun = await runFlightScoreBackfill(database.db, { apply: true, batchSize: 1 });
    expect(rerun).toMatchObject({
      inspected: 1,
      calculated: 0,
      skipped: 1,
      written: 0,
      failed: 0,
    });
  }, 30_000);

  it('does not overwrite score values written by a newer calculation version', async () => {
    const flightId = await createFlight('completed');
    const scorePoints = [0, 1, 2, 3, 4, 5].map((sequenceNumber) => ({
      sequenceNumber,
      recordedAt: new Date(Date.UTC(2026, 6, 23, 12, 0, sequenceNumber)).toISOString(),
      latitude: 40,
      longitude: sequenceNumber,
      gpsAltitudeMeters: 1_000 + sequenceNumber,
    })) as unknown as SixPointDistanceMetadata['points'];
    const newerMetadata = {
      calculationVersion: 2 as const,
      distanceMeters: 2_002,
      pointIndices: [0, 1, 2, 3, 4, 5] as const,
      points: [...scorePoints],
    };
    await database.db.insert(flightScores).values({
      flightId,
      totalDistanceMeters: 1_001,
      totalDistanceCalcVersion: 2,
      totalDistanceMetadata: {},
      sixPointDistanceMeters: 2_002,
      sixPointDistanceCalcVersion: 2,
      sixPointDistanceMetadata: newerMetadata,
    });

    await expect(upsertFlightScores(database.db, flightId, {
      totalDistanceMeters: 101,
      totalDistanceCalcVersion: 1,
      totalDistanceMetadata: {},
      sixPointDistanceMeters: 202,
      sixPointDistanceCalcVersion: 1,
      sixPointDistanceMetadata: {
        calculationVersion: 1,
        distanceMeters: 202,
        pointIndices: [0, 1, 2, 3, 4, 5],
        points: scorePoints,
      },
    })).resolves.toBe(false);

    await expect(database.db.select().from(flightScores)
      .where(eq(flightScores.flightId, flightId))).resolves.toEqual([
      expect.objectContaining({
        totalDistanceMeters: 1_001,
        totalDistanceCalcVersion: 2,
        sixPointDistanceMeters: 2_002,
        sixPointDistanceCalcVersion: 2,
        sixPointDistanceMetadata: newerMetadata,
      }),
    ]);
  });
});
