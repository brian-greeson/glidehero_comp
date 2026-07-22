import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importLaunchArenas, launchGridAnchor } from '../../src/services/launchArenaImportService.js';
import type { LaunchImportRow } from '../../src/domain/launch/mysqlLaunchDump.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

function launch(overrides: Partial<LaunchImportRow> = {}): LaunchImportRow {
  return {
    id: 745, name: 'Woodrat Mountain', longitude: -123.003, latitude: 42.2319, country: 'United States', state: 'Oregon', city: 'Ruch',
    description: '', xcByMonth: '', timezoneOffset: 0, xcByYear: '', rank: 0, elevation: 1234,
    rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0, rank7: 0, rank8: 0, rank9: 0,
    rank10: 0, rank11: 0, rank12: 0, xcontestLaunchSite: 0, ...overrides,
  };
}

async function addCountry(name = 'United States of America', sourceId = 1159320399) {
  await database.pool.query(`
    INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id)
    VALUES ($2, $1, $1, 'US', ST_GeomFromText('MULTIPOLYGON(((-1 -1,-1 1,1 1,1 -1,-1 -1)))', 6933), 'country', 'test', $1)
  `, [name, sourceId]);
}

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE launches, arenas CASCADE'); });
afterAll(async () => { await database.pool.end(); });

describe('Launch Arena importer', () => {
  it('anchors negative projected coordinates with mathematical floor', () => {
    expect(launchGridAnchor({ x: -1, y: -1001 }, 1000)).toEqual({ x: -1, y: -2 });
    expect(launchGridAnchor({ x: 0, y: 1000 }, 1000)).toEqual({ x: 0, y: 1 });
  });

  it('refreshes the source mirror and creates a valid 25-cell Launch Arena at configured size', async () => {
    await addCountry();
    await importLaunchArenas(database.db, [launch(), launch({ id: 746, name: 'Negative Y', longitude: 0, latitude: -10 })], 1000);
    const result = await database.pool.query<{
      id: number; projectedX: number; projectedY: number; anchorX: number; anchorY: number;
      areaSize: number; width: number; height: number; centralCell: boolean; centerCount: string;
      arenaType: string; country: string; countryCode: string; timezone: string; claimableCellCount: string;
      valid: boolean; geometryType: string; area: string;
    }>(`WITH projected AS (
      SELECT source_id, arena_type, country, country_code, timezone, claimable_cell_count, area,
        ST_Transform(location, 6933) AS point FROM arenas WHERE arena_type = 'launch'
    ), anchors AS (
      SELECT *, floor(ST_X(point) / 1000)::integer AS x, floor(ST_Y(point) / 1000)::integer AS y
      FROM projected
    )
    SELECT source_id::integer AS id, ST_X(point)::double precision AS "projectedX", ST_Y(point)::double precision AS "projectedY", x AS "anchorX", y AS "anchorY",
      ST_Area(area)::double precision AS "areaSize", (ST_XMax(area)-ST_XMin(area))::double precision AS width,
      (ST_YMax(area)-ST_YMin(area))::double precision AS height,
      ST_Covers(ST_MakeEnvelope(x*1000, y*1000, (x+1)*1000, (y+1)*1000, 6933), point) AS "centralCell",
      (SELECT COUNT(*) FROM generate_series(-2, 2) dx, generate_series(-2, 2) dy
        WHERE ST_Covers(area, ST_SetSRID(ST_MakePoint((x+dx+0.5)*1000, (y+dy+0.5)*1000), 6933)))::text AS "centerCount",
      arena_type AS "arenaType", country, country_code AS "countryCode", timezone,
      claimable_cell_count AS "claimableCellCount",
      ST_IsValid(area) AS valid, ST_GeometryType(area) AS "geometryType", ST_AsText(area) area
      FROM anchors ORDER BY source_id`);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ id: 745, arenaType: 'launch', country: 'United States of America', countryCode: 'US', timezone: 'America/Los_Angeles', claimableCellCount: '25', valid: true, geometryType: 'ST_MultiPolygon', areaSize: 25_000_000, width: 5000, height: 5000, centralCell: true, centerCount: '25' });
    expect(result.rows[1]).toMatchObject({ id: 746, valid: true, geometryType: 'ST_MultiPolygon', areaSize: 25_000_000, width: 5000, height: 5000, centralCell: true, centerCount: '25' });
    expect(result.rows[1]?.projectedY).toBeLessThan(0);
    expect(result.rows[1]?.anchorY).toBe(Math.floor((result.rows[1]?.projectedY ?? 0) / 1000));
    expect((await database.pool.query('SELECT COUNT(*)::integer count FROM launches')).rows[0]?.count).toBe(2);
  });

  it('rejects unresolved countries atomically before source or Arena writes', async () => {
    await addCountry();
    await expect(importLaunchArenas(database.db, [launch({ country: 'Narnia' })], 750)).rejects.toThrow('unresolved country');
    expect((await database.pool.query('SELECT COUNT(*)::integer count FROM launches')).rows[0]?.count).toBe(0);
    expect((await database.pool.query("SELECT COUNT(*)::integer count FROM arenas WHERE arena_type = 'launch'")).rows[0]?.count).toBe(0);
  });

  it('rejects reruns and source collisions', async () => {
    await addCountry();
    await importLaunchArenas(database.db, [launch()], 750);
    await expect(importLaunchArenas(database.db, [launch()], 750)).rejects.toThrow('does not support reruns');
  });

  it('rejects a source ID collision with a non-Launch Arena without writing the source mirror', async () => {
    await addCountry('United States of America', 745);
    await expect(importLaunchArenas(database.db, [launch()], 750)).rejects.toThrow('source ID collision');
    expect((await database.pool.query('SELECT COUNT(*)::integer count FROM launches')).rows[0]?.count).toBe(0);
    expect((await database.pool.query('SELECT COUNT(*)::integer count FROM arenas')).rows[0]?.count).toBe(1);
  });

  it('rejects an external ID collision with a non-Launch Arena without writing the source mirror', async () => {
    await addCountry();
    await database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id)
      VALUES (9999, 'Existing', 'United States of America', 'US', ST_GeomFromText('MULTIPOLYGON(((-1 -1,-1 1,1 1,1 -1,-1 -1)))', 6933), 'general', 'xcontest-launch', '745')
    `);
    await expect(importLaunchArenas(database.db, [launch()], 750)).rejects.toThrow('external ID collision');
    expect((await database.pool.query('SELECT COUNT(*)::integer count FROM launches')).rows[0]?.count).toBe(0);
    expect((await database.pool.query("SELECT COUNT(*)::integer count FROM arenas WHERE arena_type = 'launch'")).rows[0]?.count).toBe(0);
    expect((await database.pool.query("SELECT COUNT(*)::integer count FROM arenas WHERE external_id = '745'")).rows[0]?.count).toBe(1);
  });
});
