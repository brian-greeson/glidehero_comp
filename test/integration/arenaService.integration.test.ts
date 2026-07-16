import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createArenaService } from '../../src/services/arenaService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE launch_areas CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

async function insertArena(input: { sourceId: number; name: string; city: string; withCells: boolean }) {
  const inserted = await database.pool.query<{ id: string }>(`
    INSERT INTO launch_areas (
      source_id, name, country, state, city, location, altitude_meters, timezone, area
    ) VALUES (
      $1, $2, 'United States', 'Colorado', $3,
      ST_Transform(ST_SetSRID(ST_Point(500, 500), 6933), 4326), 1000, 'America/Denver',
      ST_Multi(ST_MakeEnvelope(0, 0, 1000, 1000, 6933))
    ) RETURNING id
  `, [input.sourceId, input.name, input.city]);
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error('Expected launch area id.');
  if (input.withCells) {
    await database.pool.query(
      'INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y) VALUES ($1, 1000, 0, 0)',
      [id],
    );
  }
  return id;
}

describe('ArenaService with PostGIS', () => {
  it('searches generated Arenas by name and location and returns canonical routes', async () => {
    await insertArena({ sourceId: 745, name: 'Boulder Ridge', city: 'Boulder', withCells: true });
    await insertArena({ sourceId: 746, name: 'Other Launch', city: 'Boulder', withCells: true });
    await insertArena({ sourceId: 747, name: 'Boulder Hidden', city: 'Boulder', withCells: false });

    const arenas = await createArenaService(database.db, { cellSize: 1_000 }).search('Boulder');

    expect(arenas.map((arena) => arena.sourceId)).toEqual([745, 746]);
    expect(arenas[0]).toMatchObject({
      name: 'Boulder Ridge',
      countryCode: 'us',
      path: '/arena/us/boulder-ridge-745',
    });
  });

  it('treats LIKE metacharacters in Arena searches as literal text', async () => {
    await insertArena({ sourceId: 800, name: 'Hundred% Ridge', city: 'Percent', withCells: true });
    await insertArena({ sourceId: 801, name: 'Under_score Hill', city: 'Underscore', withCells: true });
    await insertArena({ sourceId: 802, name: String.raw`Back\slash Point`, city: 'Backslash', withCells: true });
    await insertArena({ sourceId: 803, name: 'Ordinary Ridge', city: 'Ordinary', withCells: true });
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

  it('resolves only canonical routes and returns a WGS84 boundary and bounds', async () => {
    await insertArena({ sourceId: 745, name: 'Boulder Ridge', city: 'Boulder', withCells: true });
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
});
