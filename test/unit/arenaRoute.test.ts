import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { arenaCountryCode, arenaPath, arenaSlug, isCanonicalArenaRoute, parseArenaSourceId } from '../../src/domain/arena/arenaRoute.js';
import { parseMysqlLaunchDump } from '../../src/domain/launch/mysqlLaunchDump.js';

describe('arena routes', () => {
  it('builds canonical country, slug, and source-id paths', () => {
    expect(arenaCountryCode('United States')).toBe('us');
    expect(arenaSlug('Böulder Ridge & West')).toBe('boulder-ridge-west');
    expect(arenaPath({ sourceId: 745, name: 'Boulder', country: 'United States' }))
      .toBe('/arena/us/boulder-745');
  });

  it('uses the final numeric suffix as identity', () => {
    expect(parseArenaSourceId('launch-42-745')).toBe(745);
    expect(parseArenaSourceId('launch')).toBeNull();
    expect(parseArenaSourceId('launch-0')).toBeNull();
  });

  it('validates the complete canonical route', () => {
    const arena = { sourceId: 745, name: 'Boulder', country: 'United States' };
    expect(isCanonicalArenaRoute(arena, 'us', 'boulder-745')).toBe(true);
    expect(isCanonicalArenaRoute(arena, 'ca', 'boulder-745')).toBe(false);
    expect(isCanonicalArenaRoute(arena, 'us', 'wrong-745')).toBe(false);
  });

  it('rejects countries without an explicit ISO mapping', () => {
    expect(() => arenaCountryCode('Unknown')).toThrow('No ISO country code');
  });

  it('maps every country in the current launch import', async () => {
    const rows = parseMysqlLaunchDump(await readFile('ingest/launches.sql', 'utf8'));
    const countries = [...new Set(rows.map((row) => row.country))];
    expect(countries.map(arenaCountryCode).every((code) => /^[a-z]{2}$/.test(code))).toBe(true);
  });
});
