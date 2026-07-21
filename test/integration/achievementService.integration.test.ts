import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { achievementRecordEvents, achievementRecords, achievements, flights, igcFiles, users } from '../../src/db/schema.js';
import { createAchievementService } from '../../src/services/achievementService.js';
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

async function createUser() {
  const [user] = await database.db.insert(users).values({ email: `award-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');
  return user;
}

describe('Release 2 achievement persistence with PostgreSQL', () => {
  it('awards a one-time achievement idempotently and retains its original earned date', async () => {
    const user = await createUser();
    const service = createAchievementService(database.db);
    const firstDate = new Date('2026-07-01T00:00:00Z');
    await expect(service.award({ userId: user.id, key: 'first_flight_from_launch', earnedAt: firstDate })).resolves.toEqual({
      key: 'first_flight_from_launch', newlyEarned: true,
    });
    await expect(service.award({ userId: user.id, key: 'first_flight_from_launch', earnedAt: new Date('2026-08-01T00:00:00Z') })).resolves.toEqual({
      key: 'first_flight_from_launch', newlyEarned: false,
    });
    const [row] = await database.db.select().from(achievements).where(eq(achievements.userId, user.id));
    expect(row?.earnedAt).toEqual(firstDate);
  });

  it('keeps threshold provenance and isolates users and keys', async () => {
    const user = await createUser();
    const otherUser = await createUser();
    const service = createAchievementService(database.db);
    await service.award({ userId: user.id, key: 'launches_visited_3', value: 4, details: { visited: 4 } });
    await service.award({ userId: otherUser.id, key: 'launches_visited_3', value: 3 });
    await service.award({ userId: user.id, key: 'launches_visited_5', value: 5 });
    const rows = await database.db.select().from(achievements).where(eq(achievements.userId, user.id)).orderBy(achievements.achievementKey);
    expect(rows.map((row) => row.achievementKey)).toEqual(['launches_visited_3', 'launches_visited_5']);
    expect(rows[0]?.details).toMatchObject({ value: 4, visited: 4, threshold: 3, category: 'launch', kind: 'threshold' });
    expect((await database.db.select().from(achievements).where(eq(achievements.userId, otherUser.id)))).toHaveLength(1);
  });

  it('advances a personal best strictly, retains events, and ignores equal/lower values', async () => {
    const user = await createUser();
    const service = createAchievementService(database.db);
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 2 })).resolves.toMatchObject({
      newRecord: true, previousValue: null,
    });
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 2 })).resolves.toMatchObject({
      newRecord: false, value: 2,
    });
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 1 })).resolves.toMatchObject({
      newRecord: false, value: 2,
    });
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 5 })).resolves.toMatchObject({
      newRecord: true, previousValue: 2,
    });
    const [record] = await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, user.id));
    expect(record?.bestValue).toBe(5);
    const events = await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, user.id)).orderBy(achievementRecordEvents.earnedAt);
    expect(events.map((event) => event.value)).toEqual([2, 5]);
  });

  it('serializes concurrent record attempts to one monotonic best and event per winning value', async () => {
    const user = await createUser();
    const service = createAchievementService(database.db);
    const results = await Promise.all([1, 4, 2, 8, 5].map((value) => service.awardRecord({
      userId: user.id, key: 'most_launches_tagged_one_flight', value,
    })));
    const [record] = await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, user.id));
    const events = await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, user.id));
    expect(record?.bestValue).toBe(8);
    const eventValues = events.map((event) => event.value).sort((a, b) => a - b);
    expect(eventValues.at(-1)).toBe(8);
    expect(new Set(eventValues).size).toBe(eventValues.length);
    expect(eventValues.every((value, index) => index === 0 || value > eventValues[index - 1]!)).toBe(true);
    expect(results.filter((result) => result.newRecord)).toHaveLength(events.length);
  });

  it('rolls back the current best when its event cannot be written', async () => {
    const user = await createUser();
    const service = createAchievementService(database.db);
    await database.pool.query(`
      CREATE FUNCTION fail_achievement_event_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced event failure'; END $$;
      CREATE TRIGGER fail_achievement_event_insert_trigger
      BEFORE INSERT ON achievement_record_events
      FOR EACH ROW EXECUTE FUNCTION fail_achievement_event_insert();
    `);
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 3 })).rejects.toThrow();
    await database.pool.query('DROP TRIGGER fail_achievement_event_insert_trigger ON achievement_record_events; DROP FUNCTION fail_achievement_event_insert();');
    expect(await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, user.id))).toEqual([]);
    expect(await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, user.id))).toEqual([]);

    await service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 3 });
    await database.pool.query(`
      CREATE FUNCTION fail_achievement_event_update() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced event update failure'; END $$;
      CREATE TRIGGER fail_achievement_event_update_trigger
      BEFORE INSERT ON achievement_record_events
      FOR EACH ROW EXECUTE FUNCTION fail_achievement_event_update();
    `);
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 7 })).rejects.toThrow();
    await database.pool.query('DROP TRIGGER fail_achievement_event_update_trigger ON achievement_record_events; DROP FUNCTION fail_achievement_event_update();');
    const [record] = await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, user.id));
    expect(record?.bestValue).toBe(3);
    expect(await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, user.id))).toHaveLength(1);
  });

  it('requires positive record values and enforces the database checks', async () => {
    const user = await createUser();
    const service = createAchievementService(database.db);
    await expect(service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 0 })).rejects.toThrow('must be positive');
    await expect(database.db.insert(achievementRecords).values({
      userId: user.id,
      recordKey: 'most_launches_tagged_one_flight',
      bestValue: 0,
      earnedAt: new Date(),
      details: {},
    })).rejects.toThrow();
    await expect(database.db.insert(achievementRecordEvents).values({
      recordId: crypto.randomUUID(),
      userId: user.id,
      value: 0,
      earnedAt: new Date(),
      details: {},
    })).rejects.toThrow();
  });

  it('retains awards when a source flight is deleted and cascades all history on user deletion', async () => {
    const foreignKeys = await database.pool.query<{ tableName: string; columnName: string; deleteAction: string }>(`
      SELECT child.relname AS "tableName", local_attribute.attname AS "columnName", constraint_row.confdeltype AS "deleteAction"
      FROM pg_constraint constraint_row
      JOIN pg_class child ON child.oid = constraint_row.conrelid
      JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY local_key(attnum, position) ON true
      JOIN pg_attribute local_attribute ON local_attribute.attrelid = constraint_row.conrelid AND local_attribute.attnum = local_key.attnum
      WHERE child.relname IN ('achievement_records', 'achievement_record_events') AND constraint_row.contype = 'f'
      ORDER BY child.relname, local_attribute.attname
    `);
    expect(foreignKeys.rows).toEqual(expect.arrayContaining([
      { tableName: 'achievement_records', columnName: 'source_flight_id', deleteAction: 'n' },
      { tableName: 'achievement_records', columnName: 'user_id', deleteAction: 'c' },
      { tableName: 'achievement_record_events', columnName: 'record_id', deleteAction: 'c' },
      { tableName: 'achievement_record_events', columnName: 'source_flight_id', deleteAction: 'n' },
      { tableName: 'achievement_record_events', columnName: 'user_id', deleteAction: 'c' },
    ]));
    const indexes = await database.pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('achievement_records', 'achievement_record_events')
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'achievement_records_user_id_record_key_unique',
      'achievement_records_user_id_updated_at_idx',
      'achievement_record_events_record_id_earned_at_idx',
      'achievement_record_events_user_id_earned_at_idx',
    ]));

    const user = await createUser();
    const [igc] = await database.db.insert(igcFiles).values({
      userId: user.id,
      originalFilename: 'award.igc',
      contentType: 'application/octet-stream',
      byteSize: 1,
      bucketKey: `flights/${crypto.randomUUID()}.igc`,
    }).returning({ id: igcFiles.id });
    if (!igc) throw new Error('IGC insert returned no row.');
    const [flight] = await database.db.insert(flights).values({
      userId: user.id,
      igcFileId: igc.id,
      contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
      processingStatus: 'completed',
    }).returning({ id: flights.id });
    if (!flight) throw new Error('Flight insert returned no row.');
    const service = createAchievementService(database.db);
    await service.award({ userId: user.id, key: 'first_flight_from_launch', sourceFlightId: flight.id });
    await service.awardRecord({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 2, sourceFlightId: flight.id });
    await database.db.delete(flights).where(eq(flights.id, flight.id));
    const [award] = await database.db.select().from(achievements).where(eq(achievements.userId, user.id));
    const [record] = await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, user.id));
    const [event] = await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, user.id));
    expect(award?.sourceFlightId).toBeNull();
    expect(record?.sourceFlightId).toBeNull();
    expect(event?.sourceFlightId).toBeNull();
    await database.db.delete(users).where(eq(users.id, user.id));
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, user.id))).toEqual([]);
    expect(await database.db.select().from(achievementRecords).where(eq(achievementRecords.userId, user.id))).toEqual([]);
    expect(await database.db.select().from(achievementRecordEvents).where(eq(achievementRecordEvents.userId, user.id))).toEqual([]);
  });

  it('rejects catalog misuse at the service boundary', async () => {
    const user = await createUser();
    const service = createAchievementService(database.db);
    await expect(service.award({ userId: user.id, key: 'not-a-key' })).rejects.toThrow('Unknown achievement key');
    await expect(service.awardRecord({ userId: user.id, key: 'first_flight_from_launch', value: 1 })).rejects.toThrow('not a personal-best record');
    await expect(service.award({ userId: user.id, key: 'launches_visited_3', value: 2 })).rejects.toThrow('below its threshold');
    await expect(service.award({ userId: user.id, key: 'most_launches_tagged_one_flight', value: 2 })).rejects.toThrow('must use the personal-best record API');
    expect(await database.db.select().from(achievements).where(eq(achievements.userId, user.id))).toEqual([]);
  });
});
