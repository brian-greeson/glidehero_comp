import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createThermalAreaMapService } from '../../src/services/thermalAreaMapService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database!.pool.query('TRUNCATE TABLE thermal_raster_tiles CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function insertArea(input: {
  x: number;
  status: 'pending' | 'processing' | 'complete' | 'empty' | 'failed';
  tileVersion?: number;
  areaVersion?: number;
  west?: number;
}) {
  const tileVersion = input.tileVersion ?? 1;
  const west = input.west ?? -105;
  const tile = await database!.pool.query<{ id: string }>(`
    INSERT INTO thermal_raster_tiles (
      zoom, tile_x, tms_y, bucket_key, checksum, byte_size,
      processing_status, processing_version, processed_at
    ) VALUES (12, $1, 100, $2, $3, 100, $4, $5, NOW())
    RETURNING id
  `, [input.x, `12/${input.x}/100.png`, `checksum-${input.x}`, input.status, tileVersion]);
  await database!.pool.query(`
    INSERT INTO thermal_areas (
      raster_tile_id, component_index, activity_band, relative_score, geometry,
      area_square_meters, raster_checksum, processing_version
    ) VALUES (
      $1, 0, 'yellow_orange', 0.75,
      ST_Multi(ST_MakeEnvelope($2::double precision, 39, $2::double precision + 0.05, 39.05, 4326)),
      1000, $3, $4
    )
  `, [tile.rows[0]!.id, west, `checksum-${input.x}`, input.areaVersion ?? tileVersion]);
}

describe('thermal area map service', () => {
  it('returns only current complete polygons intersecting the viewport', async () => {
    await insertArea({ x: 1, status: 'complete' });
    await insertArea({ x: 2, status: 'processing' });
    await insertArea({ x: 3, status: 'complete', tileVersion: 2, areaVersion: 1 });
    await insertArea({ x: 4, status: 'complete', west: -100 });

    const result = await createThermalAreaMapService(database!.db).getViewport({
      west: -106, south: 38, east: -104, north: 40,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.geojson.features).toHaveLength(1);
    expect(result.geojson.features[0]?.properties).toMatchObject({
      activityBand: 'yellow_orange', relativeScore: 0.75,
    });
    expect(result.geojson.features[0]?.properties.processedAt).toMatch(/Z$/);
  });
});
