import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { achievements, flights, flightProgress, igcFiles, trackPoints, users } from '../../src/db/schema.js';
import { printSummary, runBackfill } from '../../src/scripts/backfillFlightProgress.js';
import { resetAndPushTestDatabase } from './database.js';

type ProjectedCoordinate = readonly [x: number, y: number];

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  if (database) await database.pool.end();
});

async function toWgs84(coordinates: readonly ProjectedCoordinate[]) {
  const values = coordinates.map(([,], index) => (
    '($' + (index * 2 + 1) + '::double precision, $' + (index * 2 + 2) + '::double precision)'
  )).join(', ');
  const projected = await database.pool.query<{ longitude: number; latitude: number }>(
    [
      'SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS longitude,',
      '       ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS latitude',
      'FROM (VALUES ' + values + ') AS input(x, y)',
    ].join('\n'),
    coordinates.flat(),
  );
  return projected.rows;
}

async function createUser(label: string) {
  const [user] = await database.db.insert(users).values({
    email: `backfill-${label}-${crypto.randomUUID()}@example.com`,
  }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');
  return user;
}

async function createLineFlight(
  userId: string,
  startX: number,
  endX: number,
  createdAt: Date,
  processedAt: Date | null = null,
) {
  const [igcFile] = await database.db.insert(igcFiles).values({
    userId,
    originalFilename: 'backfill.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: 'backfill/' + crypto.randomUUID() + '.igc',
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db.insert(flights).values({
    userId,
    igcFileId: igcFile.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone: 'UTC',
    startedAt: createdAt,
    endedAt: new Date(createdAt.getTime() + 1_000),
    processedAt,
    createdAt,
    updatedAt: createdAt,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  const points = await toWgs84([[startX, 100], [endX, 100]]);
  await database.db.insert(trackPoints).values(points.map((point, sequenceNumber) => ({
    flightId: flight.id,
    sequenceNumber,
    recordedAt: new Date(createdAt.getTime() + sequenceNumber * 1_000),
    latitude: point.latitude,
    longitude: point.longitude,
    gpsAltitudeMeters: 1_000,
    pressureAltitudeMeters: 1_000,
  })));
  return flight.id;
}

async function storedProgress(userId: string) {
  return database.db.select({
    flightId: flightProgress.flightId,
    newPersonalCellCount: flightProgress.newPersonalCellCount,
    personalCellTotalAfter: flightProgress.personalCellTotalAfter,
  }).from(flightProgress)
    .innerJoin(flights, eq(flights.id, flightProgress.flightId))
    .where(eq(flightProgress.userId, userId))
    .orderBy(
      sql`CASE WHEN ${flights.processedAt} IS NULL THEN 0 ELSE 1 END`,
      sql`COALESCE(${flights.processedAt}, ${flights.createdAt})`,
      asc(flights.id),
    );
}

async function storedAchievements(userId: string) {
  return database.db.select().from(achievements)
    .where(eq(achievements.userId, userId))
    .orderBy(achievements.earnedAt, achievements.sourceFlightId, achievements.achievementKey);
}

describe('flight-progress backfill with PostgreSQL', () => {
  it('dry-runs without writes and applies overlapping flights in deterministic order for multiple users', async () => {
    const alpha = await createUser('alpha');
    const beta = await createUser('beta');
    const base = new Date('2026-01-01T00:00:00Z');
    const alphaFirst = await createLineFlight(alpha.id, 100, 8_100, new Date(base.getTime() + 1_000));
    const alphaSecond = await createLineFlight(alpha.id, 9_100, 29_100, new Date(base.getTime() + 2_000));
    await createLineFlight(beta.id, 100, 10_100, new Date(base.getTime() + 1_000));

    const dryRun = await runBackfill(database.db, { apply: false, cellSize: 1_000 });
    expect(dryRun).toMatchObject({
      usersInspected: 2,
      flightsNeedingBackfill: 3,
      flightsReplayedWithProcessedAtOrder: 0,
      legacyFlightsReplayedApproximate: 3,
      usersAffectedByApproximateOrdering: 2,
      progressRowsCreated: 3,
      milestoneAchievementsCreated: 3,
      totalCellPersonalBestAchievementsCreated: 3,
      enclosedCellPersonalBestAchievementsCreated: 0,
      usersFailed: 0,
    });
    expect(await database.db.select().from(flightProgress)).toEqual([]);
    expect(await database.db.select().from(achievements)).toEqual([]);

    const applied = await runBackfill(database.db, { apply: true, cellSize: 1_000 });
    expect(applied).toMatchObject({
      usersInspected: 2,
      flightsNeedingBackfill: 3,
      flightsReplayedWithProcessedAtOrder: 0,
      legacyFlightsReplayedApproximate: 3,
      usersAffectedByApproximateOrdering: 2,
      progressRowsCreated: 3,
      milestoneAchievementsCreated: 3,
      totalCellPersonalBestAchievementsCreated: 3,
      enclosedCellPersonalBestAchievementsCreated: 0,
      usersFailed: 0,
    });
    const dryRunOutput: string[] = [];
    printSummary(dryRun, false, {
      log: (message: string) => dryRunOutput.push(message),
      error: () => undefined,
    });
    expect(dryRunOutput).toContain(
      'WARNING: Legacy flights have no processedAt timestamp; their createdAt order is approximate and cannot reconstruct exact concurrent processing order.',
    );

    const alphaProgress = await storedProgress(alpha.id);
    expect(alphaProgress).toHaveLength(2);
    expect(alphaProgress.map((row) => ({
      flightId: row.flightId,
      newCells: row.newPersonalCellCount,
      totalAfter: row.personalCellTotalAfter,
    }))).toEqual([
      { flightId: alphaFirst, newCells: 9, totalAfter: 9 },
      { flightId: alphaSecond, newCells: 21, totalAfter: 30 },
    ]);
    expect((await storedAchievements(alpha.id)).map((row) => row.achievementKey)).toEqual([
      'personal-best-total-cells:' + alphaFirst,
      'personal-best-total-cells:' + alphaSecond,
      'unique-cells:10',
      'unique-cells:25',
    ]);

    const rerun = await runBackfill(database.db, { apply: true, cellSize: 1_000 });
    expect(rerun).toMatchObject({
      usersInspected: 0,
      flightsNeedingBackfill: 0,
      progressRowsCreated: 0,
      milestoneAchievementsCreated: 0,
      totalCellPersonalBestAchievementsCreated: 0,
      enclosedCellPersonalBestAchievementsCreated: 0,
      usersFailed: 0,
    });
  });

  it('rolls back one failed user while committing another user', async () => {
    const failingUser = await createUser('failing');
    const successfulUser = await createUser('successful');
    const base = new Date('2026-02-01T00:00:00Z');
    await createLineFlight(failingUser.id, 100, 10_100, base);
    const successfulFlight = await createLineFlight(successfulUser.id, 100, 10_100, base);

    await database.pool.query(`
      CREATE OR REPLACE FUNCTION backfill_test_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW.user_id = '${failingUser.id}'::uuid THEN
          RAISE EXCEPTION 'intentional backfill failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await database.pool.query(`
      CREATE TRIGGER backfill_test_failure_trigger
      BEFORE INSERT ON flight_progress
      FOR EACH ROW EXECUTE FUNCTION backfill_test_failure();
    `);

    try {
      const result = await runBackfill(database.db, { apply: true, cellSize: 1_000 });
      expect(result).toMatchObject({
        usersInspected: 2,
        flightsReplayedWithProcessedAtOrder: 0,
        legacyFlightsReplayedApproximate: 2,
        usersAffectedByApproximateOrdering: 2,
        progressRowsCreated: 1,
        usersFailed: 1,
      });
      expect(await storedProgress(failingUser.id)).toEqual([]);
      expect(await storedAchievements(failingUser.id)).toEqual([]);
      expect(await storedProgress(successfulUser.id)).toHaveLength(1);
      expect((await storedProgress(successfulUser.id))[0]?.flightId).toBe(successfulFlight);
    } finally {
      await database.pool.query('DROP TRIGGER backfill_test_failure_trigger ON flight_progress');
      await database.pool.query('DROP FUNCTION backfill_test_failure()');
    }
  });

  it('replays timestamped flights in processed order for progression totals and milestones', async () => {
    const user = await createUser('processed-order');
    const base = new Date('2026-03-01T00:00:00Z');
    const processedLater = await createLineFlight(
      user.id,
      100,
      29_100,
      new Date(base.getTime() + 1_000),
      new Date(base.getTime() + 2_000),
    );
    const processedEarlier = await createLineFlight(
      user.id,
      100,
      8_100,
      new Date(base.getTime() + 2_000),
      new Date(base.getTime() + 1_000),
    );

    const result = await runBackfill(database.db, { apply: true, cellSize: 1_000 });
    expect(result).toMatchObject({
      flightsNeedingBackfill: 2,
      flightsReplayedWithProcessedAtOrder: 2,
      legacyFlightsReplayedApproximate: 0,
      usersAffectedByApproximateOrdering: 0,
      progressRowsCreated: 2,
      milestoneAchievementsCreated: 2,
      totalCellPersonalBestAchievementsCreated: 2,
      usersFailed: 0,
    });
    expect(await storedProgress(user.id)).toEqual([
      { flightId: processedEarlier, newPersonalCellCount: 9, personalCellTotalAfter: 9 },
      { flightId: processedLater, newPersonalCellCount: 21, personalCellTotalAfter: 30 },
    ]);

    const userAchievements = await storedAchievements(user.id);
    expect(userAchievements.map((row) => row.achievementKey)).toEqual([
      'personal-best-total-cells:' + processedEarlier,
      'personal-best-total-cells:' + processedLater,
      'unique-cells:10',
      'unique-cells:25',
    ]);
    expect(userAchievements.filter((row) => row.achievementType === 'unique_cells_milestone').map((row) => row.sourceFlightId))
      .toEqual([processedLater, processedLater]);
  });

  it('orders legacy flights before timestamped flights deterministically', async () => {
    const user = await createUser('mixed-order');
    const base = new Date('2026-04-01T00:00:00Z');
    const legacySmall = await createLineFlight(
      user.id,
      100,
      8_100,
      new Date(base.getTime() + 1_000),
    );
    const legacyLarge = await createLineFlight(
      user.id,
      100,
      29_100,
      new Date(base.getTime() + 1_000),
    );
    const timestamped = await createLineFlight(
      user.id,
      100,
      39_100,
      new Date(base.getTime() + 3_000),
      new Date(base.getTime() - 1_000),
    );

    const result = await runBackfill(database.db, { apply: true, cellSize: 1_000 });
    expect(result).toMatchObject({
      flightsNeedingBackfill: 3,
      flightsReplayedWithProcessedAtOrder: 1,
      legacyFlightsReplayedApproximate: 2,
      usersAffectedByApproximateOrdering: 1,
      progressRowsCreated: 3,
      usersFailed: 0,
    });
    const legacyRows = legacySmall < legacyLarge
      ? [
        { flightId: legacySmall, newPersonalCellCount: 9, personalCellTotalAfter: 9 },
        { flightId: legacyLarge, newPersonalCellCount: 21, personalCellTotalAfter: 30 },
      ]
      : [
        { flightId: legacyLarge, newPersonalCellCount: 30, personalCellTotalAfter: 30 },
        { flightId: legacySmall, newPersonalCellCount: 0, personalCellTotalAfter: 30 },
      ];
    expect(await storedProgress(user.id)).toEqual([
      ...legacyRows,
      { flightId: timestamped, newPersonalCellCount: 10, personalCellTotalAfter: 40 },
    ]);
  });

  it('counts all completed flights replayed for a user with missing progress', async () => {
    const user = await createUser('replay-inventory');
    const base = new Date('2026-05-01T00:00:00Z');
    const existingProgressFlight = await createLineFlight(
      user.id,
      100,
      8_100,
      base,
    );
    await createLineFlight(
      user.id,
      100,
      29_100,
      new Date(base.getTime() + 1_000),
    );
    await database.db.insert(flightProgress).values({
      flightId: existingProgressFlight,
      userId: user.id,
      directCellCount: 9,
      enclosedCellCount: 0,
      newPersonalCellCount: 9,
      personalCellTotalAfter: 9,
    });

    const dryRun = await runBackfill(database.db, { apply: false, cellSize: 1_000 });
    const applied = await runBackfill(database.db, { apply: true, cellSize: 1_000 });
    expect(dryRun).toMatchObject({
      flightsNeedingBackfill: 1,
      flightsReplayedWithProcessedAtOrder: 0,
      legacyFlightsReplayedApproximate: 2,
      usersAffectedByApproximateOrdering: 1,
      progressRowsCreated: 1,
    });
    expect(applied).toMatchObject({
      flightsNeedingBackfill: 1,
      flightsReplayedWithProcessedAtOrder: 0,
      legacyFlightsReplayedApproximate: 2,
      usersAffectedByApproximateOrdering: 1,
      progressRowsCreated: 1,
    });
  });
});
