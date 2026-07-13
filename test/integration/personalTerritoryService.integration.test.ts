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

describe('PersonalTerritoryService with PostGIS', () => {
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
