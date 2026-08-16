import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launches } from '../../src/db/schema.js';
import type { LaunchImportRow } from '../../src/domain/launch/mysqlLaunchDump.js';
import { matchNearestCatalogLaunch } from '../../src/services/flightLaunchMatchService.js';
import { runFlightLaunchBackfill } from '../../src/scripts/backfillFlightLaunchMatches.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

function launch(id: number, latitude: number, longitude: number): LaunchImportRow {
  return {
    id, name: `Launch ${id}`, longitude, latitude, country: 'Test Country', state: '', city: '',
    description: '', xcByMonth: '', timezoneOffset: 0, xcByYear: '', rank: 0, elevation: 0,
    rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0, rank7: 0, rank8: 0,
    rank9: 0, rank10: 0, rank11: 0, rank12: 0, xcontestLaunchSite: 0,
  };
}

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database?.pool.query('TRUNCATE TABLE launches CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

describe('flight launch matching with PostGIS', () => {
  it('chooses the nearest qualifying launch and breaks an exact tie by catalog ID', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    await database.db.insert(launches).values([
      launch(20, 0, 0.005),
      launch(10, 0, 0.005),
      launch(30, 0, 0.006),
    ]);
    await expect(matchNearestCatalogLaunch(database.db, { latitude: 0, longitude: 0 }))
      .resolves.toMatchObject({ launchId: 10 });
  });

  it('includes a launch exactly 1,000 meters away and excludes one beyond the radius', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const projected = await database.pool.query<{ longitude: number; latitude: number }>(`
      SELECT ST_X(point)::double precision AS longitude, ST_Y(point)::double precision AS latitude
      FROM (SELECT ST_Project(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 1000, 0)::geometry point) value
    `);
    const point = projected.rows[0];
    if (!point) throw new Error('PostGIS did not project the boundary point.');
    await database.db.insert(launches).values(launch(40, point.latitude, point.longitude));
    await expect(matchNearestCatalogLaunch(database.db, { latitude: 0, longitude: 0 }))
      .resolves.toMatchObject({ launchId: 40, distanceMeters: expect.closeTo(1_000, 5) });

    await database.pool.query('TRUNCATE TABLE launches CASCADE');
    const outside = await database.pool.query<{ longitude: number; latitude: number }>(`
      SELECT ST_X(point)::double precision AS longitude, ST_Y(point)::double precision AS latitude
      FROM (SELECT ST_Project(ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, 1000.01, 0)::geometry point) value
    `);
    const outsidePoint = outside.rows[0];
    if (!outsidePoint) throw new Error('PostGIS did not project the outside point.');
    await database.db.insert(launches).values(launch(41, outsidePoint.latitude, outsidePoint.longitude));
    await expect(matchNearestCatalogLaunch(database.db, { latitude: 0, longitude: 0 }))
      .resolves.toEqual({ launchId: null, distanceMeters: null });
  });

  it('has the functional geography index required by ST_DWithin', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const indexes = await database.pool.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'launches_location_geography_gist_idx'
    `);
    expect(indexes.rows[0]?.indexdef).toContain('USING gist');
    expect(indexes.rows[0]?.indexdef).toContain('geography');
  });

  it('reconciles matched and Unknown flights once with the current projection version', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    await database.db.insert(launches).values(launch(50, 0, 0));
    await database.pool.query(`
      INSERT INTO users (user_id, email) VALUES
        ('00000000-0000-4000-8000-000000000001', 'launch-backfill@example.com');
      INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key) VALUES
        ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'matched.igc', 'application/vnd.fai.igc', 1, 'matched.igc'),
        ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'unknown.igc', 'application/vnd.fai.igc', 1, 'unknown.igc'),
        ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'missing.igc', 'application/vnd.fai.igc', 1, 'missing.igc');
      INSERT INTO flights (
        flight_id, user_id, igc_file_id, content_hash, processing_status, launch_latitude, launch_longitude
      ) VALUES
        ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'matched', 'completed', 0, 0),
        ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', 'unknown', 'completed', 20, 20),
        ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', 'missing', 'completed', NULL, NULL)
    `);

    await expect(runFlightLaunchBackfill(database.db, { apply: true })).resolves.toMatchObject({
      inspected: 3, matched: 1, unknown: 2, written: 3, failed: 0,
    });
    const stored = await database.pool.query<{ id: string; launchId: string | null; version: number }>(`
      SELECT flight_id AS id, launch_id AS "launchId", launch_match_version AS version
      FROM flights ORDER BY flight_id
    `);
    expect(stored.rows).toEqual([
      { id: '00000000-0000-4000-8000-000000000021', launchId: '50', version: 1 },
      { id: '00000000-0000-4000-8000-000000000022', launchId: null, version: 1 },
      { id: '00000000-0000-4000-8000-000000000023', launchId: null, version: 1 },
    ]);
    await expect(runFlightLaunchBackfill(database.db, { apply: true })).resolves.toMatchObject({ inspected: 0 });
  });
});
