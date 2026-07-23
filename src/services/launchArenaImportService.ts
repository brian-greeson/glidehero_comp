import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { launches } from '../db/schema.js';
import { resolveLaunchTimeZone } from '../domain/competition/launchTimeZone.js';
import type { LaunchImportRow } from '../domain/launch/mysqlLaunchDump.js';
import { createUserAchievementProgressService, type UserAchievementProgressService } from './userAchievementProgressService.js';
import { createUserArenaProgressService, type UserArenaProgressService } from './userArenaProgressService.js';
import { lockArenaCatalogExclusive } from './arenaCatalogLock.js';

export const XCONTEST_LAUNCH_SOURCE = 'xcontest-launch';
export const LAUNCH_COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  'united states': 'united states of america',
};

export type LaunchArenaImportSummary = { imported: number; refreshed: number };
type ImportOptions = {
  userAchievementProgress?: UserAchievementProgressService;
  userArenaProgress?: Pick<UserArenaProgressService, 'rebuildAllInTransaction'>;
  reconcileProjection?: boolean;
};

/** Names are compared case-insensitively, with source whitespace normalized. */
export function normalizeLaunchCountryName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

export function resolveLaunchCountryName(name: string, catalog: ReadonlyMap<string, { name: string; countryCode: string }>) {
  const normalized = normalizeLaunchCountryName(name);
  const canonical = LAUNCH_COUNTRY_ALIASES[normalized] ?? normalized;
  return catalog.get(canonical);
}

/** Grid indices use mathematical floor, including for negative projected coordinates. */
export function launchGridAnchor(projected: { x: number; y: number }, cellSize: number): { x: number; y: number } {
  if (!Number.isInteger(cellSize) || cellSize <= 0) throw new RangeError('Grid cell size must be a positive integer.');
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) throw new TypeError('Projected launch coordinates must be finite.');
  return { x: Math.floor(projected.x / cellSize), y: Math.floor(projected.y / cellSize) };
}

function launchGeometrySql(row: LaunchImportRow, cellSize: number) {
  const projected = sql`ST_Transform(ST_SetSRID(ST_MakePoint(${row.longitude}, ${row.latitude}), 4326), 6933)`;
  const anchorX = sql`floor(ST_X(${projected}) / ${cellSize})::bigint`;
  const anchorY = sql`floor(ST_Y(${projected}) / ${cellSize})::bigint`;
  const cells = [];
  for (let xOffset = -2; xOffset <= 2; xOffset += 1) {
    for (let yOffset = -2; yOffset <= 2; yOffset += 1) {
      cells.push(sql`ST_MakeEnvelope(
        (${anchorX} + ${xOffset}) * ${cellSize},
        (${anchorY} + ${yOffset}) * ${cellSize},
        (${anchorX} + ${xOffset} + 1) * ${cellSize},
        (${anchorY} + ${yOffset} + 1) * ${cellSize}, 6933
      )`);
    }
  }
  return sql`ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(cells, sql`, `)}]::geometry[])), 3))::geometry(multipolygon, 6933)`;
}

type CountryCatalogRow = { name: string; countryCode: string };
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function refreshLaunchSource(transaction: DatabaseTransaction, rows: LaunchImportRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += 500) {
    await transaction.insert(launches).values(rows.slice(start, start + 500)).onConflictDoUpdate({
      target: launches.id,
      set: {
        name: sql`excluded.name`, longitude: sql`excluded.longitude`, latitude: sql`excluded.latitude`,
        country: sql`excluded.country`, state: sql`excluded.state`, city: sql`excluded.city`, description: sql`excluded.description`,
        xcByMonth: sql`excluded.xc_by_month`, timezoneOffset: sql`excluded.timezone_offset`, xcByYear: sql`excluded.xc_by_year`,
        rank: sql`excluded.rank`, elevation: sql`excluded.elevation`, rank1: sql`excluded.rank_1`, rank2: sql`excluded.rank_2`,
        rank3: sql`excluded.rank_3`, rank4: sql`excluded.rank_4`, rank5: sql`excluded.rank_5`, rank6: sql`excluded.rank_6`,
        rank7: sql`excluded.rank_7`, rank8: sql`excluded.rank_8`, rank9: sql`excluded.rank_9`, rank10: sql`excluded.rank_10`,
        rank11: sql`excluded.rank_11`, rank12: sql`excluded.rank_12`, xcontestLaunchSite: sql`excluded.xcontest_launch_site`,
      },
    });
  }
}

export async function importLaunchArenas(
  database: Database,
  rows: LaunchImportRow[],
  cellSize: number,
): Promise<LaunchArenaImportSummary> {
  const progress = createUserAchievementProgressService(database, { cellSize });
  const arenaProgress = createUserArenaProgressService(database, { cellSize });
  return database.transaction((transaction) => importLaunchArenasInTransaction(transaction, rows, cellSize, {
    userAchievementProgress: progress,
    userArenaProgress: arenaProgress,
  }));
}

/** Import into a caller-owned transaction (used by the one-time rebuild). */
export async function importLaunchArenasInTransaction(
  transaction: DatabaseTransaction,
  rows: LaunchImportRow[],
  cellSize: number,
  options: ImportOptions = {},
): Promise<LaunchArenaImportSummary> {
  if (!Number.isInteger(cellSize) || cellSize <= 0) throw new RangeError('Grid cell size must be a positive integer.');
  if (rows.length === 0) throw new RangeError('Launch source is empty.');
  await lockArenaCatalogExclusive(transaction);
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new RangeError('Launch source contains duplicate IDs.');
  for (const row of rows) {
    if (!Number.isFinite(row.longitude) || row.longitude < -180 || row.longitude > 180
      || !Number.isFinite(row.latitude) || row.latitude < -90 || row.latitude > 90) {
      throw new RangeError(`Launch ${row.id} has invalid coordinates.`);
    }
  }

    const countries = await transaction.execute<CountryCatalogRow>(sql`
      SELECT name, country_code AS "countryCode"
      FROM arenas WHERE arena_type = 'country'
    `);
    if (countries.rows.length === 0) throw new Error('Launch Arena importer requires Country Arenas first.');
    const catalog = new Map(countries.rows.map((country) => [normalizeLaunchCountryName(country.name), country]));
    const resolvedCountries = new Map<string, CountryCatalogRow>();
    for (const row of rows) {
      const resolved = resolveLaunchCountryName(row.country, catalog);
      if (!resolved) throw new Error(`Launch ${row.id} has unresolved country: ${row.country}.`);
      resolvedCountries.set(row.country, resolved);
    }

    const existingLaunches = await transaction.execute<{ count: number }>(sql`
      SELECT COUNT(*)::integer AS count FROM arenas WHERE arena_type = 'launch'
    `);
    if ((existingLaunches.rows[0]?.count ?? 0) > 0) throw new Error('Launch Arena importer does not support reruns.');
    const sourceCollision = await transaction.execute<{ sourceId: string }>(sql`
      SELECT source_id AS "sourceId" FROM arenas
      WHERE source_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) LIMIT 1
    `);
    if (sourceCollision.rows.length > 0) throw new Error(`Launch Arena source ID collision: ${sourceCollision.rows[0]?.sourceId}.`);
    const externalCollision = await transaction.execute<{ externalId: string }>(sql`
      SELECT external_id AS "externalId" FROM arenas
      WHERE external_source = ${XCONTEST_LAUNCH_SOURCE}
        AND external_id IN (${sql.join(ids.map((id) => sql`${String(id)}`), sql`, `)}) LIMIT 1
    `);
    if (externalCollision.rows.length > 0) throw new Error(`Launch Arena external ID collision: ${externalCollision.rows[0]?.externalId}.`);

    // Validate all generated polygons before writing any Arena rows.
    for (const row of rows) {
      const check = await transaction.execute<{ valid: boolean; geometryType: string | null; components: number }>(sql`
        SELECT ST_IsValid(area) AS valid, ST_GeometryType(area) AS "geometryType", ST_NumGeometries(area)::integer AS components
        FROM (SELECT ${launchGeometrySql(row, cellSize)} AS area) generated
      `);
      const result = check.rows[0];
      if (!result || !result.valid || result.geometryType !== 'ST_MultiPolygon' || result.components < 1) {
        throw new RangeError(`Launch ${row.id} produced an invalid Arena geometry.`);
      }
    }

    await refreshLaunchSource(transaction, rows);
    for (const row of rows) {
      const country = resolvedCountries.get(row.country);
      if (!country) throw new Error(`Launch ${row.id} has unresolved country: ${row.country}.`);
      const timezone = resolveLaunchTimeZone({ latitude: row.latitude, longitude: row.longitude });
      await transaction.execute(sql`
        INSERT INTO arenas (
          source_id, name, country, country_code, state, city, location, altitude_meters, timezone, area,
          external_source, external_id, arena_type, claimable_cell_count
        ) VALUES (
          ${row.id}, ${row.name}, ${country.name}, ${country.countryCode.toUpperCase()}, ${row.state || null}, ${row.city || null},
          ST_SetSRID(ST_MakePoint(${row.longitude}, ${row.latitude}), 4326), ${row.elevation}, ${timezone},
          ${launchGeometrySql(row, cellSize)}, ${XCONTEST_LAUNCH_SOURCE}, ${String(row.id)}, 'launch', 25
        )
      `);
    }
    if (options.reconcileProjection !== false) {
      const progress = options.userAchievementProgress ?? createUserAchievementProgressService(transaction, { cellSize });
      const arenaProgress = options.userArenaProgress ?? createUserArenaProgressService(transaction, { cellSize });
      const snapshots = await arenaProgress.rebuildAllInTransaction(transaction);
      for (const { userId, snapshot } of snapshots) {
        await progress.upsertFromArenaSnapshotInTransaction(transaction, userId, snapshot, { promoteToComplete: true });
      }
    }
    return { imported: rows.length, refreshed: rows.length };
}
