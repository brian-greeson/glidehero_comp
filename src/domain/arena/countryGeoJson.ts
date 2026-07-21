import type { PolygonGeometry } from './geoJson.js';

export const NATURAL_EARTH_COUNTRY_SOURCE = 'natural-earth-admin-0-sovereignty';
export const NATURAL_EARTH_COUNTRY_VERSION = '5.1.1';

export type CountryArenaDefinition = {
  sovereignId: string;
  sourceId: number;
  isoCode: string;
  name: string;
  geometry: PolygonGeometry;
};

type Feature = {
  type?: unknown;
  properties?: unknown;
  geometry?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && value[0] !== undefined && value[1] !== undefined
    && value[0] >= -180 && value[0] <= 180
    && value[1] >= -90 && value[1] <= 90;
}

function isRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isPosition)) return false;
  const first = value[0];
  const last = value[value.length - 1];
  if (!(first !== undefined && last !== undefined
    && first.length === last.length
    && first.every((coordinate, index) => coordinate === last[index]))) return false;

  const vertices = value.slice(0, -1);
  if (new Set(vertices.map((vertex) => `${vertex[0]},${vertex[1]}`)).size < 3) return false;
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (current === undefined || next === undefined) return false;
    const currentLongitude = current[0];
    const currentLatitude = current[1];
    const nextLongitude = next[0];
    const nextLatitude = next[1];
    if (currentLongitude === undefined || currentLatitude === undefined
      || nextLongitude === undefined || nextLatitude === undefined) return false;
    twiceArea += currentLongitude * nextLatitude - nextLongitude * currentLatitude;
  }
  return twiceArea !== 0;
}

function parseGeometry(value: unknown, name: string): PolygonGeometry {
  if (!isRecord(value)) throw new TypeError(`Country ${name} has malformed geometry.`);
  const type = value.type;
  const coordinates = value.coordinates;
  if (type === 'Polygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0 || !coordinates.every(isRing)) {
      throw new TypeError(`Country ${name} has malformed Polygon coordinates.`);
    }
    return { type, coordinates };
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0
      || !coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isRing))) {
      throw new TypeError(`Country ${name} has malformed MultiPolygon coordinates.`);
    }
    return { type, coordinates };
  }
  throw new TypeError(`Country ${name} must have Polygon or MultiPolygon geometry.`);
}

function parseFeature(value: unknown, index: number): CountryArenaDefinition {
  if (!isRecord(value) || value.type !== 'Feature') {
    throw new TypeError(`Country input contains a malformed feature at index ${index}.`);
  }
  const feature = value as Feature;
  if (!isRecord(feature.properties)) {
    throw new TypeError(`Country feature ${index} is missing properties.`);
  }
  const properties = feature.properties;
  const sovereignId = typeof properties.sovereign_id === 'string' ? properties.sovereign_id.trim() : '';
  const sourceId = properties.source_id;
  const isoCode = typeof properties.iso_code === 'string' ? properties.iso_code.trim() : '';
  const name = typeof properties.name === 'string' ? properties.name.trim() : '';
  if (!sovereignId) throw new TypeError(`Country feature ${index} is missing sovereign_id.`);
  if (typeof sourceId !== 'number' || !Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw new TypeError(`Country ${name || index} has an invalid source_id.`);
  }
  if (!/^[A-Z]{2}$/.test(isoCode) || isoCode === 'AQ') {
    throw new TypeError(`Country ${name || index} has an invalid or excluded ISO-2 code.`);
  }
  if (!name) throw new TypeError(`Country feature ${index} is missing name.`);
  if (name.toLowerCase() === 'antarctica' || sovereignId === 'ATA') {
    throw new TypeError('Antarctica is not an accepted Country Arena.');
  }
  const geometry = parseGeometry(feature.geometry, name);
  return { sovereignId, sourceId, isoCode, name, geometry };
}

/** Parse and validate the curated country FeatureCollection. */
export function parseCountryArenaGeoJson(value: unknown): CountryArenaDefinition[] {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)
    || value.features.length === 0) {
    throw new TypeError('Country input must be a GeoJSON FeatureCollection.');
  }
  const countries = value.features.map(parseFeature);
  const sovereignIds = new Set<string>();
  const sourceIds = new Set<number>();
  const isoCodes = new Set<string>();
  for (const country of countries) {
    if (sovereignIds.has(country.sovereignId)) throw new RangeError(`Duplicate sovereign_id: ${country.sovereignId}.`);
    if (sourceIds.has(country.sourceId)) throw new RangeError(`Duplicate source_id: ${country.sourceId}.`);
    if (isoCodes.has(country.isoCode)) throw new RangeError(`Duplicate iso_code: ${country.isoCode}.`);
    sovereignIds.add(country.sovereignId);
    sourceIds.add(country.sourceId);
    isoCodes.add(country.isoCode);
  }
  return countries;
}
