import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdminAreaService, type AdminAreaSaveInput } from '../../src/services/adminAreaService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE arenas CASCADE');
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000');
});
afterAll(async () => { await database?.pool.end(); });

const polygon = {
  type: 'Polygon' as const,
  coordinates: [[[0, 0], [0, 0.02], [0.02, 0.02], [0.02, 0], [0, 0]]],
};
const baseArea: AdminAreaSaveInput = {
  name: 'Custom Ridge',
  country: 'United States',
  state: 'Colorado',
  city: 'Golden',
  geometries: [polygon],
};

describe('admin Arena service with PostGIS', () => {
  it('creates incrementing source IDs and lists every Arena', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const first = await service.create(baseArea);
    const second = await service.create({ ...baseArea, name: 'State Arena', state: '', city: '' });

    expect(first.sourceId).toBe(10_000);
    expect(second.sourceId).toBe(10_001);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ sourceId: 10_000, name: 'Custom Ridge', city: 'Golden' }),
      expect.objectContaining({ sourceId: 10_001, name: 'State Arena', state: '', city: '' }),
    ]);
    expect(first.geometry.type).toBe('MultiPolygon');
    expect(first.bbox).toHaveLength(4);
  });

  it('normalizes polygons and preserves disconnected parts and holes', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const area = await service.create({
      ...baseArea,
      geometries: [
        polygon,
        { type: 'Polygon', coordinates: [[[0.01, 0], [0.01, 0.02], [0.03, 0.02], [0.03, 0], [0.01, 0]]] },
        { type: 'Polygon', coordinates: [
          [[1, 1], [1, 1.02], [1.02, 1.02], [1.02, 1], [1, 1]],
          [[1.005, 1.005], [1.015, 1.005], [1.015, 1.015], [1.005, 1.015], [1.005, 1.005]],
        ] },
      ],
    });

    expect(area.componentCount).toBe(2);
    expect(area.geometry.coordinates.some((component) => component.length === 2)).toBe(true);
  });

  it('updates editable fields while preserving hidden launch and import metadata', async () => {
    const inserted = await database.pool.query<{ id: string }>(`
      INSERT INTO arenas (
        source_id, name, country, state, city, location, altitude_meters, timezone,
        area, external_source, external_id
      ) VALUES (
        745, 'Old name', 'United States', 'Colorado', 'Old city',
        ST_SetSRID(ST_MakePoint(-105, 39), 4326), 1800, 'America/Denver',
        ST_Multi(ST_Transform(ST_MakeEnvelope(0, 0, 0.01, 0.01, 4326), 6933)),
        'test-source', 'external-745'
      ) RETURNING id
    `);
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('Expected an Arena.');

    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await expect(service.update(id, { ...baseArea, name: 'Updated', city: '' }))
      .resolves.toMatchObject({ id, name: 'Updated', city: '' });
    const metadata = await database.pool.query(`
      SELECT ST_X(location)::double precision AS longitude, altitude_meters, timezone,
        external_source, external_id
      FROM arenas WHERE id = $1
    `, [id]);
    expect(metadata.rows[0]).toEqual({
      longitude: -105,
      altitude_meters: 1800,
      timezone: 'America/Denver',
      external_source: 'test-source',
      external_id: 'external-745',
    });
  });

  it('previews cell-center membership and limits oversized viewports', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const preview = await service.preview({ west: 0, south: 0, east: 0.03, north: 0.02 }, [polygon]);
    expect(preview.features.some((feature) => feature.properties.inside)).toBe(true);
    expect(preview.features.some((feature) => !feature.properties.inside)).toBe(true);
    await expect(service.preview({ west: -120, south: 30, east: -100, north: 50 }, [polygon]))
      .rejects.toThrow('Zoom in');
  });
});
