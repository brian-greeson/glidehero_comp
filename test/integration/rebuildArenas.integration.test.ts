import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseCountryArenaGeoJson, type CountryArenaDefinition } from '../../src/domain/arena/countryGeoJson.js';
import { parseMysqlLaunchDump, type LaunchImportRow } from '../../src/domain/launch/mysqlLaunchDump.js';
import { rebuildArenas } from '../../src/scripts/rebuildArenas.js';
import { parseStateArenaGeoJson, type StateArenaDefinition } from '../../src/services/stateArenaImportService.js';
import { launches } from '../../src/db/schema.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;
const polygon = { type: 'Polygon' as const, coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, -1]]] };

function country(): CountryArenaDefinition {
  return { sovereignId: 'EXAMPLE', sourceId: 100, isoCode: 'ZZ', name: 'Exampleland', geometry: polygon };
}

function state(): StateArenaDefinition {
  return { name: 'Example State', abbreviation: 'AL', fips: '01', geometries: [polygon] };
}

function launch(overrides: Partial<LaunchImportRow> = {}): LaunchImportRow {
  return {
    id: 745, name: 'Example Launch', longitude: 0, latitude: 0, country: 'Exampleland', state: 'Example State', city: 'Example City',
    description: '', xcByMonth: '', timezoneOffset: 0, xcByYear: '', rank: 0, elevation: 100,
    rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0, rank7: 0, rank8: 0, rank9: 0, rank10: 0, rank11: 0, rank12: 0,
    xcontestLaunchSite: 0, ...overrides,
  };
}

async function seedGeneralAndLaunchSource(): Promise<void> {
  if (!database) return;
  await database.pool.query(`INSERT INTO arenas (source_id, name, country, country_code, area, arena_type) VALUES (9, 'Old General', 'Exampleland', 'ZZ', ST_GeomFromText('MULTIPOLYGON(((-1 -1,-1 1,1 1,1 -1,-1 -1)))', 6933), 'general')`);
  await database.db.insert(launches).values(launch({ name: 'Old Launch Source' }));
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 777');
  await database.pool.query("SELECT nextval('arena_source_id_seq')");
}

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => {
  if (!database) return;
  await database.pool.query('TRUNCATE TABLE launches, arenas CASCADE');
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000');
});
afterAll(async () => { await database?.pool.end(); });

describe('one-time Arena rebuild', () => {
  it('runs a complete dry-run and leaves mixed Arena, source, and sequence state unchanged', async () => {
    if (!database) return;
    await seedGeneralAndLaunchSource();
    const beforeArenas = await database.pool.query('SELECT source_id, name, arena_type FROM arenas ORDER BY source_id');
    const beforeLaunches = await database.pool.query('SELECT id, name FROM launches ORDER BY id');
    const beforeSequence = await database.pool.query("SELECT last_value, is_called FROM arena_source_id_seq");
    const summary = await rebuildArenas(database.db, [country()], [state()], [launch()], 1000, false);
    expect(summary).toMatchObject({ dryRun: true, deleted: 1, inserted: { country: 1, state: 1, launch: 1, general: 0 } });
    await expect(database.pool.query('SELECT source_id, name, arena_type FROM arenas ORDER BY source_id')).resolves.toMatchObject({ rows: beforeArenas.rows });
    await expect(database.pool.query('SELECT id, name FROM launches ORDER BY id')).resolves.toMatchObject({ rows: beforeLaunches.rows });
    await expect(database.pool.query("SELECT last_value, is_called FROM arena_source_id_seq")).resolves.toMatchObject({ rows: beforeSequence.rows });
  }, 120_000);

  it('applies fixture sources and removes every old Arena, including General', async () => {
    if (!database) return;
    await seedGeneralAndLaunchSource();
    const summary = await rebuildArenas(database.db, [country()], [state()], [launch()], 1000, true);
    expect(summary.dryRun).toBe(false);
    const result = await database.pool.query<{ arena_type: string; count: number }>('SELECT arena_type, COUNT(*)::integer AS count FROM arenas GROUP BY arena_type');
    expect(result.rows).toEqual(expect.arrayContaining([
      { arena_type: 'country', count: 1 }, { arena_type: 'state', count: 1 }, { arena_type: 'launch', count: 1 },
    ]));
    expect(result.rows.find((row) => row.arena_type === 'general')).toBeUndefined();
  });

  it('rolls back old Arenas, source refresh, and sequence when a later insert fails', async () => {
    if (!database) return;
    await seedGeneralAndLaunchSource();
    const beforeLaunches = await database.pool.query('SELECT id, name FROM launches ORDER BY id');
    const beforeSequence = await database.pool.query("SELECT last_value, is_called FROM arena_source_id_seq");
    await expect(rebuildArenas(database.db, [country()], [state()], [launch(), launch({ id: 746, elevation: 1e20 })], 1000, true)).rejects.toThrow();
    await expect(database.pool.query("SELECT arena_type, name FROM arenas")).resolves.toMatchObject({ rows: [{ arena_type: 'general', name: 'Old General' }] });
    await expect(database.pool.query('SELECT id, name FROM launches ORDER BY id')).resolves.toMatchObject({ rows: beforeLaunches.rows });
    await expect(database.pool.query("SELECT last_value, is_called FROM arena_source_id_seq")).resolves.toMatchObject({ rows: beforeSequence.rows });
  });

  it('applies the checked-in sources with exact type counts and invariants', async () => {
    if (!database) return;
    const countries = parseCountryArenaGeoJson(JSON.parse(await readFile('ingest/countries.geojson', 'utf8')) as unknown);
    const states = parseStateArenaGeoJson(JSON.parse(await readFile('ingest/states.geojson', 'utf8')) as unknown);
    const launchRows = parseMysqlLaunchDump(await readFile('ingest/launches.sql', 'utf8'));
    const summary = await rebuildArenas(database.db, countries, states, launchRows, 1000, true);
    expect(summary.inserted).toEqual({ country: 194, state: 50, launch: launchRows.length, general: 0 });
    const result = await database.pool.query<{ count: number; source_count: number; duplicate_sources: number; bad: number }>(`SELECT COUNT(*)::integer AS count,
      COUNT(DISTINCT source_id)::integer AS source_count,
      (COUNT(*) - COUNT(DISTINCT source_id))::integer AS duplicate_sources,
      COUNT(*) FILTER (WHERE ST_SRID(area) <> 6933 OR ST_IsEmpty(area) OR NOT ST_IsValid(area) OR ST_GeometryType(area) <> 'ST_MultiPolygon')::integer AS bad
      FROM arenas`);
    expect(result.rows[0]).toMatchObject({ count: 194 + 50 + launchRows.length, source_count: 194 + 50 + launchRows.length, duplicate_sources: 0, bad: 0 });
  }, 300_000);
});
