import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createArenaService } from '../../src/services/arenaService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE arenas CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

async function insertArena(input: { sourceId: number; name: string; city: string; countryCode?: string; arenaType?: string }) {
  const inserted = await database.pool.query<{ id: string }>(`
    INSERT INTO arenas (
      source_id, name, country, country_code, arena_type, state, city, location, altitude_meters, timezone, area,
      external_id
    ) VALUES (
      $1, $2, 'United States', $4, $5, 'Colorado', $3,
      ST_Transform(ST_SetSRID(ST_Point(500, 500), 6933), 4326), 1000, 'America/Denver',
      ST_Multi(ST_MakeEnvelope(0, 0, 1000, 1000, 6933)), $6
    ) RETURNING id
  `, [
    input.sourceId,
    input.name,
    input.city,
    input.countryCode ?? 'US',
    input.arenaType ?? 'general',
    input.arenaType === 'state' || input.arenaType === 'country' ? `${input.arenaType}-${input.sourceId}` : null,
  ]);
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Expected Arena id.');
  return id;
}

describe('ArenaService with PostGIS', () => {
  it('searches generated Arenas by name and location and returns canonical routes', async () => {
    await insertArena({ sourceId: 745, name: 'Boulder Ridge', city: 'Boulder' });
    await insertArena({ sourceId: 746, name: 'Other Launch', city: 'Boulder' });
    await insertArena({ sourceId: 747, name: 'Boulder Without Membership Rows', city: 'Boulder' });

    const arenas = await createArenaService(database.db, { cellSize: 1_000 }).search('Boulder');

    expect(arenas.map((arena) => arena.sourceId)).toEqual([745, 747, 746]);
    expect(arenas[0]).toMatchObject({
      name: 'Boulder Ridge',
      countryCode: 'us',
      arenaType: 'general',
      path: '/arena/us/boulder-ridge-745',
    });
  });

  it('treats LIKE metacharacters in Arena searches as literal text', async () => {
    await insertArena({ sourceId: 800, name: 'Hundred% Ridge', city: 'Percent' });
    await insertArena({ sourceId: 801, name: 'Under_score Hill', city: 'Underscore' });
    await insertArena({ sourceId: 802, name: String.raw`Back\slash Point`, city: 'Backslash' });
    await insertArena({ sourceId: 803, name: 'Ordinary Ridge', city: 'Ordinary' });
    const service = createArenaService(database.db, { cellSize: 1_000 });

    await expect(service.search('%')).resolves.toEqual([
      expect.objectContaining({ sourceId: 800 }),
    ]);
    await expect(service.search('_')).resolves.toEqual([
      expect.objectContaining({ sourceId: 801 }),
    ]);
    await expect(service.search('\\')).resolves.toEqual([
      expect.objectContaining({ sourceId: 802 }),
    ]);
    await expect(service.search("' OR TRUE --")).resolves.toEqual([]);
  });

  it('uses the stored country code for routes outside the legacy country list', async () => {
    await insertArena({ sourceId: 910, name: 'Pristina Ridge', city: 'Pristina', countryCode: 'XK', arenaType: 'country' });
    const service = createArenaService(database.db);

    await expect(service.getByRoute('xk', 'pristina-ridge-910')).resolves.toMatchObject({
      countryCode: 'xk',
      arenaType: 'country',
      path: '/arena/xk/pristina-ridge-910',
    });
  });

  it('resolves only canonical routes and returns a WGS84 boundary and bounds', async () => {
    await insertArena({ sourceId: 745, name: 'Boulder Ridge', city: 'Boulder' });
    const service = createArenaService(database.db, { cellSize: 1_000 });

    const arena = await service.getByRoute('us', 'boulder-ridge-745');

    expect(arena).toMatchObject({ sourceId: 745, name: 'Boulder Ridge' });
    expect(arena?.boundary.type).toBe('Feature');
    expect(arena?.boundary.geometry.type).toBe('MultiPolygon');
    expect(arena?.boundary.bbox).toHaveLength(4);
    expect(arena?.boundary.bbox.every(Number.isFinite)).toBe(true);
    expect(await service.getByRoute('ca', 'boulder-ridge-745')).toBeNull();
    expect(await service.getByRoute('us', 'wrong-745')).toBeNull();
  });

  it('preserves disconnected components and returns narrow antimeridian display bounds', async () => {
    await database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, state, area)
      VALUES (900, 'Date Line Arena', 'United States', 'US', 'Alaska', ST_Multi(ST_Collect(
        ST_Transform(ST_MakeEnvelope(170, 50, 179, 60, 4326), 6933),
        ST_Transform(ST_MakeEnvelope(-179, 50, -170, 60, 4326), 6933)
      )))
    `);
    const arena = await createArenaService(database.db).getBySourceId(900);
    expect(arena?.boundary.geometry.coordinates).toHaveLength(2);
    expect((arena?.boundary.bbox[2] ?? 360) - (arena?.boundary.bbox[0] ?? 0)).toBeLessThan(30);
  });
});
