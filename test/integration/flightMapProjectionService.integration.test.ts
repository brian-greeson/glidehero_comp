import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flights, igcFiles, users } from '../../src/db/schema.js';
import { buildFlightMapProjection } from '../../src/domain/flightMap/flightMapGeometry.js';
import { storeFlightMapProjection } from '../../src/services/flightMapProjectionService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function insertFlight() {
  const [user] = await database.db.insert(users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const [igc] = await database.db.insert(igcFiles).values({
    userId: user!.id,
    originalFilename: 'flight.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flight-map/${crypto.randomUUID()}`,
  }).returning();
  const [flight] = await database.db.insert(flights).values({
    userId: user!.id,
    igcFileId: igc!.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
  }).returning();
  return flight!.id;
}

describe('flight map projection persistence', () => {
  it('stores indexed full geometry, exact wrapped bounds, and rebuildable LODs', async () => {
    const flightId = await insertFlight();
    const projection = buildFlightMapProjection([
      { sequenceNumber: 0, longitude: 179, latitude: 10 },
      { sequenceNumber: 1, longitude: -179, latitude: 12 },
      { sequenceNumber: 2, longitude: -178, latitude: 11 },
    ], new Set([1]));

    await database.db.transaction((tx) => storeFlightMapProjection(tx, flightId, projection));
    const feature = await database.pool.query<{
      west: number; east: number; crosses: boolean; geometryType: string; parts: number; sourcePointCount: number;
    }>(`
      SELECT west, east, crosses_antimeridian AS crosses,
        ST_GeometryType(full_track) AS "geometryType", ST_NumGeometries(full_track)::integer AS parts,
        source_point_count AS "sourcePointCount"
      FROM flight_map_features WHERE flight_id = $1
    `, [flightId]);
    expect(feature.rows[0]).toMatchObject({
      west: 179, east: -178, crosses: true, geometryType: 'ST_MultiLineString', parts: 2, sourcePointCount: 3,
    });

    const intersections = await database.pool.query<{ east: boolean; west: boolean; middle: boolean }>(`
      SELECT ST_Intersects(full_track, ST_MakeEnvelope(178, 9, 180, 13, 4326)) AS east,
        ST_Intersects(full_track, ST_MakeEnvelope(-180, 9, -177, 13, 4326)) AS west,
        ST_Intersects(full_track, ST_MakeEnvelope(-10, 9, 10, 13, 4326)) AS middle
      FROM flight_map_features WHERE flight_id = $1
    `, [flightId]);
    expect(intersections.rows[0]).toEqual({ east: true, west: true, middle: false });

    const lods = await database.pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM flight_map_geometry_lods WHERE flight_id = $1',
      [flightId],
    );
    expect(lods.rows[0]?.count).toBe(projection.lods.length);
  });

  it('atomically replaces the current projection and its LOD rows', async () => {
    const flightId = await insertFlight();
    const first = buildFlightMapProjection([
      { sequenceNumber: 0, longitude: -105, latitude: 40 },
      { sequenceNumber: 1, longitude: -104, latitude: 41 },
    ]);
    const second = buildFlightMapProjection([
      { sequenceNumber: 0, longitude: -100, latitude: 35 },
      { sequenceNumber: 1, longitude: -99, latitude: 36 },
      { sequenceNumber: 2, longitude: -98, latitude: 37 },
    ]);
    await database.db.transaction((tx) => storeFlightMapProjection(tx, flightId, first));
    await database.db.transaction((tx) => storeFlightMapProjection(tx, flightId, second));
    const row = await database.pool.query<{ sourcePointCount: number; west: number; lodCount: number }>(`
      SELECT feature.source_point_count AS "sourcePointCount", feature.west,
        COUNT(lod.*)::integer AS "lodCount"
      FROM flight_map_features feature
      JOIN flight_map_geometry_lods lod ON lod.flight_id = feature.flight_id
      WHERE feature.flight_id = $1 GROUP BY feature.flight_id
    `, [flightId]);
    expect(row.rows[0]).toEqual({ sourcePointCount: 3, west: -100, lodCount: second.lods.length });
  });
});
