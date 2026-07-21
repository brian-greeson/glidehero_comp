import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAndMigrateTestDatabase } from './database.js';
import { ArenaLeadershipBackfillError, runArenaLeadershipBackfill } from '../../src/scripts/backfillArenaLeadership.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;
const cellSize = 1_000;
const arenaOne = '00000000-0000-4000-8000-000000000001';
const arenaTwo = '00000000-0000-4000-8000-000000000002';
const launch = '00000000-0000-4000-8000-000000000003';

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE arenas, users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function toWgs84(coordinates: ReadonlyArray<readonly [number, number]>) {
  const values = coordinates.map((_, index) => `($${index * 2 + 1}::double precision, $${index * 2 + 2}::double precision)`).join(', ');
  return (await database.pool.query<{ longitude: number; latitude: number }>(
    `SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS longitude,
            ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS latitude
     FROM (VALUES ${values}) AS input(x, y)`,
    coordinates.flat(),
  )).rows;
}

async function seed() {
  const user = (await database.pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('backfill@example.com') RETURNING user_id AS id`)).rows[0]!.id;
  const rival = (await database.pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('rival@example.com') RETURNING user_id AS id`)).rows[0]!.id;
  const flightIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const file = crypto.randomUUID();
    const flight = crypto.randomUUID();
    flightIds.push(flight);
    await database.pool.query(`INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key) VALUES ($1::uuid, $2::uuid, 'x.igc', 'application/octet-stream', 1, $1::text)`, [file, user]);
    await database.pool.query(`INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status) VALUES ($1::uuid, $2::uuid, $3::uuid, $1::text, 'completed')`, [flight, user, file]);
  }
  const rivalFlightIds: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const file = crypto.randomUUID();
    const flight = crypto.randomUUID();
    rivalFlightIds.push(flight);
    await database.pool.query(`INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key) VALUES ($1::uuid, $2::uuid, 'rival.igc', 'application/octet-stream', 1, $1::text)`, [file, rival]);
    await database.pool.query(`INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status) VALUES ($1::uuid, $2::uuid, $3::uuid, $1::text, 'completed')`, [flight, rival, file]);
  }
  const shapeOne = 'MULTIPOLYGON (((0 0, 1000 0, 1000 5000, 0 5000, 0 0)))';
  const shapeTwo = 'MULTIPOLYGON (((1000 0, 3000 0, 3000 3000, 1000 3000, 1000 0)))';
  await database.pool.query(`INSERT INTO arenas (id, source_id, name, country, country_code, area, arena_type) VALUES ($1, 1, 'Later batch', 'United States', 'US', ST_GeomFromText($4, 6933), 'general'), ($2, 2, 'Earlier batch', 'United States', 'US', ST_GeomFromText($5, 6933), 'general'), ($3, 3, 'Launch only', 'United States', 'US', ST_GeomFromText($4, 6933), 'launch')`, [arenaOne, arenaTwo, launch, shapeOne, shapeTwo]);
  await database.pool.query(`INSERT INTO competition_grid_claims (competition_month, cell_size, x, y, claim_flight, claim_user, claim_timestamp) VALUES
    ('2026-01-01', $3, 0, 0, $1, $6, '2026-01-03T00:00:00Z'),
    ('2026-01-01', $3, 1, 0, $2, $6, '2026-01-01T00:00:00Z'),
    ('2026-01-01', $3, 0, 1, $4, $7, '2026-01-04T00:00:00Z'),
    ('2026-01-01', $3, 0, 2, $5, $7, '2026-01-05T00:00:00Z'),
    ('2026-01-01', $3, 0, 3, $8, $6, '2026-01-07T00:00:00Z'),
    ('2026-01-01', $3, 0, 4, $8, $6, '2026-01-07T00:00:00Z')`, [flightIds[0], flightIds[1], cellSize, rivalFlightIds[0], rivalFlightIds[1], user, rival, flightIds[2]]);
  return { user, rival, flightIds, rivalFlightIds };
}

describe('Arena leadership backfill', () => {
  it('corrects existing Competition timestamps from the first claim event before replay', async () => {
    const user = (await database.pool.query<{ id: string }>(`INSERT INTO users (email) VALUES ('timestamp-backfill@example.com') RETURNING user_id AS id`)).rows[0]!.id;
    const file = crypto.randomUUID();
    const flight = crypto.randomUUID();
    await database.pool.query(`INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key) VALUES ($1::uuid, $2::uuid, 'timestamp.igc', 'application/octet-stream', 1, $1::text)`, [file, user]);
    await database.pool.query(`INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status, launch_timezone) VALUES ($1::uuid, $2::uuid, $3::uuid, $1::text, 'completed', 'UTC')`, [flight, user, file]);
    const recordedAt = new Date('2026-01-01T00:00:00Z');
    const points = await toWgs84([[100, 100], [900, 100], [100, 100]]);
    for (const [sequenceNumber, point] of points.entries()) {
      await database.pool.query(
        `INSERT INTO track_points (flight_id, sequence_number, recorded_at, latitude, longitude, gps_altitude_meters, pressure_altitude_meters)
         VALUES ($1, $2, $3, $4, $5, 1000, 1000)`,
        [flight, sequenceNumber, new Date(recordedAt.getTime() + sequenceNumber * 1_000), point.latitude, point.longitude],
      );
    }
    await database.pool.query(
      `INSERT INTO competition_grid_claims (competition_month, cell_size, x, y, claim_flight, claim_user, claim_timestamp)
       VALUES ('2026-01-01', $1, 0, 0, $2, $3, $4)`,
      [cellSize, flight, user, new Date(recordedAt.getTime() + 2_000)],
    );
    await database.pool.query(
      `INSERT INTO arenas (source_id, name, country, country_code, area, arena_type)
       VALUES (9, 'Timestamp', 'United States', 'US', ST_GeomFromText('MULTIPOLYGON (((0 0, 1000 0, 1000 1000, 0 1000, 0 0)))', 6933), 'general')`,
    );

    const dryRun = await runArenaLeadershipBackfill(database.db, { apply: false, cellSize, batchSize: 1 });
    expect(dryRun).toMatchObject({ claimTimestampFlightsInspected: 1, claimTimestampsChanged: 1 });
    expect((await database.pool.query<{ claim_timestamp: Date }>('SELECT claim_timestamp FROM competition_grid_claims')).rows[0]?.claim_timestamp)
      .toEqual(new Date(recordedAt.getTime() + 2_000));

    const applied = await runArenaLeadershipBackfill(database.db, { apply: true, cellSize, batchSize: 1 });
    expect(applied).toMatchObject({ claimTimestampFlightsInspected: 1, claimTimestampsChanged: 1 });
    expect((await database.pool.query<{ claim_timestamp: Date }>('SELECT claim_timestamp FROM competition_grid_claims')).rows[0]?.claim_timestamp)
      .toEqual(new Date(recordedAt.getTime() + 1_000));
  });

  it('rolls back dry-run denominator, projection, history, and awards', async () => {
    await seed();
    const summary = await runArenaLeadershipBackfill(database.db, { apply: false, cellSize, batchSize: 1 });
    expect(summary.dryRun).toBe(true);
    expect(summary.arenasInspected).toBe(2);
    expect(summary.arenasReconciled).toBe(2);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM arena_leadership_states')).rows[0].count).toBe(0);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM achievements')).rows[0].count).toBe(0);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM arenas WHERE claimable_cell_count IS NOT NULL')).rows[0].count).toBe(0);
  });

  it('applies canonical history, chooses the earliest cross-batch award, excludes Launch, and reruns idempotently', async () => {
    const seeded = await seed();
    const first = await runArenaLeadershipBackfill(database.db, { apply: true, cellSize, batchSize: 1 });
    expect(first.currentSoleLeaders).toBe(2);
    expect(first.tookAwards).toBe(2);
    const award = await database.pool.query<{ details: { arenaId: string }; source_flight_id: string }>("SELECT details, source_flight_id FROM achievements WHERE user_id = $1 AND achievement_key = 'took_lead_in_arena'", [seeded.user]);
    expect(award.rows[0]?.details.arenaId).toBe(arenaTwo);
    expect(award.rows[0]?.source_flight_id).toBe(seeded.flightIds[1]);
    const leadershipEvents = await database.pool.query<{ event_type: string; claim_timestamp: Date; source_flight_id: string }>('SELECT event_type, claim_timestamp, source_flight_id FROM arena_leadership_events WHERE arena_id = $1 ORDER BY claim_timestamp, event_type', [arenaOne]);
    expect(leadershipEvents.rows.map((event) => [event.event_type, event.claim_timestamp.toISOString(), event.source_flight_id])).toEqual([
      ['took', '2026-01-03T00:00:00.000Z', seeded.flightIds[0]],
      ['took', '2026-01-04T00:00:00.000Z', seeded.rivalFlightIds[0]],
      ['lost', '2026-01-05T00:00:00.000Z', seeded.rivalFlightIds[1]],
      ['reclaimed', '2026-01-07T00:00:00.000Z', seeded.flightIds[2]],
      ['lost', '2026-01-07T00:00:00.000Z', seeded.flightIds[2]],
    ]);
    const reclaimedAward = await database.pool.query<{ details: { arenaId: string }; source_flight_id: string; earned_at: Date }>("SELECT details, source_flight_id, earned_at FROM achievements WHERE user_id = $1 AND achievement_key = 'reclaimed_lead_in_arena'", [seeded.user]);
    expect(reclaimedAward.rows).toEqual([expect.objectContaining({ details: expect.objectContaining({ arenaId: arenaOne }), source_flight_id: seeded.flightIds[2], earned_at: new Date('2026-01-07T00:00:00.000Z') })]);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM arena_leadership_states')).rows[0].count).toBe(2);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM arena_leadership_events')).rows[0].count).toBe(6);
    const second = await runArenaLeadershipBackfill(database.db, { apply: true, cellSize, batchSize: 1 });
    expect(second.tookAwards).toBe(0);
    expect(second.reclaimedAwards).toBe(0);
    expect(second.alreadyEarnedOrUnchanged).toBe(3);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM achievements')).rows[0].count).toBe(3);
    expect((await database.pool.query("SELECT count(*)::int AS count FROM arena_leadership_states WHERE arena_type = 'launch'")).rows[0].count).toBe(0);
  });

  it('reports that prior apply batches may remain after a later failure', async () => {
    await seed();
    await database.pool.query(`INSERT INTO arenas (id, source_id, name, country, country_code, area, arena_type) VALUES ($1, 4, 'Empty', 'United States', 'US', ST_GeomFromText('MULTIPOLYGON EMPTY', 6933), 'general')`, ['00000000-0000-4000-8000-000000000004']);
    await expect(runArenaLeadershipBackfill(database.db, { apply: true, cellSize, batchSize: 1 })).rejects.toMatchObject({
      summary: expect.objectContaining({ failures: 1, committedBatchesMayRemain: true }),
    } satisfies Partial<ArenaLeadershipBackfillError>);
    expect((await database.pool.query('SELECT count(*)::int AS count FROM arena_leadership_states')).rows[0].count).toBeGreaterThan(0);
  });

  it('counts pilots in a current joint leadership', async () => {
    const seeded = await seed();
    const jointArena = '00000000-0000-4000-8000-000000000005';
    const shape = 'MULTIPOLYGON (((5000 0, 6000 0, 6000 1000, 5000 1000, 5000 0)))';
    await database.pool.query(`INSERT INTO arenas (id, source_id, name, country, country_code, area, arena_type) VALUES ($1, 5, 'Joint', 'United States', 'US', ST_GeomFromText($2, 6933), 'general')`, [jointArena, shape]);
    await database.pool.query(`INSERT INTO competition_grid_claims (competition_month, cell_size, x, y, claim_flight, claim_user, claim_timestamp) VALUES ('2026-01-01', $3, 5, 0, $1, $4, '2026-02-01T00:00:00Z'), ('2026-01-01', $3, 5, 0, $2, $5, '2026-02-01T00:00:00Z')`, [seeded.flightIds[0], seeded.rivalFlightIds[0], cellSize, seeded.user, seeded.rival]);
    const summary = await runArenaLeadershipBackfill(database.db, { apply: false, cellSize, batchSize: 10 });
    expect(summary.currentJointLeaders).toBe(2);
  });
});
