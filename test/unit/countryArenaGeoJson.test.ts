import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCountryArenaGeoJson } from '../../src/domain/arena/countryGeoJson.js';

const artifact = JSON.parse(readFileSync(new URL('../../ingest/countries.geojson', import.meta.url), 'utf8')) as unknown;

describe('Country Arena GeoJSON', () => {
  it('accepts the curated Natural Earth sovereignty artifact with a locked feature count', () => {
    const countries = parseCountryArenaGeoJson(artifact);
    expect(countries).toHaveLength(194);
    expect(countries.some((country) => country.isoCode === 'AQ' || country.name === 'Antarctica')).toBe(false);
    expect(new Set(countries.map((country) => country.sovereignId)).size).toBe(countries.length);
    expect(new Set(countries.map((country) => country.sourceId)).size).toBe(countries.length);
    expect(new Set(countries.map((country) => country.isoCode)).size).toBe(countries.length);
  });

  it('rejects malformed features and non-polygon geometry', () => {
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [] }))
      .toThrow('FeatureCollection');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [{ type: 'Feature' }] }))
      .toThrow('missing properties');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({ geometry: {
      type: 'Point', coordinates: [0, 0],
    } })] })).toThrow('Polygon or MultiPolygon');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({ geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]],
    } })] })).toThrow('malformed Polygon');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({ geometry: {
      type: 'Polygon', coordinates: [[[-181, 0], [-180, 1], [-180, 0], [-181, 0]]],
    } })] })).toThrow('malformed Polygon');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({ geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]],
    } })] })).toThrow('malformed Polygon');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({ geometry: {
      type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0], [0, 0]]],
    } })] })).toThrow('malformed Polygon');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({
      properties: { sovereign_id: 'AAA', source_id: 1.5, iso_code: 'AA', name: 'Invalid source' },
    })] })).toThrow('invalid source_id');
  });

  it('rejects duplicate identifiers and Antarctica', () => {
    const first = feature();
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [first, first] }))
      .toThrow('Duplicate sovereign_id');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [
      first,
      feature({ properties: { sovereign_id: 'BBB', source_id: 1, iso_code: 'BB', name: 'Duplicate source' } }),
    ] })).toThrow('Duplicate source_id');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [
      first,
      feature({ properties: { sovereign_id: 'BBB', source_id: 2, iso_code: 'AA', name: 'Duplicate ISO' } }),
    ] })).toThrow('Duplicate iso_code');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({
      properties: { sovereign_id: 'ATA', source_id: 2, iso_code: 'AQ', name: 'Antarctica' },
    })] })).toThrow('excluded ISO-2');
    expect(() => parseCountryArenaGeoJson({ type: 'FeatureCollection', features: [feature({
      properties: { sovereign_id: 'ATA', source_id: 2, iso_code: 'ZZ', name: 'Antarctica' },
    })] })).toThrow('Antarctica');
  });
});

function feature(overrides: Partial<{
  properties: { sovereign_id: string; source_id: number; iso_code: string; name: string };
  geometry: unknown;
}> = {}) {
  const defaults = {
    type: 'Feature',
    properties: { sovereign_id: 'AAA', source_id: 1, iso_code: 'AA', name: 'Example' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  };
  return { ...defaults, ...overrides };
}
