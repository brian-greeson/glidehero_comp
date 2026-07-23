import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  achievements,
  activities,
  activityReactions,
  flightProgress,
  flights,
  igcFiles,
  personalGridClaims,
  trackPoints,
  userAchievementProgress,
  users,
} from '../../src/db/schema.js';
import { createUserHistoryRebuildService } from '../../src/services/userHistoryRebuildService.js';
import { resetAndMigrateTestDatabase } from './database.js';

type ProjectedCoordinate = readonly [x: number, y: number];

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users, arenas CASCADE');
});

afterAll(async () => {
  if (database) await database.pool.end();
});

async function createUser(label: string) {
  const [user] = await database.db.insert(users).values({
    email: `history-${label}-${crypto.randomUUID()}@example.com`,
  }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');
  return user;
}

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

async function createLineFlight(input: {
  userId: string;
  startX: number;
  endX: number;
  startedAt: Date | null;
  createdAt: Date;
  processedAt: Date;
}) {
  const [igcFile] = await database.db.insert(igcFiles).values({
    userId: input.userId,
    originalFilename: 'history.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `history/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db.insert(flights).values({
    userId: input.userId,
    igcFileId: igcFile.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone: 'UTC',
    startedAt: input.startedAt,
    endedAt: input.startedAt ? new Date(input.startedAt.getTime() + 1_000) : null,
    processedAt: input.processedAt,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  if (input.startedAt) {
    const points = await toWgs84([[input.startX, 100], [input.endX, 100]]);
    await database.db.insert(trackPoints).values(points.map((point, sequenceNumber) => ({
      flightId: flight.id,
      sequenceNumber,
      recordedAt: new Date(input.startedAt!.getTime() + sequenceNumber * 1_000),
      latitude: point.latitude,
      longitude: point.longitude,
      gpsAltitudeMeters: 1_000,
      pressureAltitudeMeters: 1_000,
    })));
  }
  return flight.id;
}

async function seedDerivedHistory(userId: string, flightId: string, reactorUserId?: string) {
  await database.db.insert(flightProgress).values({
    flightId,
    userId,
    directCellCount: 99,
    enclosedCellCount: 0,
    newPersonalCellCount: 99,
    personalCellTotalAfter: 99,
  });
  await database.db.insert(achievements).values({
    userId,
    achievementType: 'legacy',
    achievementKey: `legacy:${flightId}`,
    sourceFlightId: flightId,
    earnedAt: new Date('2026-01-01T00:00:00Z'),
    details: {},
  });
  await database.db.insert(userAchievementProgress).values({
    userId,
    lifetimeUniqueCellCount: 99,
    projectionVersion: 2,
  });
  const [activity] = await database.db.insert(activities).values({
    actorUserId: userId,
    activityType: 'flight',
    sourceFlightId: flightId,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  }).returning({ id: activities.id });
  if (activity && reactorUserId) {
    await database.db.insert(activityReactions).values({
      activityId: activity.id,
      activityOwnerUserId: userId,
      reactorUserId,
    });
  }
}

describe('userHistoryRebuildService', () => {
  it('rebuilds one user by flight time, removes reactions, and preserves other users and source data', async () => {
    const pilot = await createUser('pilot');
    const other = await createUser('other');
    const earlyStartedAt = new Date('2026-03-01T10:00:00Z');
    const lateStartedAt = new Date('2026-03-02T10:00:00Z');
    const earlyFlight = await createLineFlight({
      userId: pilot.id,
      startX: 100,
      endX: 8_100,
      startedAt: earlyStartedAt,
      createdAt: new Date('2026-04-02T10:00:00Z'),
      processedAt: new Date('2026-04-02T10:05:00Z'),
    });
    const lateFlight = await createLineFlight({
      userId: pilot.id,
      startX: 9_100,
      endX: 29_100,
      startedAt: lateStartedAt,
      createdAt: new Date('2026-04-01T10:00:00Z'),
      processedAt: new Date('2026-04-01T10:05:00Z'),
    });
    const otherFlight = await createLineFlight({
      userId: other.id,
      startX: 100,
      endX: 2_100,
      startedAt: earlyStartedAt,
      createdAt: earlyStartedAt,
      processedAt: earlyStartedAt,
    });
    await seedDerivedHistory(pilot.id, earlyFlight, other.id);
    await seedDerivedHistory(other.id, otherFlight);
    await database.db.insert(personalGridClaims).values({
      x: 0,
      y: 0,
      claimFlight: earlyFlight,
      claimUser: pilot.id,
      claimTimestamp: earlyStartedAt,
    });

    const result = await createUserHistoryRebuildService(database.db, { cellSize: 1_000 }).rebuild(pilot.id);
    expect(result).toMatchObject({
      status: 'completed',
      summary: {
        completedFlights: 2,
        activitiesDeleted: 1,
        activitiesCreated: 2,
        flightProgressDeleted: 1,
        flightProgressCreated: 2,
      },
    });

    const progress = await database.db.select({
      flightId: flightProgress.flightId,
      newCells: flightProgress.newPersonalCellCount,
      totalAfter: flightProgress.personalCellTotalAfter,
    }).from(flightProgress)
      .where(eq(flightProgress.userId, pilot.id))
      .orderBy(asc(flightProgress.evaluatedAt), asc(flightProgress.flightId));
    expect(progress).toEqual([
      { flightId: earlyFlight, newCells: 9, totalAfter: 9 },
      { flightId: lateFlight, newCells: 21, totalAfter: 30 },
    ]);

    const rebuiltAchievements = await database.db.select({
      key: achievements.achievementKey,
      flightId: achievements.sourceFlightId,
      earnedAt: achievements.earnedAt,
    }).from(achievements)
      .where(eq(achievements.userId, pilot.id))
      .orderBy(asc(achievements.earnedAt), asc(achievements.achievementKey));
    expect(rebuiltAchievements.some((row) => row.key === `legacy:${earlyFlight}`)).toBe(false);
    expect(rebuiltAchievements.filter((row) => row.key.startsWith('unique-cells:'))).toEqual([
      { key: 'unique-cells:10', flightId: lateFlight, earnedAt: lateStartedAt },
      { key: 'unique-cells:25', flightId: lateFlight, earnedAt: lateStartedAt },
    ]);

    expect(await database.db.select({
      flightId: activities.sourceFlightId,
      publishedAt: activities.publishedAt,
    }).from(activities).where(eq(activities.actorUserId, pilot.id))
      .orderBy(asc(activities.publishedAt), asc(activities.id))).toEqual([
      { flightId: earlyFlight, publishedAt: earlyStartedAt },
      { flightId: lateFlight, publishedAt: lateStartedAt },
    ]);
    expect(await database.db.select().from(activityReactions)).toEqual([]);
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, other.id))).toHaveLength(1);
    expect(await database.db.select().from(flightProgress).where(eq(flightProgress.userId, other.id))).toHaveLength(1);
    expect(await database.db.select().from(activities).where(eq(activities.actorUserId, other.id))).toHaveLength(1);
    expect(await database.db.select().from(flights)).toHaveLength(3);
    expect(await database.db.select().from(personalGridClaims).where(eq(personalGridClaims.claimUser, pilot.id))).toHaveLength(1);
    expect(await database.db.select({
      lifetimeUniqueCellCount: userAchievementProgress.lifetimeUniqueCellCount,
      projectionVersion: userAchievementProgress.projectionVersion,
    }).from(userAchievementProgress).where(eq(userAchievementProgress.userId, pilot.id))).toEqual([
      { lifetimeUniqueCellCount: 1, projectionVersion: 2 },
    ]);
  });

  it('returns controlled statuses without changing history when flights are absent or missing startedAt', async () => {
    const noFlights = await createUser('no-flights');
    await expect(createUserHistoryRebuildService(database.db, { cellSize: 1_000 }).rebuild(noFlights.id))
      .resolves.toEqual({ status: 'no_completed_flights' });
    await expect(createUserHistoryRebuildService(database.db, { cellSize: 1_000 }).rebuild(crypto.randomUUID()))
      .resolves.toEqual({ status: 'not_found' });

    const pilot = await createUser('invalid');
    const reactor = await createUser('reactor');
    const flightId = await createLineFlight({
      userId: pilot.id,
      startX: 100,
      endX: 2_100,
      startedAt: null,
      createdAt: new Date('2026-04-01T00:00:00Z'),
      processedAt: new Date('2026-04-01T00:05:00Z'),
    });
    await seedDerivedHistory(pilot.id, flightId, reactor.id);

    await expect(createUserHistoryRebuildService(database.db, { cellSize: 1_000 }).rebuild(pilot.id))
      .resolves.toEqual({ status: 'invalid_flight_history' });
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, pilot.id))).toHaveLength(1);
    expect(await database.db.select().from(flightProgress).where(eq(flightProgress.userId, pilot.id))).toHaveLength(1);
    expect(await database.db.select().from(activities).where(eq(activities.actorUserId, pilot.id))).toHaveLength(1);
    expect(await database.db.select().from(activityReactions)).toHaveLength(1);
  });

  it('rolls back the reset when replay fails', async () => {
    const pilot = await createUser('rollback');
    const reactor = await createUser('rollback-reactor');
    const startedAt = new Date('2026-05-01T00:00:00Z');
    const flightId = await createLineFlight({
      userId: pilot.id,
      startX: 100,
      endX: 2_100,
      startedAt,
      createdAt: startedAt,
      processedAt: new Date(startedAt.getTime() + 1_000),
    });
    await seedDerivedHistory(pilot.id, flightId, reactor.id);

    const service = createUserHistoryRebuildService(database.db, {
      cellSize: 1_000,
      afterReset: async () => {
        throw new Error('intentional rebuild failure');
      },
    });
    await expect(service.rebuild(pilot.id)).rejects.toThrow('intentional rebuild failure');
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, pilot.id))).toHaveLength(1);
    expect(await database.db.select().from(flightProgress).where(eq(flightProgress.userId, pilot.id))).toHaveLength(1);
    expect(await database.db.select().from(activities).where(eq(activities.actorUserId, pilot.id))).toHaveLength(1);
    expect(await database.db.select().from(activityReactions)).toHaveLength(1);
    expect(await database.db.select().from(userAchievementProgress).where(eq(userAchievementProgress.userId, pilot.id))).toHaveLength(1);
  });
});
