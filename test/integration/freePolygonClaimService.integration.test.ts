import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flights, igcFiles, trackPoints, users } from '../../src/db/schema.js';
import { createFreePolygonClaimService } from '../../src/services/freePolygonClaimService.js';
import { resetAndPushTestDatabase } from './database.js';

type Coordinate = readonly [longitude: number, latitude: number];

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
  if (database) await database.pool.end();
});

async function persistFlight(coordinates: readonly Coordinate[]): Promise<{ flightId: string; userId: string }> {
  const [user] = await database.db
    .insert(users)
    .values({ email: `pilot-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');

  const [igcFile] = await database.db
    .insert(igcFiles)
    .values({
      userId: user.id,
      originalFilename: 'flight.igc',
      contentType: 'application/vnd.fai.igc',
      byteSize: 1,
      bucketKey: `flights/${crypto.randomUUID()}.igc`,
    })
    .returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db
    .insert(flights)
    .values({
      userId: user.id,
      igcFileId: igcFile.id,
      contentHash: igcFile.id.replaceAll('-', '').padEnd(64, '0'),
      processingStatus: 'completed',
    })
    .returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  await database.db.insert(trackPoints).values(coordinates.map(([longitude, latitude], sequenceNumber) => ({
    flightId: flight.id,
    sequenceNumber,
    recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequenceNumber)),
    latitude,
    longitude,
    gpsAltitudeMeters: 1_000,
    pressureAltitudeMeters: 1_000,
  })));

  return { flightId: flight.id, userId: user.id };
}

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
    contentHash: igcFile.id.replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  await database.pool.query(
    `INSERT INTO flight_areas (flight_id, geometry, area_square_meters)
     VALUES ($1, ST_GeomFromText($2, 4326), ST_Area(ST_GeomFromText($2, 4326)::geography))`,
    [flight.id, wkt],
  );
}

async function storedClaims(flightId: string) {
  return database.pool.query<{
    area_square_meters: number;
    interior_ring_count: number;
    is_valid: boolean;
    srid: number;
  }>(
    `SELECT area_square_meters,
            ST_NumInteriorRings(geometry)::int AS interior_ring_count,
            ST_IsValid(geometry) AS is_valid,
            ST_SRID(geometry) AS srid
     FROM flight_areas
     WHERE flight_id = $1
     ORDER BY area_square_meters DESC`,
    [flightId],
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

describe('FreePolygonClaimService with PostGIS', () => {
  it('stores no claim for an open track', async () => {
    const { flightId } = await persistFlight([[-105, 40], [-104.99, 40.01], [-104.98, 40]]);

    const result = await createFreePolygonClaimService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 0 });
    expect((await storedClaims(flightId)).rows).toEqual([]);
  });

  it('stores no claim for a zero-distance track with identical fixes', async () => {
    const { flightId } = await persistFlight([[-105, 40], [-105, 40]]);

    const result = await createFreePolygonClaimService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 0 });
    expect((await storedClaims(flightId)).rows).toEqual([]);
  });

  it('merges a nested loop into its containing claim without a hole', async () => {
    const { flightId } = await persistFlight([
      [-105.002, 40.002], [-104.998, 40.002], [-104.998, 40.006], [-105.002, 40.006], [-105.002, 40.002],
      [-105.01, 39.99], [-104.98, 39.99], [-104.98, 40.02], [-105.01, 40.02], [-105.01, 39.99],
    ]);

    const result = await createFreePolygonClaimService(database.db).detect({ flightId });
    const claims = await storedClaims(flightId);

    expect(result).toEqual({ flightId, detectedAreaCount: 1 });
    expect(claims.rows).toEqual([
      expect.objectContaining({ interior_ring_count: 0, is_valid: true, srid: 4326 }),
    ]);
  });

  it('keeps three spatially separate loops as three claims', async () => {
    const { flightId } = await persistFlight([
      [-105.03, 40], [-105.01, 40], [-105.01, 40.02], [-105.03, 40.02], [-105.03, 40],
      [-105, 40],
      [-104.995, 40], [-104.99, 40], [-104.99, 40.005], [-104.995, 40.005], [-104.995, 40],
      [-104.98, 40],
      [-104.975, 40], [-104.97, 40], [-104.97, 40.005], [-104.975, 40.005], [-104.975, 40],
    ]);

    const result = await createFreePolygonClaimService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 3 });
    expect((await storedClaims(flightId)).rows).toHaveLength(3);
  });

  it('keeps figure-eight lobes that meet only at one point as separate claims', async () => {
    const { flightId } = await persistFlight([
      [-105, 40], [-105.01, 40.01], [-105.02, 40], [-105.01, 39.99], [-105, 40],
      [-104.99, 40.01], [-104.98, 40], [-104.99, 39.99], [-105, 40],
    ]);

    const result = await createFreePolygonClaimService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 2 });
    expect((await storedClaims(flightId)).rows).toHaveLength(2);
  });

  it('filters final claims below 100 square meters', async () => {
    const { flightId } = await persistFlight([
      [-105, 40], [-104.99995, 40], [-104.99995, 40.00005], [-105, 40.00005], [-105, 40],
      [-104.999, 40],
      [-104.9988, 40], [-104.9988, 40.0002], [-104.999, 40.0002], [-104.999, 40],
    ]);

    const result = await createFreePolygonClaimService(database.db).detect({ flightId });
    const claims = await storedClaims(flightId);

    expect(result).toEqual({ flightId, detectedAreaCount: 1 });
    expect(claims.rows[0]?.area_square_meters).toBeGreaterThanOrEqual(100);
  });

  it('replaces prior results when the same flight is detected again', async () => {
    const { flightId } = await persistFlight([[-105, 40], [-104.99, 40], [-104.99, 40.01], [-105, 40.01], [-105, 40]]);
    const service = createFreePolygonClaimService(database.db);

    await service.detect({ flightId });
    const rerun = await service.detect({ flightId });

    expect(rerun).toEqual({ flightId, detectedAreaCount: 1 });
    expect((await storedClaims(flightId)).rows).toHaveLength(1);
  });

  it('detects a flight and refreshes its pilot projection', async () => {
    const { flightId, userId } = await persistFlight([[-105, 40], [-104.99, 40], [-104.99, 40.01], [-105, 40.01], [-105, 40]]);
    const service = createFreePolygonClaimService(database.db);

    await expect(service.process({ flightId, userId })).resolves.toEqual({ flightId, detectedAreaCount: 1 });
    await expect(service.get({ userId })).resolves.toMatchObject({
      features: [expect.objectContaining({ geometry: expect.objectContaining({ type: 'MultiPolygon' }) })],
    });
  });

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
      const service = createFreePolygonClaimService(database.db);
      const olderRefresh = service.refresh({ userId: firstPilotId });

      await waitUntil(async () => {
        const result = await database.pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`,
        );
        return (result.rows[0]?.count ?? 0) >= 1;
      }, 'The older refresh did not reach the controlled persistence gate.');

      await addClaim(firstPilotId, 'POLYGON((-104.97 40,-104.96 40,-104.96 40.01,-104.97 40.01,-104.97 40))');
      const newerRefresh = service.refresh({ userId: firstPilotId });

      await waitUntil(async () => {
        const state = await database.pool.query<{ advisory_waiters: number; polygon_count: number | null }>(
          `SELECT
             (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory') AS advisory_waiters,
             (SELECT ST_NumGeometries(ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text))::int FROM personal_territories WHERE user_id = $1) AS polygon_count`,
          [firstPilotId],
        );
        const row = state.rows[0];
        return row?.polygon_count === 2 || (row?.advisory_waiters ?? 0) >= 2;
      }, 'The newer refresh neither persisted nor waited behind the older refresh.');

      await gateClient.query('SELECT pg_advisory_unlock($1)', [gateLockId]);
      await Promise.all([olderRefresh, newerRefresh]);

      const stored = await database.pool.query<{ polygon_count: number }>(
        `SELECT ST_NumGeometries(ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text))::int AS polygon_count
         FROM personal_territories WHERE user_id = $1`,
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

    const service = createFreePolygonClaimService(database.db);
    const geojson = await service.refresh({ userId: firstPilotId });
    const stored = await database.pool.query<{ projection_count: number; polygon_count: number }>(
      `SELECT count(*)::int AS projection_count,
              ST_NumGeometries(ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text))::int AS polygon_count
       FROM personal_territories WHERE user_id = $1 GROUP BY user_id, geojson`,
      [firstPilotId],
    );

    expect(geojson.features[0]?.geometry.type).toBe('MultiPolygon');
    expect(stored.rows).toEqual([{ projection_count: 1, polygon_count: 2 }]);
  });

  it('keeps another pilot out of the aggregate and clears a stale projection when claims are removed', async () => {
    await addClaim(firstPilotId, 'POLYGON((-105 40,-104.99 40,-104.99 40.01,-105 40.01,-105 40))');
    await addClaim(secondPilotId, 'POLYGON((-90 35,-89.99 35,-89.99 35.01,-90 35.01,-90 35))');
    const service = createFreePolygonClaimService(database.db);

    await service.refresh({ userId: firstPilotId });
    await service.refresh({ userId: secondPilotId });
    await database.pool.query('DELETE FROM flight_areas WHERE flight_id IN (SELECT flight_id FROM flights WHERE user_id = $1)', [firstPilotId]);

    await expect(service.refresh({ userId: firstPilotId })).resolves.toEqual({ type: 'FeatureCollection', features: [] });
    await expect(service.get({ userId: secondPilotId })).resolves.toMatchObject({
      features: [expect.objectContaining({ geometry: expect.objectContaining({ type: 'MultiPolygon' }) })],
    });

    const stale = await database.pool.query('SELECT 1 FROM personal_territories WHERE user_id = $1', [firstPilotId]);
    expect(stale.rows).toEqual([]);
  });

  it('merges an enclosed claim into its containing polygon without an interior hole', async () => {
    await addClaim(firstPilotId, 'POLYGON((-105 40,-104.98 40,-104.98 40.02,-105 40.02,-105 40))');
    await addClaim(firstPilotId, 'POLYGON((-104.995 40.005,-104.985 40.005,-104.985 40.015,-104.995 40.015,-104.995 40.005))');
    const service = createFreePolygonClaimService(database.db);

    await service.refresh({ userId: firstPilotId });
    const stored = await database.pool.query<{ interior_ring_count: number }>(
      `SELECT ST_NumInteriorRings(ST_GeometryN(ST_GeomFromGeoJSON((geojson->'features'->0->'geometry')::text), 1))::int AS interior_ring_count
       FROM personal_territories WHERE user_id = $1`,
      [firstPilotId],
    );

    expect(stored.rows).toEqual([{ interior_ring_count: 0 }]);
  });
});
