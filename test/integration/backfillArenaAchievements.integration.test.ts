import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  achievementRecordEvents,
  achievements,
  achievementRecords,
  flights,
  igcFiles,
  personalGridClaims,
  users,
} from '../../src/db/schema.js';
import { runArenaAchievementBackfill } from '../../src/scripts/backfillArenaAchievements.js';
import { evaluateArenaAchievementsInTransaction } from '../../src/services/arenaAchievementService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE arenas, users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function user(label: string): Promise<string> {
  const [row] = await database.db.insert(users).values({ email: `arena-backfill-${label}-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function flight(userId: string, label: string, startedAt: string, createdAt: string, id?: string): Promise<string> {
  const [file] = await database.db.insert(igcFiles).values({
    userId, originalFilename: `${label}.igc`, contentType: 'application/octet-stream', byteSize: 1, bucketKey: `arena-backfill/${crypto.randomUUID()}`,
  }).returning({ id: igcFiles.id });
  if (!file) throw new Error('file insert failed');
  const [row] = await database.db.insert(flights).values({
    ...(id ? { id } : {}), userId, igcFileId: file.id, contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'), processingStatus: 'completed',
    startedAt: new Date(startedAt), createdAt: new Date(createdAt), launchLatitude: 0, launchLongitude: 0, launchTimezone: 'UTC',
  }).returning({ id: flights.id });
  if (!row) throw new Error('flight insert failed');
  return row.id;
}

async function arena(sourceId: number, type: 'launch' | 'general' | 'state' | 'country', wkt: string, denominator: number | null, _size: number | null): Promise<void> {
  const externalId = type === 'state' || type === 'country' ? String(sourceId) : null;
  await database.pool.query(`INSERT INTO arenas
    (source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
    VALUES ($1, $2, 'United States', 'US', ST_Multi(ST_GeomFromText($3, 6933)), $4, $5, $6)`,
  [sourceId, `${type}-${sourceId}`, wkt, type, externalId, denominator]);
}

describe('Release 2 Arena achievement backfill with PostgreSQL', () => {
  it('replays as-of snapshots, preserves old awards, and rolls dry-run back', async () => {
    const firstUser = await user('first');
    const secondUser = await user('second');
    const first = await flight(firstUser, 'first', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    const second = await flight(firstUser, 'second', '2026-02-02T00:00:00Z', '2025-01-01T00:00:00Z');
    await flight(firstUser, 'third', '2026-02-03T00:00:00Z', '2026-02-03T00:00:00Z');
    await flight(secondUser, 'other', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z');
    await arena(1, 'launch', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 1, 1_000);
    await arena(2, 'launch', 'POLYGON((1000 0,2000 0,2000 1000,1000 1000,1000 0))', 1, 1_000);
    await arena(3, 'general', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 1, 1_000);
    await arena(6, 'general', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', null, null);
    await arena(7, 'launch', 'POLYGON((5000 0,6000 0,6000 1000,5000 1000,5000 0))', 1, 2_000);
    await arena(4, 'state', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', null, null);
    await arena(5, 'country', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', null, null);
    await database.db.insert(personalGridClaims).values([
      { x: 0, y: 0, claimFlight: first, claimUser: firstUser, claimTimestamp: new Date('2026-01-01T00:00:00Z') },
      { x: 0, y: 0, claimFlight: second, claimUser: firstUser, claimTimestamp: new Date('2026-02-02T00:00:00Z') },
      { x: 1, y: 0, claimFlight: second, claimUser: firstUser, claimTimestamp: new Date('2026-02-02T00:00:00Z') },
    ]);
    await database.db.insert(achievements).values({
      userId: firstUser, achievementType: 'legacy', achievementKey: 'legacy_old', earnedAt: new Date('2025-01-01T00:00:00Z'), details: {},
    });
    await database.db.insert(achievements).values({
      userId: firstUser, achievementType: 'threshold', achievementKey: 'general_arenas_explored_1',
      sourceFlightId: second, earnedAt: new Date('2025-01-01T00:00:00Z'), details: { old: true },
    });

    const dryLog: string[] = [];
    const dry = await runArenaAchievementBackfill(database.db, {
      apply: false,
      cellSize: 1_000,
      batchSize: 1,
      logger: { log: (line) => dryLog.push(line), error: () => undefined },
    });
    expect(dry.flightsExamined).toBe(4);
    expect(dry.achievementCounts.first_flight_from_launch).toBe(2);
    expect(dry.launchTagRecordEvents).toBe(2);
    expect(dry.unchangedOrAlreadyEarned).toBe(1);
    expect(dryLog).toContain('Updating user 1 / 2');
    expect(dryLog).toContain('Updating user 2 / 2');
    expect(dryLog.filter((line) => line.startsWith('Precomputing Arena membership for user'))).toHaveLength(2);
    expect(dryLog).toContain('Processing flight batch 1 / 3');
    expect(dryLog).toContain('Processing flight batch 1 / 1');
    expect(await database.db.select().from(achievementRecords)).toHaveLength(0);
    expect(await database.db.select().from(achievementRecordEvents)).toHaveLength(0);

    const applyLog: string[] = [];
    const applied = await runArenaAchievementBackfill(database.db, {
      apply: true,
      cellSize: 1_000,
      batchSize: 1,
      logger: { log: (line) => applyLog.push(line), error: () => undefined },
    });
    expect(applied.failures).toBe(0);
    expect(applied.unchangedOrAlreadyEarned).toBe(1);
    expect(applyLog.filter((line) => line.startsWith('Precomputing Arena membership for user'))).toHaveLength(2);
    expect(applyLog).toContain('Processing flight batch 2 / 3');
    const awards = await database.db.select().from(achievements).where(eq(achievements.userId, firstUser));
    expect(awards.find((row) => row.achievementKey === 'first_flight_from_launch')?.sourceFlightId).toBe(first);
    expect(awards.find((row) => row.achievementKey === 'complete_a_launch_arena')?.sourceFlightId).toBe(first);
    expect(awards.some((row) => row.achievementKey === 'legacy_old')).toBe(true);
    expect(awards.find((row) => row.achievementKey === 'general_arenas_explored_1')?.sourceFlightId).toBe(second);
    const events = await database.db.select({ value: achievementRecordEvents.value }).from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, firstUser));
    expect(events.map((row) => row.value)).toEqual([1, 2]);
  });

  it('rejects an existing launch-tag record and leaves all rows untouched', async () => {
    const id = await user('precondition');
    const f = await flight(id, 'record', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    await database.pool.query(`INSERT INTO achievement_records (user_id, record_key, best_value, source_flight_id, earned_at, details)
      VALUES ($1, 'most_launches_tagged_one_flight', 2, $2, now(), '{}'::jsonb)`, [id, f]);
    await expect(runArenaAchievementBackfill(database.db, { apply: true, cellSize: 1_000 })).rejects.toThrow('backfill made no changes');
    expect(await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, id))).toHaveLength(1);
  });

  it('replays same-time flights in deterministic UUID order with the same awards and record events as live evaluation', async () => {
    const liveUser = await user('live-order');
    const replayUser = await user('replay-order');
    const liveFirst = await flight(liveUser, 'first', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '00000000-0000-4000-8000-000000000001');
    const liveSecond = await flight(liveUser, 'second', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '00000000-0000-4000-8000-000000000002');
    const replayFirst = await flight(replayUser, 'first', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '00000000-0000-4000-8000-000000000011');
    const replaySecond = await flight(replayUser, 'second', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '00000000-0000-4000-8000-000000000012');
    await arena(20, 'launch', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', null, null);
    await arena(21, 'launch', 'POLYGON((1000 0,2000 0,2000 1000,1000 1000,1000 0))', null, null);
    await arena(22, 'general', 'POLYGON((0 0,2000 0,2000 1000,0 1000,0 0))', 2, 1_000);
    await database.db.insert(personalGridClaims).values([
      { x: 0, y: 0, claimFlight: liveFirst, claimUser: liveUser, claimTimestamp: new Date('2026-05-01T00:00:00Z') },
      { x: 0, y: 0, claimFlight: liveSecond, claimUser: liveUser, claimTimestamp: new Date('2026-05-01T00:00:00Z') },
      { x: 1, y: 0, claimFlight: liveSecond, claimUser: liveUser, claimTimestamp: new Date('2026-05-01T00:00:00Z') },
      { x: 0, y: 0, claimFlight: replayFirst, claimUser: replayUser, claimTimestamp: new Date('2026-05-01T00:00:00Z') },
      { x: 0, y: 0, claimFlight: replaySecond, claimUser: replayUser, claimTimestamp: new Date('2026-05-01T00:00:00Z') },
      { x: 1, y: 0, claimFlight: replaySecond, claimUser: replayUser, claimTimestamp: new Date('2026-05-01T00:00:00Z') },
    ]);
    const liveIds: string[] = [];
    for (const [sourceFlightId, ids] of [[liveFirst, [liveFirst]], [liveSecond, [liveFirst, liveSecond]]] as const) {
      liveIds.push(sourceFlightId);
      await database.db.transaction((tx) => evaluateArenaAchievementsInTransaction(tx, {
        userId: liveUser, sourceFlightId, cellSize: 1_000, earnedAt: new Date('2026-05-01T00:00:00Z'), historicalFlightIds: ids,
      }));
    }
    const liveAwards = await database.db.select({ key: achievements.achievementKey }).from(achievements).where(eq(achievements.userId, liveUser));
    const liveEvents = await database.db.select({ value: achievementRecordEvents.value }).from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, liveUser)).orderBy(achievementRecordEvents.value);
    await database.pool.query('DELETE FROM achievement_record_events WHERE user_id = $1', [liveUser]);
    await database.pool.query('DELETE FROM achievement_records WHERE user_id = $1', [liveUser]);
    await database.pool.query('DELETE FROM achievements WHERE user_id = $1', [liveUser]);
    await database.pool.query("UPDATE flights SET processing_status = 'failed' WHERE user_id = $1", [liveUser]);
    const applied = await runArenaAchievementBackfill(database.db, { apply: true, cellSize: 1_000 });
    expect(applied.failures).toBe(0);
    const replayAwards = await database.db.select({ key: achievements.achievementKey }).from(achievements).where(eq(achievements.userId, replayUser));
    const replayEvents = await database.db.select({ value: achievementRecordEvents.value }).from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, replayUser)).orderBy(achievementRecordEvents.value);
    expect(replayAwards.map((row) => row.key).sort()).toEqual(liveAwards.map((row) => row.key).sort());
    expect(replayEvents.map((row) => row.value)).toEqual(liveEvents.map((row) => row.value));
    expect(applied.launchTagRecordEvents).toBe(2);
    expect(liveIds).toEqual([liveFirst, liveSecond]);
  });

  it('rolls back every user when an injected evaluator failure occurs', async () => {
    const id = await user('failure');
    await flight(id, 'one', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');
    let calls = 0;
    const failure = runArenaAchievementBackfill(database.db, {
      apply: true,
      cellSize: 1_000,
      evaluate: async () => {
        calls += 1;
        throw new Error('injected evaluator failure');
      },
    });
    await expect(failure).rejects.toThrow('backfill failed');
    await expect(failure).rejects.toMatchObject({ committedBatchesMayRemain: false });
    expect(calls).toBe(1);
    expect(await database.db.select().from(achievements)).toHaveLength(0);
    expect(await database.db.select().from(achievementRecords)).toHaveLength(0);
    expect(await database.db.select().from(achievementRecordEvents)).toHaveLength(0);
  });

  it('keeps earlier committed batches when a later batch fails', async () => {
    const id = await user('partial-failure');
    const first = await flight(id, 'one', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
    const second = await flight(id, 'two', '2026-06-02T00:00:00Z', '2026-06-02T00:00:00Z');
    await arena(30, 'launch', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 1, 1_000);
    await database.db.insert(personalGridClaims).values([
      { x: 0, y: 0, claimFlight: first, claimUser: id, claimTimestamp: new Date('2026-06-01T00:00:00Z') },
      { x: 0, y: 0, claimFlight: second, claimUser: id, claimTimestamp: new Date('2026-06-02T00:00:00Z') },
    ]);
    let calls = 0;
    const result = runArenaAchievementBackfill(database.db, {
      apply: true,
      cellSize: 1_000,
      batchSize: 1,
      evaluate: async (transaction, input) => {
        calls += 1;
        if (calls === 2) throw new Error('later batch failed');
        return evaluateArenaAchievementsInTransaction(transaction, input);
      },
    });

    await expect(result).rejects.toMatchObject({ committedBatchesMayRemain: true });
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, id))).not.toHaveLength(0);
    expect(await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, id))).toHaveLength(1);
  });
});
