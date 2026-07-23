import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { flightScores, flights, igcFiles, trackPoints, users } from '../../src/db/schema.js';
import type { PointDistanceMetadata } from '../../src/domain/igc/distance.js';
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
      threePointDistanceCalcVersion: 1,
      fourPointDistanceCalcVersion: 1,
      fivePointDistanceCalcVersion: 1,
      sixPointDistanceCalcVersion: 1,
    });
    expect(stored?.totalDistanceMeters).toBeGreaterThan(0);
    expect(stored?.threePointDistanceMeters).toBeGreaterThan(0);
    expect(stored?.fourPointDistanceMeters).toBeGreaterThan(0);
    expect(stored?.fivePointDistanceMeters).toBeGreaterThan(0);
    expect(stored?.sixPointDistanceMeters).toBeGreaterThan(0);
    expect(stored?.threePointDistanceMetadata).toMatchObject({
      calculationVersion: 1,
      points: expect.any(Array),
    });
    expect(stored?.fourPointDistanceMetadata).toMatchObject({
      calculationVersion: 1,
      points: expect.any(Array),
    });
    expect(stored?.fivePointDistanceMetadata).toMatchObject({
      calculationVersion: 1,
      points: expect.any(Array),
    });
    expect(stored?.threePointDistanceMetadata?.points).toHaveLength(3);
    expect(stored?.fourPointDistanceMetadata?.points).toHaveLength(4);
    expect(stored?.fivePointDistanceMetadata?.points).toHaveLength(5);
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
    })) as unknown as PointDistanceMetadata<6>['points'];
    const newerThreePointMetadata = {
      calculationVersion: 2 as const,
      distanceMeters: 2_003,
      pointIndices: [0, 1, 2] as const,
      points: scorePoints.slice(0, 3),
    };
    const newerFourPointMetadata = {
      calculationVersion: 2 as const,
      distanceMeters: 2_004,
      pointIndices: [0, 1, 2, 3] as const,
      points: scorePoints.slice(0, 4),
    };
    const newerFivePointMetadata = {
      calculationVersion: 2 as const,
      distanceMeters: 2_005,
      pointIndices: [0, 1, 2, 3, 4] as const,
      points: scorePoints.slice(0, 5),
    };
    const newerSixPointMetadata = {
      calculationVersion: 2 as const,
      distanceMeters: 2_006,
      pointIndices: [0, 1, 2, 3, 4, 5] as const,
      points: [...scorePoints],
    };
    await database.db.insert(flightScores).values({
      flightId,
      totalDistanceMeters: 1_001,
      totalDistanceCalcVersion: 2,
      totalDistanceMetadata: {},
      threePointDistanceMeters: 2_003,
      threePointDistanceCalcVersion: 2,
      threePointDistanceMetadata: newerThreePointMetadata,
      fourPointDistanceMeters: 2_004,
      fourPointDistanceCalcVersion: 2,
      fourPointDistanceMetadata: newerFourPointMetadata,
      fivePointDistanceMeters: 2_005,
      fivePointDistanceCalcVersion: 2,
      fivePointDistanceMetadata: newerFivePointMetadata,
      sixPointDistanceMeters: 2_006,
      sixPointDistanceCalcVersion: 2,
      sixPointDistanceMetadata: newerSixPointMetadata,
    });

    await expect(upsertFlightScores(database.db, flightId, {
      totalDistanceMeters: 101,
      totalDistanceCalcVersion: 1,
      totalDistanceMetadata: {},
      threePointDistanceMeters: 203,
      threePointDistanceCalcVersion: 1,
      threePointDistanceMetadata: {
        calculationVersion: 1,
        distanceMeters: 203,
        pointIndices: [0, 1, 2],
        points: scorePoints.slice(0, 3),
      } as unknown as PointDistanceMetadata<3>,
      fourPointDistanceMeters: 204,
      fourPointDistanceCalcVersion: 1,
      fourPointDistanceMetadata: {
        calculationVersion: 1,
        distanceMeters: 204,
        pointIndices: [0, 1, 2, 3],
        points: scorePoints.slice(0, 4),
      } as unknown as PointDistanceMetadata<4>,
      fivePointDistanceMeters: 205,
      fivePointDistanceCalcVersion: 1,
      fivePointDistanceMetadata: {
        calculationVersion: 1,
        distanceMeters: 205,
        pointIndices: [0, 1, 2, 3, 4],
        points: scorePoints.slice(0, 5),
      } as unknown as PointDistanceMetadata<5>,
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
        threePointDistanceMeters: 2_003,
        threePointDistanceCalcVersion: 2,
        fourPointDistanceMeters: 2_004,
        fourPointDistanceCalcVersion: 2,
        fivePointDistanceMeters: 2_005,
        fivePointDistanceCalcVersion: 2,
        sixPointDistanceMeters: 2_006,
        sixPointDistanceCalcVersion: 2,
        sixPointDistanceMetadata: newerSixPointMetadata,
      }),
    ]);
  });
});
