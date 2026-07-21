import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdminAreaService, type AdminAreaSaveInput } from '../../src/services/adminAreaService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE arenas CASCADE');
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000');
});
afterAll(async () => { await database?.pool.end(); });

const polygon = {
  type: 'Polygon' as const,
  coordinates: [[[0, 0], [0, 0.02], [0.02, 0.02], [0.02, 0], [0, 0]]],
};

async function seedCountry(name = 'United States', code = 'US', sourceId = 3_000_000_001) {
  const result = await database.pool.query<{ id: string }>(`
    INSERT INTO arenas (source_id, name, country, country_code, area, arena_type)
    VALUES ($3, $1, $1, $2, ST_Multi(ST_Transform(ST_MakeEnvelope(-2, -2, 2, 2, 4326), 6933)), 'country')
    RETURNING id
  `, [name, code, sourceId]);
  return result.rows[0]!.id;
}

function baseArea(countryArenaId: string): AdminAreaSaveInput {
  return { name: 'Custom Ridge', countryArenaId, state: 'Colorado', city: 'Golden', geometries: [polygon] };
}

async function exactCoveredCenters(id: string, cellSize: number) {
  const result = await database.pool.query<{ count: number }>(`
    SELECT COUNT(*)::integer AS count
    FROM arenas arena
    CROSS JOIN LATERAL ST_SquareGrid($1, arena.area) AS grid(geom, x, y)
    WHERE arena.id = $2
      AND ST_Covers(arena.area, ST_SetSRID(ST_MakePoint((grid.x + 0.5) * $1, (grid.y + 0.5) * $1), 6933))
  `, [cellSize, id]);
  return result.rows[0]!.count;
}

describe('admin Arena service with PostGIS', () => {
  it('lists only Country Arenas in the catalog and creates General Arenas canonically', async () => {
    const countryId = await seedCountry();
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const catalog = await service.listCountryOptions();
    expect(catalog).toEqual([expect.objectContaining({ id: countryId, sourceId: 3_000_000_001, name: 'United States', countryCode: 'US' })]);

    const first = await service.create(baseArea(countryId));
    const second = await service.create({ ...baseArea(countryId), name: 'Second Arena', state: '', city: '' });
    expect(first).toMatchObject({ sourceId: 10_000, arenaType: 'general', country: 'United States', countryCode: 'US' });
    expect(second.sourceId).toBe(10_001);
    const stored = await database.pool.query<{ arena_type: string; country: string; country_code: string; claimable_cell_count: number; claimable_cell_size: number }>(
      'SELECT arena_type, country, country_code, claimable_cell_count::integer, claimable_cell_size FROM arenas WHERE id = $1', [first.id],
    );
    expect(stored.rows[0]).toMatchObject({ arena_type: 'general', country: 'United States', country_code: 'US', claimable_cell_size: 1_000 });
    expect(stored.rows[0]!.claimable_cell_count).toBe(await exactCoveredCenters(first.id, 1_000));
  });

  it('rejects missing and non-Country catalog choices', async () => {
    const countryId = await seedCountry();
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await expect(service.create({ ...baseArea(countryId), countryArenaId: '00000000-0000-4000-8000-000000000099' }))
      .rejects.toThrow('valid Country Arena');
    const general = await service.create(baseArea(countryId));
    await expect(service.update(general.id, { ...baseArea(countryId), countryArenaId: general.id }))
      .rejects.toThrow('valid Country Arena');
  });

  it('normalizes polygons and preserves disconnected parts and holes', async () => {
    const countryId = await seedCountry();
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const area = await service.create({ ...baseArea(countryId), geometries: [
      polygon,
      { type: 'Polygon', coordinates: [[[0.01, 0], [0.01, 0.02], [0.03, 0.02], [0.03, 0], [0.01, 0]]] },
      { type: 'Polygon', coordinates: [[[1, 1], [1, 1.02], [1.02, 1.02], [1.02, 1], [1, 1]], [[1.005, 1.005], [1.015, 1.005], [1.015, 1.015], [1.005, 1.015], [1.005, 1.005]]] },
    ] });
    expect(area.componentCount).toBe(2);
    expect(area.geometry.coordinates.some((component) => component.length === 2)).toBe(true);
  });

  it('updates imported Launch metadata safely and recomputes its denominator', async () => {
    const countryId = await seedCountry();
    const inserted = await database.pool.query<{ id: string }>(`
      INSERT INTO arenas (source_id, name, country, country_code, state, city, location, altitude_meters, timezone,
        area, external_source, external_id, arena_type, claimable_cell_count, claimable_cell_size)
      VALUES (745, 'Old name', 'United States', 'US', 'Colorado', 'Old city', ST_SetSRID(ST_MakePoint(-105, 39), 4326), 1800, 'America/Denver',
        ST_Multi(ST_Transform(ST_MakeEnvelope(0, 0, 0.01, 0.01, 4326), 6933)), 'test-source', 'external-745', 'launch', 1, 500)
      RETURNING id
    `);
    const id = inserted.rows[0]!.id;
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await expect(service.update(id, { ...baseArea(countryId), name: 'Updated', city: '' })).resolves.toMatchObject({ id, name: 'Updated', arenaType: 'launch' });
    const metadata = await database.pool.query(`SELECT ST_X(location)::double precision AS longitude, altitude_meters, timezone, external_source, external_id, arena_type, source_id, claimable_cell_count::integer, claimable_cell_size FROM arenas WHERE id = $1`, [id]);
    expect(metadata.rows[0]).toMatchObject({ longitude: -105, altitude_meters: 1800, timezone: 'America/Denver', external_source: 'test-source', external_id: 'external-745', arena_type: 'launch', source_id: '745', claimable_cell_size: 1_000 });
    expect(metadata.rows[0].claimable_cell_count).toBe(await exactCoveredCenters(id, 1_000));
  });

  it('preserves a Country Arena identity when a different catalog choice is submitted', async () => {
    const unitedStatesId = await seedCountry('United States', 'US');
    const canadaId = await seedCountry('Canada', 'CA', 3_000_000_002);
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });

    const updated = await service.update(unitedStatesId, { ...baseArea(canadaId), name: 'United States Updated' });

    expect(updated).toMatchObject({ id: unitedStatesId, name: 'United States Updated', arenaType: 'country', country: 'United States', countryCode: 'US' });
    const stored = await database.pool.query<{ country: string; country_code: string }>('SELECT country, country_code FROM arenas WHERE id = $1', [unitedStatesId]);
    expect(stored.rows[0]).toEqual({ country: 'United States', country_code: 'US' });
  });

  it('keeps State and Country claimable columns null on save', async () => {
    const countryId = await seedCountry();
    const state = await database.pool.query<{ id: string }>(`INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, claimable_cell_count, claimable_cell_size) VALUES (2000000001, 'Colorado', 'United States', 'US', ST_Multi(ST_Transform(ST_MakeEnvelope(0, 0, .01, .01, 4326), 6933)), 'state', 4, 500) RETURNING id`);
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await service.update(state.rows[0]!.id, { ...baseArea(countryId), name: 'Colorado Updated' });
    const stored = await database.pool.query('SELECT claimable_cell_count, claimable_cell_size FROM arenas WHERE id = $1', [state.rows[0]!.id]);
    expect(stored.rows[0]).toEqual({ claimable_cell_count: null, claimable_cell_size: null });
  });

  it('uses ST_Covers for a boundary cell center', async () => {
    const countryId = await seedCountry();
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const area = await service.create({ ...baseArea(countryId) });
    await database.pool.query(`UPDATE arenas SET area = ST_GeomFromText('MULTIPOLYGON(((500 500,500 1500,1500 1500,1500 500,500 500)))', 6933), claimable_cell_count = 4, claimable_cell_size = 1000 WHERE id = $1`, [area.id]);
    const covered = await database.pool.query<{ covers: boolean }>(`SELECT ST_Covers(area, ST_SetSRID(ST_MakePoint(500, 500), 6933)) AS covers FROM arenas WHERE id = $1`, [area.id]);
    expect(covered.rows[0]!.covers).toBe(true);
    const stored = await database.pool.query<{ count: number }>('SELECT claimable_cell_count::integer AS count FROM arenas WHERE id = $1', [area.id]);
    expect(stored.rows[0]!.count).toBe(await exactCoveredCenters(area.id, 1_000));
  });

  it('previews cell-center membership and limits oversized viewports', async () => {
    const countryId = await seedCountry();
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const preview = await service.preview({ west: 0, south: 0, east: 0.03, north: 0.02 }, [polygon]);
    expect(preview.features.some((feature) => feature.properties.inside)).toBe(true);
    expect(preview.features.some((feature) => !feature.properties.inside)).toBe(true);
    await expect(service.preview({ west: -120, south: 30, east: -100, north: 50 }, [polygon])).rejects.toThrow('Zoom in');
    expect(countryId).toBeTruthy();
  });
});
