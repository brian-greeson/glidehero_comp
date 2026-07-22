import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../db/client.js';
import { parseCountryArenaGeoJson } from '../domain/arena/countryGeoJson.js';
import { parseMysqlLaunchDump } from '../domain/launch/mysqlLaunchDump.js';
import { importCountryArenasInTransaction } from '../services/countryArenaImportService.js';
import { importLaunchArenasInTransaction, normalizeLaunchCountryName, LAUNCH_COUNTRY_ALIASES } from '../services/launchArenaImportService.js';
import { importStateArenasInTransaction, parseStateArenaGeoJson } from '../services/stateArenaImportService.js';
import type { Database } from '../db/client.js';
import { createArenaLeadershipReconciliationService } from '../services/arenaLeadershipReconciliationService.js';

const CONFIRM_FLAG = '--confirm-delete-all-arenas';
const APPLY_FLAG = '--apply';
const DRY_RUN_FLAG = '--dry-run';
const HELP_FLAG = '--help';
const DEFAULT_CELL_SIZE = 500;

export type RebuildOptions = { apply: boolean; countryPath: string; statePath: string; launchPath: string };
export type RebuildSummary = {
  deleted: number;
  inserted: { country: number; state: number; launch: number; general: number };
  refreshedLaunches: number;
  dryRun: boolean;
};

class DryRunRollback extends Error {
  constructor(public readonly summary: RebuildSummary) {
    super('dry-run rollback');
  }
}

export function parseRebuildArgs(argv: string[]): RebuildOptions {
  for (const flag of [APPLY_FLAG, DRY_RUN_FLAG, CONFIRM_FLAG, HELP_FLAG]) {
    if (argv.filter((arg) => arg === flag).length > 1) throw new Error(`Duplicate ${flag} flag.`);
  }
  let apply = false;
  let dryRun = false;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === APPLY_FLAG) { apply = true; continue; }
    if (arg === DRY_RUN_FLAG) { dryRun = true; continue; }
    if (arg === CONFIRM_FLAG || arg === HELP_FLAG) continue;
    if (arg.startsWith('-')) throw new Error(`Unknown rebuild flag: ${arg}`);
    positional.push(arg);
  }
  if (argv.includes(HELP_FLAG)) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other flags or source paths.');
    return {
      apply: false,
      countryPath: resolve('ingest/countries.geojson'),
      statePath: resolve('ingest/states.geojson'),
      launchPath: resolve('ingest/launches.sql'),
    };
  }
  if (apply && dryRun) throw new Error('--apply and --dry-run cannot be used together.');
  if (apply && !argv.includes(CONFIRM_FLAG)) throw new Error(`--apply requires ${CONFIRM_FLAG}.`);
  if (!apply && argv.includes(CONFIRM_FLAG)) throw new Error(`${CONFIRM_FLAG} requires --apply.`);
  if (positional.length > 3) throw new Error('Expected at most country, state, and launch source paths.');
  return {
    apply,
    countryPath: resolve(positional[0] ?? 'ingest/countries.geojson'),
    statePath: resolve(positional[1] ?? 'ingest/states.geojson'),
    launchPath: resolve(positional[2] ?? 'ingest/launches.sql'),
  };
}

function cellSizeFromEnvironment(): number {
  return DEFAULT_CELL_SIZE;
}

function validateLaunchSource(rows: ReturnType<typeof parseMysqlLaunchDump>, countries: ReturnType<typeof parseCountryArenaGeoJson>): void {
  const ids = new Set<number>();
  const catalog = new Set(countries.map((country) => normalizeLaunchCountryName(country.name)));
  for (const row of rows) {
    if (ids.has(row.id)) throw new RangeError(`Launch source contains duplicate IDs: ${row.id}.`);
    ids.add(row.id);
    if (!Number.isFinite(row.longitude) || row.longitude < -180 || row.longitude > 180
      || !Number.isFinite(row.latitude) || row.latitude < -90 || row.latitude > 90) {
      throw new RangeError(`Launch ${row.id} has invalid coordinates.`);
    }
    const normalized = normalizeLaunchCountryName(row.country);
    const canonical = LAUNCH_COUNTRY_ALIASES[normalized] ?? normalized;
    if (!catalog.has(canonical)) throw new Error(`Launch ${row.id} has unresolved country: ${row.country}.`);
  }
}

async function verifyRebuild(transaction: Parameters<Parameters<Database['transaction']>[0]>[0], expected: { country: number; state: number; launch: number }, cellSize: number): Promise<void> {
  const counts = await transaction.execute<{ arenaType: string; count: number }>(sql`
    SELECT arena_type AS "arenaType", COUNT(*)::integer AS count FROM arenas GROUP BY arena_type
  `);
  const actual = new Map(counts.rows.map((row) => [row.arenaType, row.count]));
  if (actual.get('country') !== expected.country || actual.get('state') !== expected.state || actual.get('launch') !== expected.launch || (actual.get('general') ?? 0) !== 0 || actual.size !== 3) {
    throw new Error(`Arena type counts do not match sources: ${JSON.stringify(Object.fromEntries(actual))}.`);
  }
  const checks = await transaction.execute<{ duplicateSources: number; duplicateExternal: number; missingExternal: number; badIso: number; badGeometry: number; badClaims: number }>(sql`
    SELECT
      (SELECT COUNT(*) - COUNT(DISTINCT source_id) FROM arenas) AS "duplicateSources",
      (SELECT COUNT(*) FROM (SELECT external_source, external_id FROM arenas WHERE external_source IS NOT NULL AND external_id IS NOT NULL GROUP BY external_source, external_id HAVING COUNT(*) > 1) duplicates) AS "duplicateExternal",
      (SELECT COUNT(*) FROM arenas WHERE arena_type IN ('country', 'state', 'launch') AND (external_source IS NULL OR external_id IS NULL)) AS "missingExternal",
      (SELECT COUNT(*) FROM arenas WHERE country_code !~ '^[A-Z]{2}$' OR country_code <> UPPER(country_code)) AS "badIso",
      (SELECT COUNT(*) FROM arenas WHERE area IS NULL OR ST_IsEmpty(area) OR NOT ST_IsValid(area) OR ST_GeometryType(area) <> 'ST_MultiPolygon' OR ST_SRID(area) <> 6933) AS "badGeometry",
      (SELECT COUNT(*) FROM arenas WHERE arena_type = 'launch' AND claimable_cell_count <> 25) AS "badClaims"
  `);
  const result = checks.rows[0];
  if (!result || Object.values(result).some((value) => Number(value) !== 0)) throw new Error(`Arena rebuild verification failed: ${JSON.stringify(result)}.`);
}

export async function rebuildArenas(database: Database, countries: ReturnType<typeof parseCountryArenaGeoJson>, states: ReturnType<typeof parseStateArenaGeoJson>, launches: ReturnType<typeof parseMysqlLaunchDump>, cellSize: number, apply: boolean): Promise<RebuildSummary> {
  let summary: RebuildSummary | undefined;
  try {
    const arenaLeadership = createArenaLeadershipReconciliationService(database, { cellSize });
    await database.transaction(async (transaction) => {
      const deletedResult = await transaction.execute<{ count: number }>(sql`SELECT COUNT(*)::integer AS count FROM arenas`);
      const deleted = deletedResult.rows[0]?.count ?? 0;
      await transaction.execute(sql`DELETE FROM arenas`);
      await transaction.execute(sql`ALTER SEQUENCE arena_source_id_seq RESTART WITH 10000`);
      const country = await importCountryArenasInTransaction(transaction, countries, cellSize, { reconcile: false });
      const state = await importStateArenasInTransaction(transaction, states, cellSize, { reconcile: false });
      const launch = await importLaunchArenasInTransaction(transaction, launches, cellSize);
      const eligibleIds = await transaction.execute<{ id: string }>(sql`
        SELECT id FROM arenas WHERE arena_type IN ('country', 'state')
        ORDER BY id
      `);
      await arenaLeadership.reconcileInTransaction(transaction, { arenaIds: eligibleIds.rows.map((row) => row.id) });
      await verifyRebuild(transaction, { country: country.imported, state: state.imported, launch: launch.imported }, cellSize);
      summary = { deleted, inserted: { country: country.imported, state: state.imported, launch: launch.imported, general: 0 }, refreshedLaunches: launch.refreshed, dryRun: !apply };
      if (!apply) throw new DryRunRollback(summary);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.summary;
    throw error;
  }
  if (!summary) throw new Error('Arena rebuild did not produce a summary.');
  return summary;
}

async function main(): Promise<void> {
  const options = parseRebuildArgs(process.argv.slice(2));
  if (process.argv.includes(HELP_FLAG)) {
    console.log('Usage: npm run rebuild:arenas -- [--dry-run] [--apply --confirm-delete-all-arenas] [country.geojson state.geojson launches.sql]');
    return;
  }
  const cellSize = cellSizeFromEnvironment();
  const countries = parseCountryArenaGeoJson(JSON.parse(await readFile(options.countryPath, 'utf8')) as unknown);
  const states = parseStateArenaGeoJson(JSON.parse(await readFile(options.statePath, 'utf8')) as unknown);
  const launches = parseMysqlLaunchDump(await readFile(options.launchPath, 'utf8'));
  validateLaunchSource(launches, countries);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = createDatabase(databaseUrl);
  try {
    const summary = await rebuildArenas(database.db, countries, states, launches, cellSize, options.apply);
    console.log(`${summary.dryRun ? 'Dry-run' : 'Applied'} Arena rebuild: deleted ${summary.deleted}; inserted Country ${summary.inserted.country}, State ${summary.inserted.state}, Launch ${summary.inserted.launch}, General ${summary.inserted.general}; refreshed ${summary.refreshedLaunches} launches.`);
  } finally {
    await database.pool.end();
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) await main();
