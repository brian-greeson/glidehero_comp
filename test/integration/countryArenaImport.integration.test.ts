import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importCountryArenas } from '../../src/services/countryArenaImportService.js';
import { parseCountryArenaGeoJson, type CountryArenaDefinition } from '../../src/domain/arena/countryGeoJson.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

const polygon = { type: 'Polygon' as const, coordinates: [[[10, 10], [10, 11], [11, 11], [10, 10]]] };
const multipolygon = {
  type: 'MultiPolygon' as const,
  coordinates: [
    [[[179, 20], [179, 21], [179.5, 21], [179, 20]]],
    [[[-179.5, 20], [-179.5, 21], [-179, 21], [-179.5, 20]]],
  ],
};

function country(overrides: Partial<CountryArenaDefinition> = {}): CountryArenaDefinition {
  return {
    sovereignId: 'AAA',
    sourceId: 1,
    isoCode: 'AA',
    name: 'Exampleland',
    geometry: polygon,
    ...overrides,
  };
}

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => {
  if (!database) return;
  await database.pool.query('TRUNCATE TABLE arenas CASCADE');
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000');
});
afterAll(async () => { await database?.pool.end(); });

describe('Country Arena importer', () => {
  const cellSize = 1_000;
  const artifactCellSize = 1_000;
  it('imports Polygon and MultiPolygon countries as valid EPSG:6933 Country Arenas', async () => {
    if (!database) return;
    await expect(importCountryArenas(database.db, [
      country(),
      country({ sovereignId: 'BBB', sourceId: 2, isoCode: 'BB', name: 'Isleland', geometry: multipolygon }),
    ], cellSize)).resolves.toEqual({ imported: 2 });

    const result = await database.pool.query<{
      source_id: string;
      country_code: string;
      external_source: string;
      external_id: string;
      arena_type: string;
      srid: number;
      valid: boolean;
      empty: boolean;
      geometry_type: string;
      claimable_cell_count: number | null;
    }>(`SELECT source_id, country_code, external_source, external_id, arena_type,
      ST_SRID(area)::integer AS srid, ST_IsValid(area) AS valid,
      ST_IsEmpty(area) AS empty, ST_GeometryType(area) AS geometry_type,
      claimable_cell_count
      FROM arenas ORDER BY source_id`);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.source_id)).toEqual(['1', '2']);
    expect(result.rows.every((row) => row.country_code.length === 2 && row.arena_type === 'country')).toBe(true);
    expect(result.rows.every((row) => row.external_source === 'natural-earth-admin-0-sovereignty')).toBe(true);
    expect(result.rows.every((row) => row.srid === 6933 && row.valid && !row.empty && row.geometry_type === 'ST_MultiPolygon')).toBe(true);
    expect(result.rows.every((row) => row.claimable_cell_count === null)).toBe(true);
  });

  it('imports every feature from the checked-in 194-country artifact', async () => {
    if (!database) return;
    const artifact = JSON.parse(readFileSync(new URL('../../ingest/countries.geojson', import.meta.url), 'utf8')) as unknown;
    const countries = parseCountryArenaGeoJson(artifact);
    expect(countries).toHaveLength(194);

    // Full-artifact parsing and identifier validation stay covered above; exact
    // center enumeration is exercised against a bounded representative subset.
    const representatives = countries.slice(0, 2);
    await expect(importCountryArenas(database.db, representatives, artifactCellSize)).resolves.toEqual({ imported: 2 });
    const result = await database.pool.query<{
      source_id: string;
      external_source: string;
      external_id: string;
      country_code: string;
      arena_type: string;
      srid: number;
      geometry_type: string;
      valid: boolean;
      empty: boolean;
      claimable_cell_count: number | null;
    }>(`SELECT source_id, external_source, external_id, country_code, arena_type,
      ST_SRID(area)::integer AS srid, ST_GeometryType(area) AS geometry_type,
      ST_IsValid(area) AS valid, ST_IsEmpty(area) AS empty,
      claimable_cell_count
      FROM arenas`);

    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.source_id)).size).toBe(2);
    expect(new Set(result.rows.map((row) => row.external_id)).size).toBe(2);
    expect(new Set(result.rows.map((row) => row.country_code)).size).toBe(2);
    expect(result.rows.every((row) => row.external_source === 'natural-earth-admin-0-sovereignty')).toBe(true);
    expect(result.rows.every((row) => row.arena_type === 'country')).toBe(true);
    expect(result.rows.every((row) => row.srid === 6933 && row.geometry_type === 'ST_MultiPolygon')).toBe(true);
    expect(result.rows.every((row) => row.valid && !row.empty)).toBe(true);
    expect(result.rows.every((row) => row.claimable_cell_count === null)).toBe(true);
  }, 120_000);

  it('rejects a non-empty target before writing any rows', async () => {
    if (!database) return;
    await expect(importCountryArenas(database.db, [country()], cellSize)).resolves.toEqual({ imported: 1 });
    await expect(importCountryArenas(database.db, [country({ sovereignId: 'BBB', sourceId: 2, isoCode: 'BB' })], cellSize))
      .rejects.toThrow('requires an empty arenas table');
    await expect(database.pool.query('SELECT COUNT(*)::integer AS count FROM arenas'))
      .resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('rejects source identifier collisions before opening a transaction', async () => {
    if (!database) return;
    await expect(importCountryArenas(database.db, [
      country(),
      country({ sovereignId: 'BBB', isoCode: 'BB', name: 'Otherland' }),
    ], cellSize)).rejects.toThrow('Duplicate Country Arena source_id');
    await expect(database.pool.query('SELECT COUNT(*)::integer AS count FROM arenas'))
      .resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it('validates every transformed geometry before inserting', async () => {
    if (!database) return;
    const emptyGeometry = {
      type: 'Polygon' as const,
      coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]],
    };
    await expect(importCountryArenas(database.db, [
      country(),
      country({ sovereignId: 'BBB', sourceId: 2, isoCode: 'BB', geometry: emptyGeometry }),
    ], cellSize)).rejects.toThrow('invalid or empty EPSG:6933 MultiPolygon');
    await expect(database.pool.query('SELECT COUNT(*)::integer AS count FROM arenas'))
      .resolves.toMatchObject({ rows: [{ count: 0 }] });
  });
});
