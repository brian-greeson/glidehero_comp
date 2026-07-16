import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launches } from '../../src/db/schema.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;
const importSql = await readFile(new URL('../../injest/importLaunchAreas.sql', import.meta.url), 'utf8');

function sourceLaunch(input: {
  id: number;
  name: string;
  longitude: number;
  latitude: number;
  elevation: number;
}) {
  return {
    ...input,
    country: 'United States',
    state: 'Test State',
    city: 'Test City',
    description: '',
    xcByMonth: '',
    timezoneOffset: 0,
    xcByYear: '',
    rank: 0,
    rank1: 0,
    rank2: 0,
    rank3: 0,
    rank4: 0,
    rank5: 0,
    rank6: 0,
    rank7: 0,
    rank8: 0,
    rank9: 0,
    rank10: 0,
    rank11: 0,
    rank12: 0,
    xcontestLaunchSite: 0,
  };
}

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE launches, launch_areas CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

describe('launch-area import', () => {
  it('imports metadata with IANA timezones and preserves future area data on rerun', async () => {
    await database.db.insert(launches).values([
      sourceLaunch({ id: 745, name: 'Woodrat Mountain', longitude: -123.003, latitude: 42.2319, elevation: 1_234 }),
      sourceLaunch({ id: 747, name: 'Colorado Launch', longitude: -105.5, latitude: 39.5, elevation: 2_345 }),
    ]);

    await database.pool.query(importSql);

    const imported = await database.pool.query<{
      id: string;
      source_id: string;
      name: string;
      longitude: number;
      latitude: number;
      altitude_meters: number;
      timezone: string;
      area_is_null: boolean;
    }>(
      `SELECT
         id,
         source_id,
         name,
         ST_X(location) AS longitude,
         ST_Y(location) AS latitude,
         altitude_meters,
         timezone,
         area IS NULL AS area_is_null
       FROM launch_areas
       ORDER BY source_id`,
    );

    expect(imported.rows).toEqual([
      {
        id: expect.any(String),
        source_id: '745',
        name: 'Woodrat Mountain',
        longitude: -123.003,
        latitude: 42.2319,
        altitude_meters: 1_234,
        timezone: 'America/Los_Angeles',
        area_is_null: true,
      },
      {
        id: expect.any(String),
        source_id: '747',
        name: 'Colorado Launch',
        longitude: -105.5,
        latitude: 39.5,
        altitude_meters: 2_345,
        timezone: 'America/Denver',
        area_is_null: true,
      },
    ]);

    const firstId = imported.rows[0]?.id;
    await database.pool.query(
      `UPDATE launch_areas
       SET area = ST_GeomFromText('MULTIPOLYGON(((0 0,0 1000,1000 1000,1000 0,0 0)))', 6933)
       WHERE source_id = 745`,
    );
    await database.pool.query(
      `INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y)
       SELECT id, 1000, 0, 0 FROM launch_areas WHERE source_id = 745`,
    );
    await database.pool.query("UPDATE launches SET name = 'Updated Woodrat' WHERE id = 745");

    await database.pool.query(importSql);

    const rerun = await database.pool.query<{
      id: string;
      name: string;
      area: string;
      cell_count: number;
    }>(
      `SELECT
         area.id,
         area.name,
         ST_AsText(area.area) AS area,
         COUNT(cell.*)::integer AS cell_count
       FROM launch_areas area
       LEFT JOIN launch_area_cells cell ON cell.launch_area_id = area.id
       WHERE area.source_id = 745
       GROUP BY area.id`,
    );

    expect(rerun.rows).toEqual([{
      id: firstId,
      name: 'Updated Woodrat',
      area: 'MULTIPOLYGON(((0 0,0 1000,1000 1000,1000 0,0 0)))',
      cell_count: 1,
    }]);
  });
});
