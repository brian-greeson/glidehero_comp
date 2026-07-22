import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { resetAndMigrateTestDatabase } from './database.js';
import { arenaCellOwnershipPredicateSql } from '../../src/services/arenaGeometrySql.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE arenas CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

const square = (west: number, east: number) => `MULTIPOLYGON (((${west} 0, ${east} 0, ${east} 1000, ${west} 1000, ${west} 0)))`;

async function insertArena(input: { sourceId: number; type: string; externalId?: string; west?: number; east?: number }) {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_id)
     VALUES ($1, $2, 'United States', 'US', ST_GeomFromText($3, 6933), $4, $5)
     RETURNING id`,
    [input.sourceId, `${input.type}-${input.sourceId}`, square(input.west ?? 0, input.east ?? 1000), input.type, input.externalId ?? null],
  );
  return result.rows[0]!.id;
}

async function memberships(centerX: number, centerY = 500) {
  const center = sql`ST_SetSRID(ST_MakePoint(${centerX}, ${centerY}), 6933)`;
  const predicate = arenaCellOwnershipPredicateSql({
    arenaId: sql`arena.id`,
    arenaType: sql`arena.arena_type`,
    externalId: sql`arena.external_id`,
    area: sql`arena.area`,
    cellCenter: center,
  });
  const result = await database.db.execute<{ externalId: string | null; arenaType: string; owns: boolean }>(sql`
    SELECT arena.external_id AS "externalId", arena.arena_type AS "arenaType", ${predicate} AS owns
    FROM arenas arena
    ORDER BY arena.arena_type, arena.external_id NULLS LAST
  `);
  return result.rows;
}

describe('Arena cell ownership SQL', () => {
  it('keeps peer sets independent and applies C-collation exclusive ownership', async () => {
    await insertArena({ sourceId: 1, type: 'state', externalId: 'B-state' });
    await insertArena({ sourceId: 2, type: 'state', externalId: 'A-state' });
    await insertArena({ sourceId: 3, type: 'country', externalId: 'B-country' });
    await insertArena({ sourceId: 4, type: 'country', externalId: 'A-country' });
    await insertArena({ sourceId: 5, type: 'state', externalId: 'A-boundary', west: 1000, east: 2000 });
    await insertArena({ sourceId: 6, type: 'state', externalId: 'B-boundary', west: 1000, east: 2000 });
    await insertArena({ sourceId: 7, type: 'country', externalId: 'cross-country', west: 2000, east: 3000 });
    await insertArena({ sourceId: 8, type: 'state', externalId: 'cross-state', west: 2000, east: 3000 });
    await insertArena({ sourceId: 9, type: 'general' });
    await insertArena({ sourceId: 10, type: 'general', west: 0, east: 2000 });

    const centerRows = await memberships(500);
    expect(centerRows.filter((row) => row.arenaType === 'state' && row.owns).map((row) => row.externalId)).toEqual(['A-state']);
    expect(centerRows.filter((row) => row.arenaType === 'country' && row.owns).map((row) => row.externalId)).toEqual(['A-country']);
    expect(centerRows.filter((row) => row.arenaType === 'general' && row.owns)).toHaveLength(2);

    const crossTypeRows = await memberships(2500);
    expect(crossTypeRows.find((row) => row.externalId === 'cross-state')?.owns).toBe(true);
    expect(crossTypeRows.find((row) => row.externalId === 'cross-country')?.owns).toBe(true);

    const boundaryRows = await memberships(1000);
    expect(boundaryRows.find((row) => row.externalId === 'A-boundary')?.owns).toBe(true);
    expect(boundaryRows.find((row) => row.externalId === 'B-boundary')?.owns).toBe(false);

    expect((await memberships(5000)).every((row) => !row.owns)).toBe(true);
  });

  it('enforces eligible external IDs and same-type uniqueness', async () => {
    const indexes = await database.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'arenas_arena_type_external_id_state_country_unique'`,
    );
    expect(indexes.rows[0]?.indexdef).toContain('arena_type');
    expect(indexes.rows[0]?.indexdef).toContain('external_id');

    await insertArena({ sourceId: 20, type: 'state', externalId: 'duplicate' });
    await expect(insertArena({ sourceId: 21, type: 'state', externalId: 'duplicate' })).rejects.toThrow();
    await expect(insertArena({ sourceId: 22, type: 'country' })).rejects.toThrow();
    await expect(insertArena({ sourceId: 23, type: 'country', externalId: 'duplicate' })).resolves.toBeTypeOf('string');
  });
});
