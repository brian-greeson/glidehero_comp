import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMapGridService } from '../../src/services/mapGridService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE launch_areas CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

describe('MapGridService with PostGIS', () => {
  it('returns configured EPSG:6933 cells intersecting a viewport', async () => {
    const service = createMapGridService(database.db, { cellSize: 1_000, maxViewportCells: 10 });
    const result = await service.getViewport({ west: 0, south: 0, east: 0.01, north: 0.01 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected a grid result.');
    expect(result.geojson.features.length).toBeGreaterThan(0);
    expect(result.geojson.features[0]?.properties).toMatchObject({ cellSize: 1_000 });
    expect(result.geojson.features[0]?.geometry.type).toBe('Polygon');
  });

  it('rejects a viewport that would exceed the configured cell limit', async () => {
    const service = createMapGridService(database.db, { cellSize: 1_000, maxViewportCells: 1 });
    await expect(service.getViewport({ west: 0, south: 0, east: 1, north: 1 }))
      .resolves.toEqual({ status: 'too_large' });
  });

  it('deduplicates cells across an antimeridian-split viewport', async () => {
    const service = createMapGridService(database.db, { cellSize: 1_000, maxViewportCells: 5_000 });
    const result = await service.getViewport({ west: 179.99, south: 0, east: -179.99, north: 0.01 });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('Expected a grid result.');
    const ids = result.geojson.features.map(({ properties }) => `${properties.x}:${properties.y}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns only stored cells for the requested Arena and configured size', async () => {
    const arena = await database.pool.query<{ id: string }>(`
      INSERT INTO launch_areas (
        source_id, name, country, state, city, location, altitude_meters, timezone, area
      ) VALUES (
        745, 'Flight Aid Arena', 'United States', 'Colorado', 'Boulder',
        ST_Transform(ST_SetSRID(ST_Point(500, 500), 6933), 4326), 1000, 'America/Denver',
        ST_Multi(ST_MakeEnvelope(0, 0, 2000, 1000, 6933))
      ) RETURNING id
    `);
    const launchAreaId = arena.rows[0]?.id;
    if (!launchAreaId) throw new Error('Expected an Arena.');
    await database.pool.query(`
      INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y) VALUES
        ($1, 1000, 0, 0), ($1, 1000, 1, 0), ($1, 500, 99, 99)
    `, [launchAreaId]);

    const result = await createMapGridService(database.db, { cellSize: 1_000 })
      .getArena({ launchAreaId });

    expect(result.features.map(({ properties }) => [properties.x, properties.y]))
      .toEqual([[0, 0], [1, 0]]);
  });
});
