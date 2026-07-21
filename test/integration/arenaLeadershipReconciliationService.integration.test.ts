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
       (competition_month, cell_size, x, y, claim_flight, claim_user, claim_timestamp)
     VALUES
       ('2026-01-01', $3, 0, 0, $1, $4, '2026-01-01T00:00:00Z'),
       ('2026-01-01', $3, 1, 0, $1, $4, '2026-01-01T00:00:00Z'),
       ('2026-01-01', $3, 2, 0, $2, $5, '2026-01-02T00:00:00Z')`,
    [flightA, flightB, cellSize, userA.rows[0]?.id, userB.rows[0]?.id],
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
       (competition_month, cell_size, x, y, claim_flight, claim_user, claim_timestamp)
     VALUES ('2026-01-01', $1, $2, 0, $3, $4, $5)`,
    [cellSize, input.x, flightId, userId, input.timestamp],
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
});
