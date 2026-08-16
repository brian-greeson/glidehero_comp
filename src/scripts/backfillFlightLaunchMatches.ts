import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';
import { FLIGHT_LAUNCH_MATCH_VERSION } from '../domain/launch/flightLaunchMatch.js';
import { lockArenaCatalogShared } from '../services/arenaCatalogLock.js';
import {
  matchNearestCatalogLaunch,
  type FlightLaunchMatch,
} from '../services/flightLaunchMatchService.js';

export const DEFAULT_FLIGHT_LAUNCH_BACKFILL_BATCH_SIZE = 100;
export const DEFAULT_FLIGHT_LAUNCH_BACKFILL_LIMIT = 1_000;

export type FlightLaunchBackfillCandidate = {
  id: string;
  launchLatitude: number | string | null;
  launchLongitude: number | string | null;
};

export type FlightLaunchBackfillSummary = {
  mode: 'dry-run' | 'apply';
  inspected: number;
  matched: number;
  unknown: number;
  written: number;
  failed: number;
  limited: boolean;
};

type Logger = Pick<Console, 'log' | 'error'>;

function positiveInteger(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

export function parseFlightLaunchBackfillArgs(argv: string[]) {
  let apply = false;
  let seenApply = false;
  let seenDryRun = false;
  let batchSize = DEFAULT_FLIGHT_LAUNCH_BACKFILL_BATCH_SIZE;
  let limit = DEFAULT_FLIGHT_LAUNCH_BACKFILL_LIMIT;
  if (argv.includes('--help')) return { help: true, apply, batchSize, limit };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      if (seenApply) throw new Error('Duplicate --apply flag.');
      if (seenDryRun) throw new Error('--apply and --dry-run cannot be used together.');
      seenApply = true; apply = true;
    } else if (arg === '--dry-run') {
      if (seenDryRun) throw new Error('Duplicate --dry-run flag.');
      if (seenApply) throw new Error('--apply and --dry-run cannot be used together.');
      seenDryRun = true; apply = false;
    } else if (arg === '--batch-size' || arg?.startsWith('--batch-size=')) {
      const raw = arg === '--batch-size' ? argv[++index] : arg.slice('--batch-size='.length);
      batchSize = positiveInteger(raw, 'Batch size');
    } else if (arg === '--limit' || arg?.startsWith('--limit=')) {
      const raw = arg === '--limit' ? argv[++index] : arg.slice('--limit='.length);
      limit = positiveInteger(raw, 'Limit');
    } else throw new Error(`Unknown argument: ${arg ?? ''}`);
  }
  return { help: false, apply, batchSize, limit };
}

export async function selectFlightLaunchBackfillBatch(
  database: Pick<Database, 'execute'>,
  cursor: string | undefined,
  limit: number,
): Promise<FlightLaunchBackfillCandidate[]> {
  const cursorSql = cursor ? sql`AND flight.flight_id > ${cursor}` : sql``;
  const result = await database.execute<FlightLaunchBackfillCandidate>(sql`
    SELECT flight.flight_id AS id,
      flight.launch_latitude AS "launchLatitude",
      flight.launch_longitude AS "launchLongitude"
    FROM flights flight
    WHERE flight.processing_status = 'completed'
      AND flight.launch_match_version IS DISTINCT FROM ${FLIGHT_LAUNCH_MATCH_VERSION}
      ${cursorSql}
    ORDER BY flight.flight_id
    LIMIT ${limit}
  `);
  return result.rows;
}

export async function reconcileFlightLaunchCandidate(
  database: Database,
  candidate: FlightLaunchBackfillCandidate,
): Promise<FlightLaunchMatch & { written: boolean }> {
  return database.transaction(async (tx) => {
    await lockArenaCatalogShared(tx);
    const match = await matchNearestCatalogLaunch(tx, {
      latitude: candidate.launchLatitude === null ? null : Number(candidate.launchLatitude),
      longitude: candidate.launchLongitude === null ? null : Number(candidate.launchLongitude),
    });
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE flights
      SET launch_id = ${match.launchId},
        launch_match_version = ${FLIGHT_LAUNCH_MATCH_VERSION},
        updated_at = now()
      WHERE flight_id = ${candidate.id}
        AND processing_status = 'completed'
        AND launch_match_version IS DISTINCT FROM ${FLIGHT_LAUNCH_MATCH_VERSION}
      RETURNING flight_id AS id
    `);
    return { ...match, written: result.rows.length > 0 };
  });
}

export async function runFlightLaunchBackfill(
  database: Database,
  options: {
    apply: boolean;
    batchSize?: number;
    limit?: number;
    logger?: Logger;
    listCandidates?: (cursor: string | undefined, limit: number) => Promise<FlightLaunchBackfillCandidate[]>;
    matchCandidate?: (candidate: FlightLaunchBackfillCandidate) => Promise<FlightLaunchMatch>;
    reconcileCandidate?: (candidate: FlightLaunchBackfillCandidate) => Promise<FlightLaunchMatch & { written: boolean }>;
  },
): Promise<FlightLaunchBackfillSummary> {
  const logger = options.logger ?? console;
  const batchSize = options.batchSize ?? DEFAULT_FLIGHT_LAUNCH_BACKFILL_BATCH_SIZE;
  const limit = options.limit ?? DEFAULT_FLIGHT_LAUNCH_BACKFILL_LIMIT;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('Batch size must be a positive integer.');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Limit must be a positive integer.');
  const listCandidates = options.listCandidates
    ?? ((cursor, candidateLimit) => selectFlightLaunchBackfillBatch(database, cursor, candidateLimit));
  const matchCandidate = options.matchCandidate ?? ((candidate) => matchNearestCatalogLaunch(database, {
    latitude: candidate.launchLatitude === null ? null : Number(candidate.launchLatitude),
    longitude: candidate.launchLongitude === null ? null : Number(candidate.launchLongitude),
  }));
  const reconcileCandidate = options.reconcileCandidate
    ?? ((candidate) => reconcileFlightLaunchCandidate(database, candidate));
  const summary: FlightLaunchBackfillSummary = {
    mode: options.apply ? 'apply' : 'dry-run',
    inspected: 0,
    matched: 0,
    unknown: 0,
    written: 0,
    failed: 0,
    limited: false,
  };
  let cursor: string | undefined;
  let batchNumber = 0;
  logger.log(`Starting flight launch backfill in ${summary.mode} mode (batch size ${batchSize}, limit ${limit}).`);
  while (summary.inspected < limit) {
    const remaining = limit - summary.inspected;
    const requestedBatchSize = Math.min(batchSize, remaining);
    const batch = await listCandidates(cursor, requestedBatchSize);
    if (!batch.length) break;
    batchNumber += 1;
    const before = { ...summary };
    logger.log(`Batch ${batchNumber}: processing ${batch.length} flight${batch.length === 1 ? '' : 's'}.`);
    for (const candidate of batch) {
      summary.inspected += 1;
      try {
        const result = options.apply
          ? await reconcileCandidate(candidate)
          : { ...await matchCandidate(candidate), written: false };
        if (result.launchId === null) summary.unknown += 1;
        else summary.matched += 1;
        if (result.written) summary.written += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(`Unable to reconcile launch for flight ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    cursor = batch.at(-1)!.id;
    logger.log(
      `Batch ${batchNumber} complete: inspected ${summary.inspected}/${limit} total; `
      + `batch matched ${summary.matched - before.matched}, Unknown ${summary.unknown - before.unknown}, `
      + `written ${summary.written - before.written}, failed ${summary.failed - before.failed}.`,
    );
    if (batch.length < requestedBatchSize) break;
  }
  if (summary.inspected === limit) summary.limited = (await listCandidates(cursor, 1)).length > 0;
  logger.log(
    `Flight launch backfill ${summary.limited ? 'stopped at the configured limit' : 'complete'}: `
    + `inspected ${summary.inspected}, matched ${summary.matched}, Unknown ${summary.unknown}, `
    + `written ${summary.written}, failed ${summary.failed}.`,
  );
  return summary;
}

async function main(): Promise<void> {
  const args = parseFlightLaunchBackfillArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run backfill:flight-launches [-- --dry-run|--apply] [--batch-size N] [--limit N]');
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const { db, pool } = createDatabase(databaseUrl);
  try {
    const summary = await runFlightLaunchBackfill(db, args);
    console.log(summary);
    if (summary.failed || summary.limited) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
