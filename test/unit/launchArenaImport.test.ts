import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCountryArenaGeoJson } from '../../src/domain/arena/countryGeoJson.js';
import { parseMysqlLaunchDump } from '../../src/domain/launch/mysqlLaunchDump.js';
import {
  LAUNCH_COUNTRY_ALIASES,
  normalizeLaunchCountryName,
  resolveLaunchCountryName,
} from '../../src/services/launchArenaImportService.js';

describe('Launch Arena source country catalog', () => {
  it('resolves every country in the checked-in launch dump against the country artifact', () => {
    const launches = parseMysqlLaunchDump(readFileSync('ingest/launches.sql', 'utf8'));
    const countries = parseCountryArenaGeoJson(JSON.parse(readFileSync('ingest/countries.geojson', 'utf8')));
    const catalog = new Map(countries.map((country) => [normalizeLaunchCountryName(country.name), { name: country.name, countryCode: country.isoCode }]));
    const sourceCountries = [...new Set(launches.map((launch) => launch.country))];
    expect(sourceCountries.every((country) => resolveLaunchCountryName(country, catalog))).toBe(true);
    const directlyUnresolved = sourceCountries.filter((country) => !catalog.has(normalizeLaunchCountryName(country)));
    expect(directlyUnresolved).toEqual(['United States']);
    expect(Object.keys(LAUNCH_COUNTRY_ALIASES)).toEqual(['united states']);
    expect(LAUNCH_COUNTRY_ALIASES['united states']).toBe('united states of america');
  });
});
