import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrateTestDatabase } from './database.js';
import { createArenaLeadershipReconciliationService } from '../../src/services/arenaLeadershipReconciliationService.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;
const cellSize = 1_000;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE arenas, users CASCADE');
});

afterAll(async () => {
  await database?.pool.end();
});

async function seed() {
  const userA = await database.pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('arena-a@example.com') RETURNING user_id AS id`,
  );
  const userB = await database.pool.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ('arena-b@example.com') RETURNING user_id AS id`,
  );
  const fileA = crypto.randomUUID();
  const fileB = crypto.randomUUID();
  const flightA = crypto.randomUUID();
  const flightB = crypto.randomUUID();
  await database.pool.query(
    `INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key)
     VALUES ($1::uuid, $3, 'a.igc', 'application/octet-stream', 1, $1::text), ($2::uuid, $4, 'b.igc', 'application/octet-stream', 1, $2::text)`,
    [fileA, fileB, userA.rows[0]?.id, userB.rows[0]?.id],
  );
  await database.pool.query(
    `INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status)
     VALUES ($1::uuid, $3, $5, $1::text, 'completed'), ($2::uuid, $4, $6, $2::text, 'completed')`,
    [flightA, flightB, userA.rows[0]?.id, userB.rows[0]?.id, fileA, fileB],
  );
  const general = crypto.randomUUID();
  const launch = crypto.randomUUID();
  const arenaShape = 'MULTIPOLYGON (((0 0, 3000 0, 3000 3000, 0 3000, 0 0)))';
  await database.pool.query(
    `INSERT INTO arenas (id, source_id, name, country, country_code, area, arena_type)
     VALUES ($1, 1, 'General', 'United States', 'US', ST_GeomFromText($3, 6933), 'general'),
            ($2, 2, 'Launch', 'United States', 'US', ST_GeomFromText($3, 6933), 'launch')`,
    [general, launch, arenaShape],
  );
  await database.pool.query(
    `INSERT INTO competition_grid_claims
       (competition_month, x, y, claim_flight, claim_user, claim_timestamp)
     VALUES
       ('2026-01-01', 0, 0, $1, $3, '2026-01-01T00:00:00Z'),
       ('2026-01-01', 1, 0, $1, $3, '2026-01-01T00:00:00Z'),
       ('2026-01-01', 2, 0, $2, $4, '2026-01-02T00:00:00Z')`,
    [flightA, flightB, userA.rows[0]?.id, userB.rows[0]?.id],
  );
  return { general, launch, userA: userA.rows[0]?.id, userB: userB.rows[0]?.id };
}

async function addClaimFlight(userId: string, input: { x: number; timestamp: string }): Promise<string> {
  const fileId = crypto.randomUUID();
  const flightId = crypto.randomUUID();
  await database.pool.query(
    `INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key)
     VALUES ($1::uuid, $2, 'incremental.igc', 'application/octet-stream', 1, $1::uuid::text)`,
    [fileId, userId],
  );
  await database.pool.query(
    `INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status)
     VALUES ($1::uuid, $2, $3, $1::uuid::text, 'completed')`,
    [flightId, userId, fileId],
  );
  await database.pool.query(
    `INSERT INTO competition_grid_claims
       (competition_month, x, y, claim_flight, claim_user, claim_timestamp)
     VALUES ('2026-01-01', $1, 0, $2, $3, $4)`,
    [input.x, flightId, userId, input.timestamp],
  );
  return flightId;
}

describe('Arena leadership reconciliation', () => {
  it('persists the canonical sole leader and excludes Launch Arenas', async () => {
    const seeded = await seed();
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    const result = await service.reconcile({ arenaIds: [seeded.launch, seeded.general] });

    expect(result.arenas).toHaveLength(1);
    expect(result.arenas[0]).toMatchObject({
      arenaId: seeded.general,
      leadingCellCount: 2,
      nextRankCellCount: 1,
      currentLeaderUserIds: [seeded.userA],
      eventCount: 1,
    });
    expect(result.achievements).toEqual({ newlyEarned: ['took_lead_in_arena'], alreadyEarned: 0 });
    const state = await database.pool.query('SELECT * FROM arena_leadership_states');
    expect(state.rows).toHaveLength(1);
    const leaders = await database.pool.query('SELECT * FROM arena_current_leaders');
    expect(leaders.rows).toHaveLength(1);
    const events = await database.pool.query('SELECT event_type FROM arena_leadership_events ORDER BY claim_timestamp');
    expect(events.rows).toEqual([{ event_type: 'took' }]);
    const awards = await database.pool.query<{ achievement_key: string; source_flight_id: string; earned_at: Date; details: { arenaName?: string } }>(
      'SELECT achievement_key, source_flight_id, earned_at, details FROM achievements WHERE user_id = $1',
      [seeded.userA],
    );
    expect(awards.rows).toEqual([
      expect.objectContaining({
        achievement_key: 'took_lead_in_arena',
        source_flight_id: expect.any(String),
        earned_at: new Date('2026-01-01T00:00:00.000Z'),
        details: expect.objectContaining({ arenaName: 'General' }),
      }),
    ]);
  });

  it('replaces the same snapshot idempotently on a second replay', async () => {
    const seeded = await seed();
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    const first = await service.reconcile({ arenaIds: [seeded.general] });
    const second = await service.reconcile({ arenaIds: [seeded.general] });
    expect(second.arenas).toEqual(first.arenas);
    expect(second.eventsBuilt).toBe(first.eventsBuilt);
    expect(second.achievements).toEqual({ newlyEarned: [], alreadyEarned: 1 });
    const persisted = await database.db.execute(sql`SELECT event_key FROM arena_leadership_events`);
    expect(persisted.rows).toHaveLength(1);
  });

  it('appends chronological flight claims without rebuilding existing history', async () => {
    const seeded = await seed();
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    await service.reconcile({ arenaIds: [seeded.general] });
    const initialEvents = await database.pool.query<{ event_key: string }>(
      'SELECT event_key FROM arena_leadership_events WHERE arena_id = $1',
      [seeded.general],
    );
    await database.pool.query(
      `INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited)
       VALUES ($1, $3, 2, FALSE), ($2, $3, 2, FALSE)`,
      [seeded.userA, seeded.userB, seeded.general],
    );
    await database.pool.query(
      `INSERT INTO user_achievement_progress (user_id, projection_version)
       VALUES ($1, 2), ($2, 2)`,
      [seeded.userA, seeded.userB],
    );

    const tyingFlight = await addClaimFlight(seeded.userB!, { x: 0, timestamp: '2026-01-03T00:00:00Z' });
    const tied = await database.db.transaction((transaction) => service.applyFlightInTransaction!(transaction, {
      arenaIds: [seeded.general], flightId: tyingFlight,
    }));
    expect(tied.arenas[0]).toMatchObject({
      leadingCellCount: 2,
      nextRankCellCount: 0,
      currentLeaderUserIds: [seeded.userA, seeded.userB].sort(),
      eventCount: 1,
    });
    expect(tied.achievements).toEqual({ newlyEarned: ['took_lead_in_arena'], alreadyEarned: 0 });

    await database.pool.query(
      `UPDATE user_arena_progress SET claimed_cell_count = 3 WHERE user_id = $1 AND arena_id = $2`,
      [seeded.userB, seeded.general],
    );
    const takingFlight = await addClaimFlight(seeded.userB!, { x: 1, timestamp: '2026-01-04T00:00:00Z' });
    const took = await database.db.transaction((transaction) => service.applyFlightInTransaction!(transaction, {
      arenaIds: [seeded.general], flightId: takingFlight,
    }));
    expect(took.arenas[0]).toMatchObject({
      leadingCellCount: 3,
      nextRankCellCount: 2,
      currentLeaderUserIds: [seeded.userB],
      eventCount: 1,
    });
    const events = await database.pool.query<{ event_key: string; event_type: string }>(
      'SELECT event_key, event_type FROM arena_leadership_events WHERE arena_id = $1 ORDER BY claim_timestamp, event_type',
      [seeded.general],
    );
    expect(events.rows.map(({ event_type }) => event_type)).toEqual(['took', 'took', 'lost']);
    expect(events.rows.some(({ event_key }) => event_key === initialEvents.rows[0]?.event_key)).toBe(true);
  });

  it('uses projected post-flight totals and projected next rank', async () => {
    const seeded = await seed();
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    await service.reconcile({ arenaIds: [seeded.general] });

    // The projection is maintained before leadership evaluation. Deliberately
    // give pilot B two pre-flight cells so the read is distinguishable from a
    // historical competition-claims rescan (which sees only one here).
    await database.pool.query(
      `INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited)
       VALUES ($1, $3, 2, FALSE), ($2, $3, 3, FALSE)`,
      [seeded.userA, seeded.userB, seeded.general],
    );
    await database.pool.query(
      `INSERT INTO user_achievement_progress (user_id, projection_version)
       VALUES ($1, 2), ($2, 2)`,
      [seeded.userA, seeded.userB],
    );
    const flight = await addClaimFlight(seeded.userB!, { x: 0, timestamp: '2026-01-03T00:00:00Z' });
    const result = await database.db.transaction((transaction) => service.applyFlightInTransaction!(transaction, {
      arenaIds: [seeded.general], flightId: flight,
    }));

    expect(result.arenas[0]).toMatchObject({
      leadingCellCount: 3,
      nextRankCellCount: 2,
      currentLeaderUserIds: [seeded.userB],
    });
  });

  it('excludes zero, equal, above-maximum, and incomplete v1 progress from next rank', async () => {
    const seeded = await seed();
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    await service.reconcile({ arenaIds: [seeded.general] });

    await database.pool.query(
      `INSERT INTO users (email) VALUES
       ('arena-eligible-below@example.com'), ('arena-above@example.com'), ('arena-incomplete@example.com')`,
    );
    const extraUsers = await database.pool.query<{ id: string; email: string }>(
      `SELECT user_id AS id, email FROM users
       WHERE email IN ('arena-eligible-below@example.com', 'arena-above@example.com', 'arena-incomplete@example.com')
       ORDER BY email`,
    );
    const eligibleBelowUser = extraUsers.rows.find((row) => row.email === 'arena-eligible-below@example.com')!.id;
    const aboveUser = extraUsers.rows.find((row) => row.email === 'arena-above@example.com')!.id;
    const incompleteUser = extraUsers.rows.find((row) => row.email === 'arena-incomplete@example.com')!.id;
    await database.pool.query(
      `INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited)
       VALUES ($1, $3, 0, FALSE), ($2, $3, 3, FALSE), ($4, $3, 1, FALSE), ($5, $3, 4, FALSE), ($6, $3, 2, FALSE)`,
      [seeded.userA, seeded.userB, seeded.general, eligibleBelowUser, aboveUser, incompleteUser],
    );
    await database.pool.query(
      `INSERT INTO user_achievement_progress (user_id, projection_version)
       VALUES ($1, 2), ($2, 2), ($3, 2), ($4, 2), ($5, 1)`,
      [seeded.userA, seeded.userB, eligibleBelowUser, aboveUser, incompleteUser],
    );

    const flight = await addClaimFlight(seeded.userB!, { x: 0, timestamp: '2026-01-03T00:00:00Z' });
    const result = await database.db.transaction((transaction) => service.applyFlightInTransaction!(transaction, {
      arenaIds: [seeded.general], flightId: flight,
    }));

    expect(result.arenas[0]).toMatchObject({ leadingCellCount: 3, nextRankCellCount: 1 });
  });

  it('uses the partial progress index for the next-rank scan', async () => {
    const seeded = await seed();
    await database.pool.query(
      `INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count)
       VALUES ($1, $2, 2)`,
      [seeded.userA, seeded.general],
    );
    const client = await database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query<{ 'QUERY PLAN': unknown[] }>(
        `EXPLAIN (FORMAT JSON)
         SELECT COALESCE(MAX(claimed_cell_count), 0)::integer AS count
         FROM user_arena_progress progress
         WHERE arena_id = $1
           AND claimed_cell_count > 0
           AND claimed_cell_count < $2
           AND EXISTS (
             SELECT 1 FROM user_achievement_progress summary
             WHERE summary.user_id = progress.user_id AND summary.projection_version = 2
           )`,
        [seeded.general, 3],
      );
      expect(JSON.stringify(explain.rows[0]?.['QUERY PLAN'])).toContain('user_arena_progress_arena_id_claimed_cell_count_idx');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('falls back to full reconciliation when an affected projection is missing or undersized', async () => {
    const seeded = await seed();
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    await service.reconcile({ arenaIds: [seeded.general] });

    // A plausible detailed count is still unsafe when B's summary is legacy v1.
    await database.pool.query(
      `INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited)
       VALUES ($1, $2, 2, FALSE), ($3, $2, 3, FALSE)`,
      [seeded.userA, seeded.general, seeded.userB],
    );
    await database.pool.query(
      `INSERT INTO user_achievement_progress (user_id, projection_version)
       VALUES ($1, 2), ($2, 1)`,
      [seeded.userA, seeded.userB],
    );
    const firstFlight = await addClaimFlight(seeded.userB!, { x: 0, timestamp: '2026-01-03T00:00:00Z' });
    const first = await database.db.transaction((transaction) => service.applyFlightInTransaction!(transaction, {
      arenaIds: [seeded.general], flightId: firstFlight,
    }));
    expect(first.arenas[0]).toMatchObject({ leadingCellCount: 2, currentLeaderUserIds: [seeded.userA, seeded.userB].sort() });

    // Existing but undersized B projection: the next flight must also use the
    // full historical reconciliation and produce B's actual three-cell lead.
    await database.pool.query(
      `INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited)
       VALUES ($1, $2, 0, FALSE)
       ON CONFLICT (user_id, arena_id) DO UPDATE SET claimed_cell_count = EXCLUDED.claimed_cell_count`,
      [seeded.userB, seeded.general],
    );
    const secondFlight = await addClaimFlight(seeded.userB!, { x: 1, timestamp: '2026-01-04T00:00:00Z' });
    const second = await database.db.transaction((transaction) => service.applyFlightInTransaction!(transaction, {
      arenaIds: [seeded.general], flightId: secondFlight,
    }));
    expect(second.arenas[0]).toMatchObject({
      leadingCellCount: 3,
      nextRankCellCount: 2,
      currentLeaderUserIds: [seeded.userB],
    });
  });

  it('applies exclusive State/Country ownership while preserving cross-type and General overlap', async () => {
    const seeded = await seed();
    const stateLow = crypto.randomUUID();
    const stateHigh = crypto.randomUUID();
    const countryLow = crypto.randomUUID();
    const countryHigh = crypto.randomUUID();
    const shape = 'MULTIPOLYGON (((0 0, 3000 0, 3000 3000, 0 3000, 0 0)))';
    await database.pool.query(`
      INSERT INTO arenas (id, source_id, name, country, country_code, area, arena_type, external_id)
      VALUES
        ($1, 11, 'State Low', 'United States', 'US', ST_GeomFromText($5, 6933), 'state', 'A-state'),
        ($2, 12, 'State High', 'United States', 'US', ST_GeomFromText($5, 6933), 'state', 'B-state'),
        ($3, 13, 'Country Low', 'United States', 'US', ST_GeomFromText($5, 6933), 'country', 'A-country'),
        ($4, 14, 'Country High', 'United States', 'US', ST_GeomFromText($5, 6933), 'country', 'B-country')`,
      [stateLow, stateHigh, countryLow, countryHigh, shape],
    );
    const service = createArenaLeadershipReconciliationService(database.db, { cellSize });
    const result = await service.reconcile({ arenaIds: [stateLow, stateHigh, countryLow, countryHigh, seeded.general] });
    const summaries = new Map(result.arenas.map((arena) => [arena.arenaId, arena]));
    expect(summaries.get(stateLow)?.leadingCellCount).toBe(2);
    expect(summaries.get(countryLow)?.leadingCellCount).toBe(2);
    expect(summaries.get(stateHigh)?.leadingCellCount).toBe(0);
    expect(summaries.get(countryHigh)?.leadingCellCount).toBe(0);
    expect(summaries.get(seeded.general)?.leadingCellCount).toBe(2);
  });
});
