import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { extractPolygonGeometries, type PolygonGeometry } from '../domain/arena/geoJson.js';
import { normalizedArenaGeometrySql } from './arenaGeometrySql.js';

const STATE_ABBREVIATIONS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA',
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

export const CENSUS_STATE_ARENA_SOURCE = 'us-census-state';
/** Reserved source-ID range for Census State Arenas. */
export const STATE_ARENA_SOURCE_ID_BASE = 2_000_000_000;

export type StateArenaDefinition = {
  name: string;
  abbreviation: string;
  fips: string;
  geometries: PolygonGeometry[];
};
export type StateArenaImportSummary = { imported: number };
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function stateArenaSourceId(fips: string): number {
  if (!/^\d{2}$/.test(fips)) throw new TypeError(`State FIPS must be a two-digit code: ${fips}.`);
  const numericFips = Number(fips);
  const sourceId = STATE_ARENA_SOURCE_ID_BASE + numericFips;
  if (!Number.isSafeInteger(sourceId)) throw new RangeError(`State FIPS produced an unsafe source ID: ${fips}.`);
  return sourceId;
}

export function parseStateArenaGeoJson(value: unknown): StateArenaDefinition[] {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'FeatureCollection'
    || !Array.isArray((value as { features?: unknown }).features)) {
    throw new TypeError('State input must be a GeoJSON FeatureCollection.');
  }
  const states = (value as { features: unknown[] }).features.flatMap((feature) => {
    if (!feature || typeof feature !== 'object') throw new TypeError('State input contains a malformed feature.');
    const item = feature as { properties?: Record<string, unknown>; geometry?: unknown };
    const properties = item.properties ?? {};
    const rawName = properties.NAME ?? properties.name;
    const rawAbbreviation = properties.STUSPS ?? properties.STUSAB ?? properties.abbreviation ?? properties.state;
    const rawFips = properties.STATEFP ?? properties.GEOID ?? properties.STATE ?? properties.fips;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const abbreviation = typeof rawAbbreviation === 'string' ? rawAbbreviation.trim().toUpperCase() : '';
    const fips = (typeof rawFips === 'string' || typeof rawFips === 'number')
      ? String(rawFips).trim().padStart(2, '0') : '';
    if (!STATE_ABBREVIATIONS.has(abbreviation)) return [];
    if (!name || !/^\d{2}$/.test(fips) || fips === '00') {
      throw new TypeError(`State ${abbreviation} is missing a valid name or FIPS code.`);
    }
    const geometries = extractPolygonGeometries(item.geometry);
    if (!geometries.length) throw new TypeError(`State ${abbreviation} has no polygon geometry.`);
    return [{ name, abbreviation, fips, geometries }];
  });
  if (states.length !== 50 || new Set(states.map((state) => state.fips)).size !== 50
    || new Set(states.map((state) => state.abbreviation)).size !== 50) {
    throw new RangeError(`Expected exactly 50 unique states; found ${states.length}.`);
  }
  return states;
}

type GeometryCheck = {
  areaIsNull: boolean;
  areaIsEmpty: boolean;
  areaIsValid: boolean;
  geometryType: string | null;
};

/**
 * Import the checked-in Census source as State Arenas.
 *
 * This is intentionally a one-way insert. State rows must not already exist,
 * and all transformed geometries are validated before the first insert.
 */
export async function importStateArenas(
  database: Database,
  states: StateArenaDefinition[],
): Promise<StateArenaImportSummary> {
  return database.transaction((transaction) => importStateArenasInTransaction(transaction, states));
}

/** Import into a caller-owned transaction (used by the one-time rebuild). */
export async function importStateArenasInTransaction(
  transaction: DatabaseTransaction,
  states: StateArenaDefinition[],
): Promise<StateArenaImportSummary> {
  if (states.length === 0) throw new RangeError('State Arena source is empty.');

  const sourceIds = states.map((state) => stateArenaSourceId(state.fips));
  if (new Set(sourceIds).size !== sourceIds.length) throw new RangeError('Duplicate State Arena source IDs.');
  const externalIds = states.map((state) => state.fips);
  if (new Set(externalIds).size !== externalIds.length) throw new RangeError('Duplicate State Arena FIPS codes.');

    const existingStates = await transaction.execute<{ count: number }>(sql`
      SELECT COUNT(*)::integer AS count FROM arenas WHERE arena_type = 'state'
    `);
    if ((existingStates.rows[0]?.count ?? 0) > 0) {
      throw new Error('State Arena importer requires no existing State Arenas.');
    }

    const existingSources = await transaction.execute<{ sourceId: string }>(sql`
      SELECT source_id AS "sourceId" FROM arenas
      WHERE source_id IN (${sql.join(sourceIds.map((sourceId) => sql`${sourceId}`), sql`, `)})
    `);
    if (existingSources.rows.length > 0) {
      throw new Error(`State Arena source ID collision: ${existingSources.rows[0]?.sourceId}.`);
    }

    const existingExternalIds = await transaction.execute<{ externalId: string }>(sql`
      SELECT external_id AS "externalId" FROM arenas
      WHERE external_source = ${CENSUS_STATE_ARENA_SOURCE}
        AND external_id IN (${sql.join(externalIds.map((externalId) => sql`${externalId}`), sql`, `)})
    `);
    if (existingExternalIds.rows.length > 0) {
      throw new Error(`State Arena Census FIPS collision: ${existingExternalIds.rows[0]?.externalId}.`);
    }

    // Validate every transformed geometry before writing any rows.
    for (const state of states) {
      const check = await transaction.execute<GeometryCheck>(sql`
        SELECT
          area IS NULL AS "areaIsNull",
          ST_IsEmpty(area) AS "areaIsEmpty",
          ST_IsValid(area) AS "areaIsValid",
          ST_GeometryType(area) AS "geometryType"
        FROM (SELECT ${normalizedArenaGeometrySql(state.geometries)} AS area) normalized
      `);
      const row = check.rows[0];
      if (!row || row.areaIsNull || row.areaIsEmpty || !row.areaIsValid || row.geometryType !== 'ST_MultiPolygon') {
        throw new RangeError(`State ${state.abbreviation} produced an invalid or empty EPSG:6933 MultiPolygon.`);
      }
    }

    for (const state of states) {
      await transaction.execute(sql`
        INSERT INTO arenas (
          source_id, name, country, country_code, state, area,
          external_source, external_id, arena_type,
          claimable_cell_count, claimable_cell_size
        )
        VALUES (
          ${stateArenaSourceId(state.fips)}, ${state.name}, 'United States', 'US', ${state.name},
          ${normalizedArenaGeometrySql(state.geometries)}, ${CENSUS_STATE_ARENA_SOURCE}, ${state.fips}, 'state',
          NULL, NULL
        )
      `);
    }

    return { imported: states.length };
}
