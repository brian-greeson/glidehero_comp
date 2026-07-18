import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launches } from '../../src/db/schema.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;
const importSql = await readFile(new URL('../../injest/importLaunchAreas.sql', import.meta.url), 'utf8');
const sourceLaunch = (name: string) => ({
  id: 745, name, longitude: -123.003, latitude: 42.2319, country: 'United States', state: 'Oregon', city: 'Ruch',
  description: '', xcByMonth: '', timezoneOffset: 0, xcByYear: '', rank: 0, elevation: 1234,
  rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0, rank7: 0, rank8: 0, rank9: 0,
  rank10: 0, rank11: 0, rank12: 0, xcontestLaunchSite: 0,
});

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE launches, arenas CASCADE'); });
afterAll(async () => { await database.pool.end(); });

describe('Arena launch metadata refresh', () => {
  it('updates existing grid metadata without changing identity, polygon, or definition type', async () => {
    await database.db.insert(launches).values(sourceLaunch('Woodrat Mountain'));
    const inserted = await database.pool.query<{ id: string }>(`
      INSERT INTO arenas (source_id, name, country, state, definition_type, area)
      VALUES (745, 'Old name', 'United States', 'Oregon', 'grid',
        ST_GeomFromText('MULTIPOLYGON(((0 0,0 1000,1000 1000,1000 0,0 0)))', 6933))
      RETURNING id
    `);
    await database.pool.query(importSql);
    const result = await database.pool.query(`
      SELECT id, name, city, timezone, definition_type, ST_AsText(area) AS area FROM arenas WHERE source_id = 745
    `);
    expect(result.rows).toEqual([{
      id: inserted.rows[0]?.id, name: 'Woodrat Mountain', city: 'Ruch', timezone: 'America/Los_Angeles',
      definition_type: 'grid', area: 'MULTIPOLYGON(((0 0,0 1000,1000 1000,1000 0,0 0)))',
    }]);
  });

  it('does not create polygon-less Arenas for unmatched launch rows', async () => {
    await database.db.insert(launches).values(sourceLaunch('Woodrat Mountain'));
    await database.pool.query(importSql);
    expect((await database.pool.query('SELECT COUNT(*)::integer AS count FROM arenas')).rows[0]?.count).toBe(0);
  });
});
