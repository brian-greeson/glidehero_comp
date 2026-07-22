import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdminAreaService, type AdminAreaSaveInput } from '../../src/services/adminAreaService.js';
import type { ArenaLeadershipReconciliationService } from '../../src/services/arenaLeadershipReconciliationService.js';
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
    INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id)
    VALUES ($3, $1, $1, $2, ST_Multi(ST_Transform(ST_MakeEnvelope(-2, -2, 2, 2, 4326), 6933)), 'country', 'test-country', $4)
    RETURNING id
  `, [name, code, sourceId, `country-${sourceId}`]);
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
    const stored = await database.pool.query<{ arena_type: string; country: string; country_code: string; claimable_cell_count: number }>(
      'SELECT arena_type, country, country_code, claimable_cell_count::integer FROM arenas WHERE id = $1', [first.id],
    );
    expect(stored.rows[0]).toMatchObject({ arena_type: 'general', country: 'United States', country_code: 'US' });
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
        area, external_source, external_id, arena_type, claimable_cell_count)
      VALUES (745, 'Old name', 'United States', 'US', 'Colorado', 'Old city', ST_SetSRID(ST_MakePoint(-105, 39), 4326), 1800, 'America/Denver',
        ST_Multi(ST_Transform(ST_MakeEnvelope(0, 0, 0.01, 0.01, 4326), 6933)), 'test-source', 'external-745', 'launch', 1)
      RETURNING id
    `);
    const id = inserted.rows[0]!.id;
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await expect(service.update(id, { ...baseArea(countryId), name: 'Updated', city: '' })).resolves.toMatchObject({ id, name: 'Updated', arenaType: 'launch' });
    const metadata = await database.pool.query(`SELECT ST_X(location)::double precision AS longitude, altitude_meters, timezone, external_source, external_id, arena_type, source_id, claimable_cell_count::integer FROM arenas WHERE id = $1`, [id]);
    expect(metadata.rows[0]).toMatchObject({ longitude: -105, altitude_meters: 1800, timezone: 'America/Denver', external_source: 'test-source', external_id: 'external-745', arena_type: 'launch', source_id: '745' });
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

  it('preserves State denominator metadata on save', async () => {
    const countryId = await seedCountry();
    const state = await database.pool.query<{ id: string }>(`INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id, claimable_cell_count) VALUES (2000000001, 'Colorado', 'United States', 'US', ST_Multi(ST_Transform(ST_MakeEnvelope(0, 0, .01, .01, 4326), 6933)), 'state', 'test-state', '08', 4) RETURNING id`);
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    await service.update(state.rows[0]!.id, { ...baseArea(countryId), name: 'Colorado Updated' });
    const stored = await database.pool.query('SELECT claimable_cell_count FROM arenas WHERE id = $1', [state.rows[0]!.id]);
    expect(Number(stored.rows[0]!.claimable_cell_count)).toBe(4);
  });

  it('reconciles State target and same-type peers intersecting old or new geometry only', async () => {
    const countryId = await seedCountry();
    const insertState = async (sourceId: number, externalId: string, wkt: string) => {
      const result = await database.pool.query<{ id: string }>(`
        INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id, claimable_cell_count)
        VALUES ($1, $2, 'United States', 'US', ST_GeomFromText($3, 6933), 'state', 'test-state', $4, 9)
        RETURNING id
      `, [sourceId, externalId, wkt, externalId]);
      return result.rows[0]!.id;
    };
    const targetId = await insertState(2000000010, '10', 'MULTIPOLYGON (((0 0, 2000 0, 2000 2000, 0 2000, 0 0)))');
    const oldPeerId = await insertState(2000000011, '11', 'MULTIPOLYGON (((1000 0, 3000 0, 3000 2000, 1000 2000, 1000 0)))');
    const newPeerId = await insertState(2000000012, '12', 'MULTIPOLYGON (((5000 0, 7000 0, 7000 3000, 5000 3000, 5000 0)))');
    const unrelatedPeerId = await insertState(2000000013, '13', 'MULTIPOLYGON (((10000 0, 11000 0, 11000 1000, 10000 1000, 10000 0)))');
    const calls: string[][] = [];
    const leadership = {
      reconcileInTransaction: async (_transaction: unknown, input: { arenaIds: string[] }) => {
        calls.push(input.arenaIds);
        return {};
      },
    } as unknown as ArenaLeadershipReconciliationService;
    const service = createAdminAreaService(database.db, { cellSize: 1_000 }, leadership);
    const moved = {
      ...baseArea(countryId),
      name: 'Moved State',
      geometries: [{ type: 'Polygon' as const, coordinates: [[[0.04, 0], [0.04, 0.02], [0.06, 0.02], [0.06, 0], [0.04, 0]]] }],
    };
    await service.update(targetId, moved);

    expect(calls).toHaveLength(1);
    expect(new Set(calls[0])).toEqual(new Set([targetId, oldPeerId, newPeerId]));
    expect(calls[0]).not.toContain(unrelatedPeerId);
    const stored = await database.pool.query<{ claimable_cell_count: number }>('SELECT claimable_cell_count::integer FROM arenas WHERE id = $1', [targetId]);
    expect(stored.rows[0]?.claimable_cell_count).toBe(9);
  });

  it('uses ST_Covers for a boundary cell center', async () => {
    const countryId = await seedCountry();
    const service = createAdminAreaService(database.db, { cellSize: 1_000 });
    const area = await service.create({ ...baseArea(countryId) });
    await database.pool.query(`UPDATE arenas SET area = ST_GeomFromText('MULTIPOLYGON(((500 500,500 1500,1500 1500,1500 500,500 500)))', 6933), claimable_cell_count = 4 WHERE id = $1`, [area.id]);
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
