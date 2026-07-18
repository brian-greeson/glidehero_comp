import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importStateArenas, parseStateArenaGeoJson } from '../../src/services/stateArenaImportService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;
const abbreviations = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

function stateInput() {
  return { type: 'FeatureCollection', features: abbreviations.map((abbreviation, index) => {
    const longitude = -160 + index * 2;
    return {
      type: 'Feature',
      properties: { NAME: `State ${abbreviation}`, STUSPS: abbreviation, STATEFP: String(index + 1).padStart(2, '0') },
      geometry: abbreviation === 'HI'
        ? { type: 'MultiPolygon', coordinates: [
          [[[longitude, 20], [longitude, 21], [longitude + 1, 21], [longitude, 20]]],
          [[[longitude + 1.2, 20], [longitude + 1.2, 21], [longitude + 1.8, 21], [longitude + 1.2, 20]]],
        ] }
        : { type: 'Polygon', coordinates: [[[longitude, 30], [longitude, 31], [longitude + 1, 31], [longitude, 30]]] },
    };
  }) };
}

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE arenas CASCADE');
  await database.pool.query('ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000');
});
afterAll(async () => { await database.pool.end(); });

describe('state Arena importer', () => {
  it('transactionally imports fifty stable FIPS Arenas and reruns idempotently', async () => {
    const states = parseStateArenaGeoJson(stateInput());
    await expect(importStateArenas(database.db, states)).resolves.toEqual({ created: 50, updated: 0, unchanged: 0, rejected: 0 });
    const first = await database.pool.query<{ id: string; source_id: string; external_id: string; valid: boolean; parts: number }>(`
      SELECT id, source_id, external_id, ST_IsValid(area) AS valid, ST_NumGeometries(area)::integer AS parts
      FROM arenas ORDER BY external_id
    `);
    expect(first.rows).toHaveLength(50);
    expect(new Set(first.rows.map((row) => row.external_id)).size).toBe(50);
    expect(first.rows.every((row) => row.valid)).toBe(true);
    expect(first.rows.find((row) => row.external_id === String(abbreviations.indexOf('HI') + 1).padStart(2, '0'))?.parts).toBe(2);

    await expect(importStateArenas(database.db, states)).resolves.toEqual({ created: 0, updated: 0, unchanged: 50, rejected: 0 });
    const second = await database.pool.query<{ id: string; source_id: string }>('SELECT id, source_id FROM arenas ORDER BY external_id');
    expect(second.rows).toEqual(first.rows.map(({ id, source_id }) => ({ id, source_id })));
  });
});
