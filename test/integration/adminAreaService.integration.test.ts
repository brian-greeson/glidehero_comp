import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdminAreaService, type AdminAreaSaveInput } from '../../src/services/adminAreaService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE launch_areas CASCADE');
  await database.pool.query('ALTER SEQUENCE custom_launch_area_source_id_seq RESTART WITH 10000');
});

afterAll(async () => {
  await database?.pool.end();
});

const baseArea: AdminAreaSaveInput = {
  name: 'Custom Ridge',
  country: 'United States',
  state: 'Colorado',
  city: 'Golden',
  latitude: 0,
  longitude: 0,
  altitudeMeters: 1800,
  timezone: 'America/Denver',
  cells: [{ x: 0, y: 0 }, { x: 2, y: 0 }],
};

describe('admin area service with PostGIS', () => {
  it('creates incrementing custom IDs and preserves disconnected cell groups', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const first = await service.create(baseArea);
    const second = await service.create({ ...baseArea, name: 'Second Ridge', cells: [{ x: 0, y: 0 }] });

    expect(first.sourceId).toBe(10_000);
    expect(second.sourceId).toBe(10_001);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ sourceId: 10_000, name: 'Custom Ridge' }),
      expect.objectContaining({ sourceId: 10_001, name: 'Second Ridge' }),
    ]);
    const detail = await service.get(first.id);
    expect(detail).toMatchObject({
      sourceId: 10_000,
      cellCount: 2,
      latitude: 0,
      longitude: 0,
    });
    expect(detail?.cells.features.map(({ properties }) => properties)).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    expect(detail?.bbox).not.toBeNull();

    const geometry = await database.pool.query<{ parts: number; valid: boolean }>(
      'SELECT ST_NumGeometries(area)::integer AS parts, ST_IsValid(area) AS valid FROM launch_areas WHERE id = $1',
      [first.id],
    );
    expect(geometry.rows[0]).toEqual({ parts: 2, valid: true });
  });

  it('replaces only the selected area cells and permits overlaps with another area', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const first = await service.create(baseArea);
    const second = await service.create({ ...baseArea, name: 'Overlapping Ridge', cells: [{ x: 0, y: 0 }] });

    await expect(service.update(first.id, {
      ...baseArea,
      name: 'Updated Ridge',
      cells: [{ x: 5, y: 6 }],
    })).resolves.toMatchObject({ id: first.id, sourceId: 10_000 });

    await expect(service.get(first.id)).resolves.toMatchObject({ name: 'Updated Ridge', cellCount: 1 });
    await expect(service.get(second.id)).resolves.toMatchObject({ name: 'Overlapping Ridge', cellCount: 1 });
    expect((await service.get(first.id))?.cells.features[0]?.properties).toEqual({ x: 5, y: 6 });
    expect((await service.get(second.id))?.cells.features[0]?.properties).toEqual({ x: 0, y: 0 });
  });

  it('rolls back metadata and cells when a replacement cannot be inserted', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const area = await service.create({ ...baseArea, cells: [{ x: 0, y: 0 }] });

    await expect(service.update(area.id, {
      ...baseArea,
      name: 'Should Roll Back',
      cells: [{ x: 1, y: 1 }, { x: 1, y: 1 }],
    })).rejects.toThrow();

    await expect(service.get(area.id)).resolves.toMatchObject({ name: 'Custom Ridge', cellCount: 1 });
  });

  it('rejects empty areas and returns aligned editable grid features for a viewport', async () => {
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await expect(service.create({ ...baseArea, cells: [] })).rejects.toThrow('at least one cell');
    const count = await database.pool.query<{ count: number }>('SELECT COUNT(*)::integer AS count FROM launch_areas');
    expect(count.rows[0]?.count).toBe(0);

    const grid = await service.grid({ west: -0.02, south: -0.02, east: 0.02, north: 0.02 });
    expect(grid.features.length).toBeGreaterThan(0);
    expect(grid.features[0]).toMatchObject({
      type: 'Feature',
      properties: { x: expect.any(Number), y: expect.any(Number) },
      geometry: { type: 'Polygon' },
    });
    const westernGrid = await service.grid({ west: -106.21, south: 38.99, east: -106.19, north: 39 });
    expect(westernGrid.features.length).toBeGreaterThan(0);
    expect(westernGrid.features.length).toBeLessThan(100);
    await expect(service.grid({ west: -120, south: 30, east: -100, north: 50 }))
      .rejects.toThrow('Zoom in');
  });
});
