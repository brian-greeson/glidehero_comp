import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flights, igcFiles, users } from '../../src/db/schema.js';
import { createPersonalTerritoryService } from '../../src/services/personalTerritoryService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;
let firstPilotId: string;
let secondPilotId: string;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
  const pilots = await database.db
    .insert(users)
    .values([
      { email: `pilot-${crypto.randomUUID()}@example.com` },
      { email: `pilot-${crypto.randomUUID()}@example.com` },
    ])
    .returning({ id: users.id });
  const [firstPilot, secondPilot] = pilots;
  if (!firstPilot || !secondPilot) throw new Error('Pilot inserts returned fewer than two rows.');
  firstPilotId = firstPilot.id;
  secondPilotId = secondPilot.id;
});

afterAll(async () => {
  await database.pool.end();
});

async function addClaim(userId: string, wkt: string): Promise<void> {
  const [igcFile] = await database.db.insert(igcFiles).values({
    userId,
    originalFilename: `${crypto.randomUUID()}.igc`,
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flights/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db.insert(flights).values({
    userId,
    igcFileId: igcFile.id,
    processingStatus: 'completed',
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  await database.pool.query(
    `INSERT INTO flight_areas (flight_id, geometry, area_square_meters)
     VALUES ($1, ST_GeomFromText($2, 4326), ST_Area(ST_GeomFromText($2, 4326)::geography))`,
    [flight.id, wkt],
  );
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMilliseconds = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

describe('PersonalTerritoryService with PostGIS', () => {
  it('does not let an older same-pilot refresh overwrite a newer aggregate', async () => {
    const gateLockId = 812_345_678;
    const gateClient = await database.pool.connect();

    try {
      await database.pool.query(`
        CREATE FUNCTION test_delay_single_polygon_refresh() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF ST_NumGeometries(
            ST_GeomFromGeoJSON((NEW.geojson->'features'->0->'geometry')::text)
          ) = 1 THEN
            PERFORM pg_advisory_xact_lock(${gateLockId});
          END IF;
          RETURN NEW;
        END
        $$;
        CREATE TRIGGER test_delay_single_polygon_refresh
          BEFORE INSERT OR UPDATE ON personal_territories
          FOR EACH ROW EXECUTE FUNCTION test_delay_single_polygon_refresh();
      `);
      await gateClient.query('SELECT pg_advisory_lock($1)', [gateLockId]);

      await addClaim(firstPilotId, 'POLYGON((-105 40,-104.99 40,-104.99 40.01,-105 40.01,-105 40))');
      const service = createPersonalTerritoryService(database.db);
      const olderRefresh = service.refresh({ userId: firstPilotId });

      await waitUntil(async () => {
        const result = await database.pool.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event = 'advisory'`,
        );
        return (result.rows[0]?.count ?? 0) >= 1;
      }, 'The older refresh did not reach the controlled persistence gate.');

      await addClaim(firstPilotId, 'POLYGON((-104.97 40,-104.96 40,-104.96 40.01,-104.97 40.01,-104.97 40))');
      const newerRefresh = service.refresh({ userId: firstPilotId });

      await waitUntil(async () => {
        const state = await database.pool.query<{ advisory_waiters: number; polygon_count: number | null }>(
          `SELECT
             (SELECT count(*)::int
                FROM pg_stat_activity
               WHERE datname = current_database() AND wait_event = 'advisory') AS advisory_waiters,
             (SELECT ST_NumGeometries(
                       ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text)
                     )::int
                FROM personal_territories
               WHERE user_id = $1) AS polygon_count`,
          [firstPilotId],
        );
        const row = state.rows[0];
        return row?.polygon_count === 2 || (row?.advisory_waiters ?? 0) >= 2;
      }, 'The newer refresh neither persisted nor waited behind the older refresh.');

      await gateClient.query('SELECT pg_advisory_unlock($1)', [gateLockId]);
      await Promise.all([olderRefresh, newerRefresh]);

      const stored = await database.pool.query<{ polygon_count: number }>(
        `SELECT ST_NumGeometries(
                  ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text)
                )::int AS polygon_count
           FROM personal_territories
          WHERE user_id = $1`,
        [firstPilotId],
      );
      expect(stored.rows).toEqual([{ polygon_count: 2 }]);
    } finally {
      await gateClient.query('SELECT pg_advisory_unlock($1)', [gateLockId]);
      gateClient.release();
      await database.pool.query('DROP TRIGGER IF EXISTS test_delay_single_polygon_refresh ON personal_territories');
      await database.pool.query('DROP FUNCTION IF EXISTS test_delay_single_polygon_refresh()');
    }
  });

  it('unions overlapping claims, keeps disjoint claims, and stores one JSONB row', async () => {
    await addClaim(firstPilotId, 'POLYGON((-105 40,-104.99 40,-104.99 40.01,-105 40.01,-105 40))');
    await addClaim(firstPilotId, 'POLYGON((-104.995 40,-104.985 40,-104.985 40.01,-104.995 40.01,-104.995 40))');
    await addClaim(firstPilotId, 'POLYGON((-104.97 40,-104.96 40,-104.96 40.01,-104.97 40.01,-104.97 40))');

    const service = createPersonalTerritoryService(database.db);
    const geojson = await service.refresh({ userId: firstPilotId });
    const stored = await database.pool.query<{ projection_count: number; polygon_count: number }>(
      `SELECT count(*)::int AS projection_count,
              ST_NumGeometries(ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text))::int AS polygon_count
       FROM personal_territories
       WHERE user_id = $1
       GROUP BY user_id, geojson`,
      [firstPilotId],
    );

    expect(geojson.features[0]?.geometry.type).toBe('MultiPolygon');
    expect(stored.rows).toEqual([{ projection_count: 1, polygon_count: 2 }]);
  });

  it('keeps another pilot out of the aggregate and clears a stale projection when claims are removed', async () => {
    await addClaim(firstPilotId, 'POLYGON((-105 40,-104.99 40,-104.99 40.01,-105 40.01,-105 40))');
    await addClaim(secondPilotId, 'POLYGON((-90 35,-89.99 35,-89.99 35.01,-90 35.01,-90 35))');
    const service = createPersonalTerritoryService(database.db);

    await service.refresh({ userId: firstPilotId });
    await service.refresh({ userId: secondPilotId });
    await database.pool.query(
      'DELETE FROM flight_areas WHERE flight_id IN (SELECT flight_id FROM flights WHERE user_id = $1)',
      [firstPilotId],
    );

    await expect(service.refresh({ userId: firstPilotId })).resolves.toEqual({
      type: 'FeatureCollection',
      features: [],
    });
    await expect(service.get({ userId: secondPilotId })).resolves.toMatchObject({
      features: [expect.objectContaining({ geometry: expect.objectContaining({ type: 'MultiPolygon' }) })],
    });

    const stale = await database.pool.query('SELECT 1 FROM personal_territories WHERE user_id = $1', [firstPilotId]);
    expect(stale.rows).toEqual([]);
  });

  it('merges an enclosed claim into its containing polygon without an interior hole', async () => {
    await addClaim(firstPilotId, 'POLYGON((-105 40,-104.98 40,-104.98 40.02,-105 40.02,-105 40))');
    await addClaim(firstPilotId, 'POLYGON((-104.995 40.005,-104.985 40.005,-104.985 40.015,-104.995 40.015,-104.995 40.005))');
    const service = createPersonalTerritoryService(database.db);

    await service.refresh({ userId: firstPilotId });
    const stored = await database.pool.query<{ interior_ring_count: number }>(
      `SELECT ST_NumInteriorRings(
                ST_GeometryN(ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text), 1)
              )::int AS interior_ring_count
       FROM personal_territories
       WHERE user_id = $1`,
      [firstPilotId],
    );

    expect(stored.rows).toEqual([{ interior_ring_count: 0 }]);
  });
});
