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

export type StateArenaDefinition = { name: string; abbreviation: string; fips: string; geometries: PolygonGeometry[] };
export type StateArenaImportSummary = { created: number; updated: number; unchanged: number; rejected: number };

export function parseStateArenaGeoJson(value: unknown): StateArenaDefinition[] {
  if (!value || typeof value !== 'object' || (value as { type?: unknown }).type !== 'FeatureCollection'
    || !Array.isArray((value as { features?: unknown }).features)) {
    throw new TypeError('State input must be a GeoJSON FeatureCollection.');
  }
  const states = (value as { features: unknown[] }).features.flatMap((feature) => {
    if (!feature || typeof feature !== 'object') throw new TypeError('State input contains a malformed feature.');
    const item = feature as { properties?: Record<string, unknown>; geometry?: unknown };
    const properties = item.properties ?? {};
    const name = String(properties.NAME ?? properties.name ?? '').trim();
    const abbreviation = String(properties.STUSPS ?? properties.STUSAB ?? properties.abbreviation ?? properties.state ?? '').trim().toUpperCase();
    const fips = String(properties.STATEFP ?? properties.GEOID ?? properties.STATE ?? properties.fips ?? '').trim().padStart(2, '0');
    if (!STATE_ABBREVIATIONS.has(abbreviation)) return [];
    if (!name || !/^\d{2}$/.test(fips)) throw new TypeError(`State ${abbreviation} is missing a valid name or FIPS code.`);
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

export async function importStateArenas(database: Database, states: StateArenaDefinition[]): Promise<StateArenaImportSummary> {
  return database.transaction(async (transaction) => {
    const totals: StateArenaImportSummary = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    for (const state of states) {
      const result = await transaction.execute<{ action: 'created' | 'updated' | 'unchanged' }>(sql`
        WITH incoming AS (SELECT ${normalizedArenaGeometrySql(state.geometries)} AS area), existing AS (
          SELECT id, name, country, state, area FROM arenas
          WHERE external_source = ${CENSUS_STATE_ARENA_SOURCE} AND external_id = ${state.fips}
        ), updated AS (
          UPDATE arenas arena SET name = ${state.name}, country = 'United States', state = ${state.name},
            area = incoming.area
          FROM incoming, existing
          WHERE arena.id = existing.id AND incoming.area IS NOT NULL AND NOT ST_IsEmpty(incoming.area)
            AND (existing.name IS DISTINCT FROM ${state.name} OR existing.country IS DISTINCT FROM 'United States'
              OR existing.state IS DISTINCT FROM ${state.name} OR NOT ST_Equals(existing.area, incoming.area))
          RETURNING 'updated'::text AS action
        ), inserted AS (
          INSERT INTO arenas (source_id, name, country, state, area, external_source, external_id)
          SELECT nextval('arena_source_id_seq'), ${state.name}, 'United States', ${state.name}, incoming.area,
            ${CENSUS_STATE_ARENA_SOURCE}, ${state.fips}
          FROM incoming WHERE incoming.area IS NOT NULL AND NOT ST_IsEmpty(incoming.area)
            AND NOT EXISTS (SELECT 1 FROM existing)
          RETURNING 'created'::text AS action
        )
        SELECT action FROM updated UNION ALL SELECT action FROM inserted
        UNION ALL SELECT 'unchanged' WHERE EXISTS (SELECT 1 FROM existing) AND NOT EXISTS (SELECT 1 FROM updated)
      `);
      const action = result.rows[0]?.action;
      if (!action) throw new RangeError(`State ${state.abbreviation} produced empty geometry.`);
      totals[action] += 1;
    }
    return totals;
  });
}
