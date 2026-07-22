import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { achievementRecordEvents, achievementRecords, achievements, flights, igcFiles, personalGridClaims, users } from '../../src/db/schema.js';
import { evaluateArenaAchievementsInTransaction } from '../../src/services/arenaAchievementService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE arenas, users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createUser() {
  const [user] = await database.db.insert(users).values({ email: `arena-award-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  if (!user) throw new Error('user insert failed');
  return user.id;
}

async function createFlight(userId: string, status: 'processing' | 'completed' | 'failed' = 'processing') {
  const [file] = await database.db.insert(igcFiles).values({
    userId, originalFilename: 'flight.igc', contentType: 'application/octet-stream', byteSize: 1, bucketKey: `arena/${crypto.randomUUID()}`,
  }).returning({ id: igcFiles.id });
  if (!file) throw new Error('file insert failed');
  const [flight] = await database.db.insert(flights).values({
    userId, igcFileId: file.id, contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'), processingStatus: status,
    launchLatitude: 0, launchLongitude: 0, launchTimezone: 'UTC',
  }).returning({ id: flights.id });
  if (!flight) throw new Error('flight insert failed');
  return flight.id;
}

async function createArena(sourceId: number, type: 'launch' | 'general' | 'state' | 'country', denominator: number | null, _size: number | null, wkt = 'POLYGON((-1000 -1000,10000 -1000,10000 1000,-1000 1000,-1000 -1000))') {
  const externalId = type === 'state' || type === 'country' ? String(sourceId) : null;
  const result = await database.pool.query<{ id: string }>(`INSERT INTO arenas
    (source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
    VALUES ($1, $2, 'United States', 'US',
      ST_Multi(ST_GeomFromText($3, 6933)),
      $4, $5, $6) RETURNING id`, [sourceId, `${type}-${sourceId}`, wkt, type, externalId, denominator]);
  if (!result.rows[0]) throw new Error('arena insert failed');
  return result.rows[0].id;
}

async function createLaunchAround(sourceId: number, longitude: number): Promise<void> {
  await database.pool.query(`INSERT INTO arenas
    (source_id, name, country, country_code, area, arena_type)
    VALUES ($1, $2, 'United States', 'US', ST_Multi(ST_Buffer(
      ST_Transform(ST_SetSRID(ST_MakePoint($3, 0), 4326), 6933), 25_000
    )), 'launch')`, [sourceId, `launch-${sourceId}`, longitude]);
}

async function setLaunch(flightId: string, longitude: number): Promise<void> {
  await database.pool.query('UPDATE flights SET launch_latitude = 0, launch_longitude = $2 WHERE flight_id = $1', [flightId, longitude]);
}

describe('Arena achievement evaluation with PostgreSQL', () => {
  it('evaluates current processing flight, permanent touches, exact coverage, and idempotency', async () => {
    const userId = await createUser();
    const flightId = await createFlight(userId);
    await createArena(1, 'launch', 1, 1_000);
    await createArena(2, 'general', 1, 1_000);
    await createArena(3, 'state', null, null);
    await createArena(4, 'state', null, null);
    await createArena(5, 'state', null, null);
    await createArena(6, 'country', null, null);
    await createArena(7, 'country', null, null);
    await createArena(8, 'country', null, null);
    await database.db.insert(personalGridClaims).values([0, 99].map((x) => ({
      cellSize: 1_000, x, y: 0, claimFlight: flightId, claimUser: userId, claimTimestamp: new Date(),
    })));

    const input = { userId, sourceFlightId: flightId, cellSize: 1_000, earnedAt: new Date('2026-07-21T00:00:00Z') };
    const result = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, input));
    expect(result.newlyEarned).toEqual(expect.arrayContaining([
      'first_flight_from_launch', 'complete_a_launch_arena', 'first_cells_in_general_arena',
      'general_arenas_explored_1', 'general_coverage_10', 'general_coverage_25', 'general_coverage_50', 'general_coverage_75', 'general_coverage_100',
      'states_flown_in_1', 'countries_flown_in_1',
    ]));
    expect(result.newlyEarned.some((key) => key.startsWith('states_') && (key.includes('coverage') || key.includes('completed')))).toBe(false);
    expect(result.newlyEarned.some((key) => key.startsWith('countries_') && (key.includes('coverage') || key.includes('completed')))).toBe(false);
    expect(result.record).toMatchObject({ newRecord: true, value: 1 });

    const again = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, input));
    expect(again.newlyEarned).toEqual([]);
    expect(again.record).toMatchObject({ newRecord: false, value: 1 });
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, userId))).toHaveLength(11);
    expect(await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, userId))).toHaveLength(1);
    expect(await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, userId))).toHaveLength(1);
  });

  it('does not use invalid general denominators for coverage while retaining touch awards', async () => {
    const userId = await createUser();
    const flightId = await createFlight(userId);
    await createArena(10, 'general', null, null);
    await createArena(11, 'launch', null, 1_000);
    await createArena(12, 'launch', null, null);
    await database.db.insert(personalGridClaims).values({ x: 0, y: 0, claimFlight: flightId, claimUser: userId, claimTimestamp: new Date() });
    const result = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, {
      userId, sourceFlightId: flightId, cellSize: 1_000, earnedAt: new Date(),
    }));
    expect(result.newlyEarned).toContain('first_cells_in_general_arena');
    expect(result.newlyEarned.some((key) => key.startsWith('general_coverage_'))).toBe(false);
    expect(result.newlyEarned).not.toContain('complete_a_launch_arena');
  });

  it('counts distinct launch arenas across completed and current flights and never invents threshold 1', async () => {
    const userId = await createUser();
    const currentFlightId = await createFlight(userId);
    for (let index = 0; index < 50; index += 1) await createArena(100 + index, 'launch', null, null);
    for (let index = 0; index < 49; index += 1) await createFlight(userId, 'completed');
    const result = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, {
      userId, sourceFlightId: currentFlightId, cellSize: 1_000, earnedAt: new Date(),
    }));
    expect(result.newlyEarned).toEqual(expect.arrayContaining([
      'first_flight_from_launch', 'launches_visited_3', 'launches_visited_5', 'launches_visited_10', 'launches_visited_25', 'launches_visited_50',
    ]));
    expect(result.newlyEarned).not.toContain('launches_visited_1');
  });

  it('counts completed and the explicitly evaluated processing origin, excluding failed/unrelated processing and repeated visits', async () => {
    const userId = await createUser();
    const priorA = await createFlight(userId, 'completed');
    const priorARepeat = await createFlight(userId, 'completed');
    const priorB = await createFlight(userId, 'completed');
    const failed = await createFlight(userId, 'failed');
    const unrelatedProcessing = await createFlight(userId, 'processing');
    const current = await createFlight(userId, 'processing');
    for (const [sourceId, longitude] of [[500, 0], [501, 1], [502, 2], [503, 3], [504, 4]] as const) {
      await createLaunchAround(sourceId, longitude);
    }
    await setLaunch(priorA, 0);
    await setLaunch(priorARepeat, 0);
    await setLaunch(priorB, 1);
    await setLaunch(failed, 2);
    await setLaunch(unrelatedProcessing, 3);
    await setLaunch(current, 4);
    const result = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, {
      userId, sourceFlightId: current, cellSize: 1_000, earnedAt: new Date(),
    }));
    expect(result.newlyEarned).toContain('first_flight_from_launch');
    expect(result.newlyEarned).toContain('launches_visited_3');
    expect(result.newlyEarned).not.toContain('launches_visited_5');
  });

  it('returns no Arena awards when a user has no personal claims', async () => {
    const userId = await createUser();
    const flightId = await createFlight(userId);
    await createArena(200, 'launch', 1, 1_000);
    await createArena(201, 'general', 1, 1_000);
    await createArena(202, 'state', null, null);
    await createArena(203, 'country', null, null);
    const result = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, {
      userId, sourceFlightId: flightId, cellSize: 1_000, earnedAt: new Date(),
    }));
    expect(result.newlyEarned).toEqual(['first_flight_from_launch']);
    expect(result.record).toBeNull();
  });

  it('awards global General coverage at exact 10/25/50/75/100 boundaries', async () => {
    const userId = await createUser();
    const flightId = await createFlight(userId);
    const one = 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))';
    const three = 'POLYGON((0 0,3000 0,3000 1000,0 1000,0 0))';
    const four = 'POLYGON((0 0,4000 0,4000 1000,0 1000,0 0))';
    await createArena(300, 'general', 10, 1_000, one);
    await createArena(301, 'general', 4, 1_000, one);
    await createArena(302, 'general', 2, 1_000, one);
    await createArena(303, 'general', 4, 1_000, three);
    await createArena(304, 'general', 4, 1_000, four);
    await database.db.insert(personalGridClaims).values([0, 1, 2, 3].map((x) => ({
      cellSize: 1_000, x, y: 0, claimFlight: flightId, claimUser: userId, claimTimestamp: new Date(),
    })));
    const result = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, {
      userId, sourceFlightId: flightId, cellSize: 1_000, earnedAt: new Date(),
    }));
    expect(result.newlyEarned).toEqual(expect.arrayContaining([
      'general_coverage_10', 'general_coverage_25', 'general_coverage_50', 'general_coverage_75', 'general_coverage_100',
    ]));
    expect(result.newlyEarned.filter((key) => key.startsWith('general_coverage_'))).toHaveLength(5);
    expect(result.newlyEarned.some((key) => key.includes('completed'))).toBe(false);
  });

  it('counts each tagged Launch once and records only strict improvements', async () => {
    const userId = await createUser();
    const firstFlight = await createFlight(userId);
    const secondFlight = await createFlight(userId);
    const thirdFlight = await createFlight(userId);
    const one = 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))';
    const two = 'POLYGON((1000 0,2000 0,2000 1000,1000 1000,1000 0))';
    await createArena(400, 'launch', null, null, one);
    await createArena(401, 'launch', null, null, one);
    await createArena(402, 'launch', null, null, one);
    await database.db.insert(personalGridClaims).values({ x: 0, y: 0, claimFlight: firstFlight, claimUser: userId, claimTimestamp: new Date() });
    await database.db.insert(personalGridClaims).values({ x: 0, y: 0, claimFlight: secondFlight, claimUser: userId, claimTimestamp: new Date() });
    const first = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, { userId, sourceFlightId: firstFlight, cellSize: 1_000, earnedAt: new Date() }));
    expect(first.record).toMatchObject({ newRecord: true, value: 3 });
    await createArena(403, 'launch', null, null, two);
    await database.db.insert(personalGridClaims).values([0, 1].map((x) => ({
      cellSize: 1_000, x, y: 0, claimFlight: thirdFlight, claimUser: userId, claimTimestamp: new Date(),
    })));
    const second = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, { userId, sourceFlightId: thirdFlight, cellSize: 1_000, earnedAt: new Date() }));
    expect(second.record).toMatchObject({ newRecord: true, value: 4, previousValue: 3 });
    const lower = await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, { userId, sourceFlightId: secondFlight, cellSize: 1_000, earnedAt: new Date() }));
    expect(lower.record).toMatchObject({ newRecord: false, value: 4 });
    const events = await database.db.select({ value: achievementRecordEvents.value }).from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, userId));
    expect(events.map((event) => event.value).sort((a, b) => a - b)).toEqual([3, 4]);
  });
});
