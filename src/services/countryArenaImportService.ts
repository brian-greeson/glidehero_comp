import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  NATURAL_EARTH_COUNTRY_SOURCE,
  type CountryArenaDefinition,
} from '../domain/arena/countryGeoJson.js';
import { normalizedArenaGeometrySql } from './arenaGeometrySql.js';

export type CountryArenaImportSummary = { imported: number };
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type GeometryCheck = {
  areaIsNull: boolean;
  areaIsEmpty: boolean;
  areaIsValid: boolean;
  geometryType: string | null;
};

/**
 * Import the checked-in sovereign-country source into an empty Arenas table.
 *
 * This is intentionally a one-way importer. The complete source is validated
 * before the first insert, and all writes occur in one transaction so a
 * failure cannot leave a partially imported set of Country Arenas.
 */
export async function importCountryArenas(
  database: Database,
  countries: CountryArenaDefinition[],
): Promise<CountryArenaImportSummary> {
  return database.transaction((transaction) => importCountryArenasInTransaction(transaction, countries));
}

/** Import into a caller-owned transaction (used by the one-time rebuild). */
export async function importCountryArenasInTransaction(
  transaction: DatabaseTransaction,
  countries: CountryArenaDefinition[],
): Promise<CountryArenaImportSummary> {
  if (countries.length === 0) throw new RangeError('Country Arena source is empty.');

  const sourceIds = new Set<number>();
  const isoCodes = new Set<string>();
  const sovereignIds = new Set<string>();
  for (const country of countries) {
    if (!/^[A-Z]{2}$/.test(country.isoCode)) {
      throw new TypeError(`Country Arena country_code must be an uppercase ISO-2 code: ${country.isoCode}.`);
    }
    if (sourceIds.has(country.sourceId)) throw new RangeError(`Duplicate Country Arena source_id: ${country.sourceId}.`);
    if (isoCodes.has(country.isoCode)) throw new RangeError(`Duplicate Country Arena country_code: ${country.isoCode}.`);
    if (sovereignIds.has(country.sovereignId)) throw new RangeError(`Duplicate Country Arena external_id: ${country.sovereignId}.`);
    sourceIds.add(country.sourceId);
    isoCodes.add(country.isoCode);
    sovereignIds.add(country.sovereignId);
  }

    const existing = await transaction.execute<{ count: number }>(sql`
      SELECT COUNT(*)::integer AS count FROM arenas
    `);
    const existingCount = existing.rows[0]?.count ?? 0;
    if (existingCount > 0) {
      throw new Error(`Country Arena importer requires an empty arenas table; found ${existingCount} rows.`);
    }

    // Validate every transformed geometry before writing any rows.
    for (const country of countries) {
      const check = await transaction.execute<GeometryCheck>(sql`
        SELECT
          area IS NULL AS "areaIsNull",
          ST_IsEmpty(area) AS "areaIsEmpty",
          ST_IsValid(area) AS "areaIsValid",
          ST_GeometryType(area) AS "geometryType"
        FROM (SELECT ${normalizedArenaGeometrySql([country.geometry])} AS area) normalized
      `);
      const row = check.rows[0];
      if (!row || row.areaIsNull || row.areaIsEmpty || !row.areaIsValid || row.geometryType !== 'ST_MultiPolygon') {
        throw new RangeError(`Country ${country.isoCode} produced an invalid or empty EPSG:6933 MultiPolygon.`);
      }
    }

    for (const country of countries) {
      await transaction.execute(sql`
        INSERT INTO arenas (
          source_id, name, country, country_code, area,
          external_source, external_id, arena_type,
          claimable_cell_count, claimable_cell_size
        )
        VALUES (
          ${country.sourceId}, ${country.name}, ${country.name}, ${country.isoCode},
          ${normalizedArenaGeometrySql([country.geometry])},
          ${NATURAL_EARTH_COUNTRY_SOURCE}, ${country.sovereignId}, 'country',
          NULL, NULL
        )
      `);
    }

    return { imported: countries.length };
}
