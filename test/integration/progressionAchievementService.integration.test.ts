import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { achievements, flights, flightProgress, igcFiles, personalGridClaims, trackPoints, users } from '../../src/db/schema.js';
import { createGridClaimService } from '../../src/services/gridClaimService.js';
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

async function createUser() {
  const [user] = await database.db.insert(users).values({
    email: 'achievement-' + crypto.randomUUID() + '@example.com',
  }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');
  return user;
}

async function createPathFlight(
  userId: string,
  coordinates: readonly ProjectedCoordinate[],
  startedAt = new Date('2026-07-20T12:00:00Z'),
) {
  const [igcFile] = await database.db.insert(igcFiles).values({
    userId,
    originalFilename: 'achievement.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: 'flights/' + crypto.randomUUID() + '.igc',
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db.insert(flights).values({
    userId,
    igcFileId: igcFile.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone: 'UTC',
    startedAt,
    endedAt: new Date(startedAt.getTime() + 1_000),
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  const points = await toWgs84(coordinates);
  await database.db.insert(trackPoints).values(points.map((point, sequenceNumber) => ({
    flightId: flight.id,
    sequenceNumber,
    recordedAt: new Date(startedAt.getTime() + sequenceNumber * 1_000),
    latitude: point.latitude,
    longitude: point.longitude,
    gpsAltitudeMeters: 1_000,
    pressureAltitudeMeters: 1_000,
  })));

  return { flightId: flight.id, userId, launchTimezone: 'UTC' };
}

async function createLineFlight(
  userId: string,
  startX: number,
  endX: number,
  startedAt = new Date('2026-07-20T12:00:00Z'),
) {
  return createPathFlight(userId, [[startX, 100], [endX, 100]], startedAt);
}

async function storedAchievements(userId: string) {
  return database.db.select().from(achievements)
    .where(eq(achievements.userId, userId))
    .orderBy(achievements.achievementKey);
}

describe('Progression achievements with PostgreSQL', () => {
  it('awards multiple crossed milestones with an immutable details snapshot', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const first = await createLineFlight(user.id, 100, 8_100);
    await expect(service.process(first)).resolves.toMatchObject({
      newPersonalCellCount: 9,
      personalCellTotalAfter: 9,
    });
    expect((await storedAchievements(user.id)).filter((row) => row.achievementType === 'unique_cells_milestone')).toEqual([]);

    const startedAt = new Date('2026-07-21T12:00:00Z');
    const second = await createLineFlight(user.id, 9_100, 29_100, startedAt);
    const result = await service.process(second);
    const rows = (await storedAchievements(user.id)).filter((row) => row.achievementType === 'unique_cells_milestone');

    expect(result).toMatchObject({
      newPersonalCellCount: 21,
      personalCellTotalAfter: 30,
    });
    expect(rows.map((row) => row.achievementKey)).toEqual(['unique-cells:10', 'unique-cells:25']);
    expect(rows).toEqual(rows.map((row) => expect.objectContaining({
      userId: user.id,
      achievementType: 'unique_cells_milestone',
      sourceFlightId: second.flightId,
      earnedAt: result.evaluatedAt,
      details: {
        milestone: row.details.milestone,
        previousTotal: 9,
        newTotal: 30,
        newCells: 21,
        flightStartedAt: startedAt.toISOString(),
      },
    })));
  });

  it('establishes a total-cell record, then awards only strictly larger records', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const first = await createLineFlight(user.id, 100, 900);
    await service.process(first);

    const larger = await createLineFlight(user.id, 100, 2_100, new Date('2026-07-21T12:00:00Z'));
    await service.process(larger);
    const tie = await createLineFlight(user.id, 100, 2_100, new Date('2026-07-22T12:00:00Z'));
    await service.process(tie);
    const lower = await createLineFlight(user.id, 100, 1_100, new Date('2026-07-23T12:00:00Z'));
    await service.process(lower);

    const totalBestRows = (await storedAchievements(user.id))
      .filter((row) => row.achievementType === 'personal_best_total_cells');
    expect(totalBestRows).toHaveLength(2);
    expect(totalBestRows.map((row) => row.sourceFlightId)).toEqual(expect.arrayContaining([
      first.flightId,
      larger.flightId,
    ]));
    expect(totalBestRows.find((row) => row.sourceFlightId === first.flightId)?.details).toMatchObject({
      previousRecord: null,
      newRecord: 1,
      directCells: 1,
      enclosedCells: 0,
      totalCells: 1,
    });
    expect(totalBestRows.find((row) => row.sourceFlightId === larger.flightId)?.details).toMatchObject({
      previousRecord: 1,
      newRecord: 3,
      directCells: 3,
      enclosedCells: 0,
      totalCells: 3,
    });
  });

  it('does not establish an enclosed record for zero enclosed cells', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const flight = await createLineFlight(user.id, 100, 2_100);

    await service.process(flight);

    expect((await storedAchievements(user.id))
      .filter((row) => row.achievementType === 'personal_best_enclosed_cells')).toEqual([]);
  });

  it('uses enclosed cells in the total and awards both personal-best types for one flight', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const ring = [
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500],
    ] as const;
    const flight = await createPathFlight(user.id, ring, new Date('2026-07-24T12:00:00Z'));

    const result = await service.process(flight);
    const rows = await storedAchievements(user.id);

    expect(result).toMatchObject({
      directCellCount: 8,
      enclosedCellCount: 1,
    });
    expect(rows.map((row) => row.achievementType).sort()).toEqual([
      'personal_best_enclosed_cells',
      'personal_best_total_cells',
    ]);
    expect(rows.find((row) => row.achievementType === 'personal_best_total_cells')?.details).toMatchObject({
      previousRecord: null,
      newRecord: 9,
      directCells: 8,
      enclosedCells: 1,
      totalCells: 9,
      flightStartedAt: '2026-07-24T12:00:00.000Z',
    });
    expect(rows.find((row) => row.achievementType === 'personal_best_enclosed_cells')?.details).toMatchObject({
      previousRecord: null,
      newRecord: 1,
      directCells: 8,
      enclosedCells: 1,
      totalCells: 9,
    });
  });

  it('does not duplicate achievements on duplicate evaluation or reprocessing', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const flight = await createLineFlight(user.id, 100, 29_100);

    await service.process(flight);
    const firstRows = await storedAchievements(user.id);
    await service.process(flight);
    expect(await storedAchievements(user.id)).toEqual(firstRows);

    await expect(service.reprocess(flight)).resolves.toMatchObject({ status: 'completed' });
    expect(await storedAchievements(user.id)).toEqual(firstRows);
  });

  it('retains the achievement and clears only sourceFlightId when the source flight is deleted', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const flight = await createLineFlight(user.id, 100, 10_100);
    await service.process(flight);
    const [before] = (await storedAchievements(user.id))
      .filter((row) => row.achievementType === 'unique_cells_milestone');
    if (!before) throw new Error('Expected a milestone achievement.');

    await database.db.delete(flights).where(eq(flights.id, flight.flightId));

    const [after] = (await storedAchievements(user.id))
      .filter((row) => row.achievementType === 'unique_cells_milestone');
    expect(after).toMatchObject({
      id: before.id,
      userId: user.id,
      sourceFlightId: null,
      achievementKey: before.achievementKey,
      details: before.details,
    });
  });

  it('cascades achievements when the owning user is deleted', async () => {
    const user = await createUser();
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const flight = await createLineFlight(user.id, 100, 10_100);
    await service.process(flight);
    expect(await storedAchievements(user.id)).toHaveLength(2);

    await database.db.delete(users).where(eq(users.id, user.id));

    expect(await database.db.select().from(achievements).where(eq(achievements.userId, user.id))).toEqual([]);
  });

  it('rolls back first flight progression and achievements together when achievement creation fails', async () => {
    const user = await createUser();
    const flight = await createLineFlight(user.id, 100, 10_100);
    const failingAchievements = {
      awardUniqueCellMilestones: async () => {
        throw new Error('achievement write failed');
      },
      awardPersonalBestAchievements: async () => [],
    };
    const service = createGridClaimService(database.db, { cellSize: 1_000 }, failingAchievements);

    await expect(service.process(flight)).rejects.toThrow('achievement write failed');
    expect(await database.db.select().from(flightProgress).where(eq(flightProgress.flightId, flight.flightId))).toEqual([]);
    expect(await database.db.select().from(personalGridClaims).where(eq(personalGridClaims.claimFlight, flight.flightId))).toEqual([]);
    expect(await storedAchievements(user.id)).toEqual([]);
  });
});
