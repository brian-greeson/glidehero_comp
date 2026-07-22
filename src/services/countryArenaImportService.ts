import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  NATURAL_EARTH_COUNTRY_SOURCE,
  type CountryArenaDefinition,
} from '../domain/arena/countryGeoJson.js';
import { normalizedArenaGeometrySql } from './arenaGeometrySql.js';
import {
  createArenaLeadershipReconciliationService,
  type ArenaLeadershipReconciliationService,
} from './arenaLeadershipReconciliationService.js';
import { createUserAchievementProgressService, type UserAchievementProgressService } from './userAchievementProgressService.js';

export type CountryArenaImportSummary = { imported: number };
type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type ImportOptions = {
  arenaLeadership?: ArenaLeadershipReconciliationService;
  reconcile?: boolean;
  userAchievementProgress?: UserAchievementProgressService;
  reconcileProjection?: boolean;
};

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
  cellSize?: number,
  arenaLeadership?: ArenaLeadershipReconciliationService,
): Promise<CountryArenaImportSummary> {
  if (cellSize === undefined || !Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('Country Arena importer requires a positive grid cell size.');
  }
  const leadership = arenaLeadership ?? createArenaLeadershipReconciliationService(database, { cellSize });
  const progress = createUserAchievementProgressService(database, { cellSize });
  return database.transaction((transaction) => importCountryArenasInTransaction(transaction, countries, cellSize, {
    arenaLeadership: leadership,
    userAchievementProgress: progress,
  }));
}

/** Import into a caller-owned transaction (used by the one-time rebuild). */
export async function importCountryArenasInTransaction(
  transaction: DatabaseTransaction,
  countries: CountryArenaDefinition[],
  cellSize?: number,
  options: ImportOptions = {},
): Promise<CountryArenaImportSummary> {
  if (cellSize === undefined || !Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('Country Arena importer requires a positive grid cell size.');
  }
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
      const inserted = await transaction.execute<{ id: string }>(sql`
        WITH normalized AS (
          SELECT ${normalizedArenaGeometrySql([country.geometry])} AS area
        )
        INSERT INTO arenas (
          source_id, name, country, country_code, area,
          external_source, external_id, arena_type
        )
        SELECT ${country.sourceId}, ${country.name}, ${country.name}, ${country.isoCode}, normalized.area,
          ${NATURAL_EARTH_COUNTRY_SOURCE}, ${country.sovereignId}, 'country'
        FROM normalized
        RETURNING id
      `);
      if (!inserted.rows[0]) throw new RangeError(`Country ${country.isoCode} could not be inserted.`);
    }

    if (options.reconcile !== false) {
      const leadership = options.arenaLeadership;
      if (!leadership) throw new Error('Arena leadership dependencies are not configured.');
      const ids = await transaction.execute<{ id: string }>(sql`
        SELECT id FROM arenas
        WHERE arena_type = 'country'
          AND source_id IN (${sql.join([...sourceIds].map((sourceId) => sql`${sourceId}`), sql`, `)})
      `);
      await leadership.reconcileInTransaction(transaction, { arenaIds: ids.rows.map((row) => row.id) });
      if (options.reconcileProjection !== false) {
        const progress = options.userAchievementProgress ?? createUserAchievementProgressService(transaction, { cellSize });
        await progress.rebuildAllInTransaction(transaction);
      }
    }

    return { imported: countries.length };
}
