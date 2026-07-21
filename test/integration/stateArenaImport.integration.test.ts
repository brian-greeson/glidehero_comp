import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CENSUS_STATE_ARENA_SOURCE,
  importStateArenas,
  parseStateArenaGeoJson,
  stateArenaSourceId,
} from '../../src/services/stateArenaImportService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => {
  if (!database) return;
  await database.pool.query('TRUNCATE TABLE arenas CASCADE');
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000');
});
afterAll(async () => { await database?.pool.end(); });

describe('State Arena importer', () => {
  const cellSize = 1_000;
  it('imports the checked-in fifty-state Census artifact as valid EPSG:6933 State Arenas', async () => {
    if (!database) return;
    const artifact = JSON.parse(readFileSync(new URL('../../ingest/states.geojson', import.meta.url), 'utf8')) as unknown;
    const states = parseStateArenaGeoJson(artifact);
    expect(states).toHaveLength(50);
    expect(states.filter((state) => ['AK', 'HI'].includes(state.abbreviation)).every((state) => state.geometries.some((geometry) => geometry.type === 'MultiPolygon'))).toBe(true);
    const countryArtifact = JSON.parse(readFileSync(new URL('../../ingest/countries.geojson', import.meta.url), 'utf8')) as {
      features: Array<{ properties?: { source_id?: unknown } }>;
    };
    const countrySourceIds = new Set(countryArtifact.features.map((feature) => feature.properties?.source_id));
    expect(states.every((state) => !countrySourceIds.has(stateArenaSourceId(state.fips)))).toBe(true);

    const representatives = states.filter((state) => ['CO', 'NY'].includes(state.abbreviation));
    await expect(importStateArenas(database.db, representatives, cellSize)).resolves.toEqual({ imported: 2 });
    const result = await database.pool.query<{
      source_id: string;
      external_id: string;
      country: string;
      country_code: string;
      arena_type: string;
      srid: number;
      valid: boolean;
      empty: boolean;
      geometry_type: string;
      claimable_cell_count: number | null;
      claimable_cell_size: number | null;
    }>(`SELECT source_id, external_id, country, country_code, arena_type,
      ST_SRID(area)::integer AS srid, ST_IsValid(area) AS valid,
      ST_IsEmpty(area) AS empty, ST_GeometryType(area) AS geometry_type,
      claimable_cell_count, claimable_cell_size
      FROM arenas ORDER BY external_id`);

    expect(result.rows).toHaveLength(2);
    expect(new Set(result.rows.map((row) => row.external_id)).size).toBe(2);
    expect(result.rows.every((row) => row.country === 'United States' && row.country_code === 'US')).toBe(true);
    expect(result.rows.every((row) => row.arena_type === 'state')).toBe(true);
    expect(result.rows.every((row) => row.srid === 6933 && row.valid && !row.empty && row.geometry_type === 'ST_MultiPolygon')).toBe(true);
    expect(result.rows.every((row) => Number(row.source_id) === stateArenaSourceId(row.external_id))).toBe(true);
    expect(result.rows.every((row) => Number(row.claimable_cell_count) > 0 && row.claimable_cell_size === cellSize)).toBe(true);
  }, 120_000);

  it('rejects a rerun without modifying the existing State Arenas', async () => {
    if (!database) return;
    const artifact = JSON.parse(readFileSync(new URL('../../ingest/states.geojson', import.meta.url), 'utf8')) as unknown;
    const states = parseStateArenaGeoJson(artifact);
    const representatives = states.filter((state) => ['CO', 'NY'].includes(state.abbreviation));
    await importStateArenas(database.db, representatives, cellSize);
    await expect(importStateArenas(database.db, representatives, cellSize)).rejects.toThrow('no existing State Arenas');
    await expect(database.pool.query('SELECT COUNT(*)::integer AS count FROM arenas'))
      .resolves.toMatchObject({ rows: [{ count: 2 }] });
  }, 120_000);

  it('rejects a deterministic source-ID collision with a non-State Arena', async () => {
    if (!database) return;
    const artifact = JSON.parse(readFileSync(new URL('../../ingest/states.geojson', import.meta.url), 'utf8')) as unknown;
    const state = parseStateArenaGeoJson(artifact)[0];
    if (!state) throw new Error('State fixture is empty.');
    const sourceId = stateArenaSourceId(state.fips);
    await database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type)
      VALUES ($1, 'Existing General', 'Exampleland', 'ZZ',
        ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 0 1, 1 1, 0 0))'), 6933)), 'general')
    `, [sourceId]);

    await expect(importStateArenas(database.db, [state], cellSize)).rejects.toThrow('source ID collision');
    await expect(database.pool.query<{ source_id: string; arena_type: string }>(
      'SELECT source_id, arena_type FROM arenas',
    )).resolves.toMatchObject({ rows: [{ source_id: String(sourceId), arena_type: 'general' }] });
  });

  it('rejects a Census FIPS collision with a non-State Arena', async () => {
    if (!database) return;
    const artifact = JSON.parse(readFileSync(new URL('../../ingest/states.geojson', import.meta.url), 'utf8')) as unknown;
    const state = parseStateArenaGeoJson(artifact)[0];
    if (!state) throw new Error('State fixture is empty.');
    await database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id)
      VALUES (999, 'Existing General', 'Exampleland', 'ZZ',
        ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 0 1, 1 1, 0 0))'), 6933)), 'general', $1, $2)
    `, [CENSUS_STATE_ARENA_SOURCE, state.fips]);

    await expect(importStateArenas(database.db, [state], cellSize)).rejects.toThrow('Census FIPS collision');
    await expect(database.pool.query<{ source_id: string; arena_type: string; external_id: string }>(
      'SELECT source_id, arena_type, external_id FROM arenas',
    )).resolves.toMatchObject({ rows: [{ source_id: '999', arena_type: 'general', external_id: state.fips }] });
  });

  it('rolls back all writes when a transformed geometry is invalid', async () => {
    if (!database) return;
    const artifact = JSON.parse(readFileSync(new URL('../../ingest/states.geojson', import.meta.url), 'utf8')) as {
      type: string;
      features: Array<Record<string, unknown>>;
    };
    const features = artifact.features.map((feature) => ({ ...feature }));
    features[0] = {
      ...features[0],
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] },
    };
    const states = parseStateArenaGeoJson({ ...artifact, features });
    await expect(importStateArenas(database.db, states, cellSize)).rejects.toThrow('invalid or empty EPSG:6933 MultiPolygon');
    await expect(database.pool.query('SELECT COUNT(*)::integer AS count FROM arenas'))
      .resolves.toMatchObject({ rows: [{ count: 0 }] });
  }, 120_000);
});
