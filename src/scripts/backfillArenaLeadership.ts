import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { createDatabase } from '../db/client.js';
import { awardAchievement } from '../services/achievementService.js';
import { claimableCellCountSql } from '../services/arenaGeometrySql.js';
import { createArenaLeadershipReconciliationService, type ArenaLeadershipReconciliationResult } from '../services/arenaLeadershipReconciliationService.js';
import type { AchievementKey } from '../domain/achievement/catalog.js';
import { gridClaimCandidateCtes } from '../services/gridClaimCandidates.js';

const usage = `Usage: npm run backfill:arena-leadership [-- --dry-run|--apply]

The default is a dry-run. Apply mode commits Arena batches independently. Pause
and drain workers, and avoid Arena edits or admin claim mutations during apply.
Prior committed batches may remain applied if a later batch fails.
Set ARENA_LEADERSHIP_BACKFILL_BATCH_SIZE to control the positive Arena batch size (default 25).
`;
const DEFAULT_BATCH_SIZE = 25;
const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';

type Logger = Pick<Console, 'log' | 'error'>;
export type ArenaLeadershipBackfillArgs = { apply: boolean; help: boolean };

export function parseArenaLeadershipBackfillArgs(argv: string[]): ArenaLeadershipBackfillArgs {
  if (argv.includes(HELP)) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other flags.');
    return { apply: false, help: true };
  }
  let apply = false;
  let seenApply = false;
  let seenDry = false;
  for (const arg of argv) {
    if (arg === APPLY) {
      if (seenApply) throw new Error('Duplicate --apply flag.');
      seenApply = true; apply = true; continue;
    }
    if (arg === DRY_RUN) {
      if (seenDry) throw new Error('Duplicate --dry-run flag.');
      seenDry = true; continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
  }
  if (seenApply && seenDry) throw new Error('--apply and --dry-run cannot be used together.');
  return { apply, help: false };
}

export type ArenaLeadershipBackfillSummary = {
  claimTimestampFlightsInspected: number;
  claimTimestampsChanged: number;
  arenasInspected: number;
  arenasReconciled: number;
  denominatorsPopulated: number;
  denominatorsChanged: number;
  leadershipEventsBuilt: number;
  /** Pilot counts, not Arena counts: each sole/joint leader contributes once. */
  currentSoleLeaders: number;
  currentJointLeaders: number;
  tookAwards: number;
  reclaimedAwards: number;
  alreadyEarnedOrUnchanged: number;
  failures: number;
  dryRun: boolean;
  committedBatchesMayRemain: boolean;
};

type ArenaRow = { id: string; arenaType: string; claimableCellCount: number | string | null; claimableCellSize: number | string | null };
type FlightRow = { flightId: string; launchTimezone: string };
type Candidate = { userId: string; key: AchievementKey; earnedAt: Date; sourceFlightId: string; arenaId: string; arenaName: string; eventKey: string };

function emptySummary(dryRun: boolean): ArenaLeadershipBackfillSummary {
  return { claimTimestampFlightsInspected: 0, claimTimestampsChanged: 0, arenasInspected: 0, arenasReconciled: 0, denominatorsPopulated: 0, denominatorsChanged: 0, leadershipEventsBuilt: 0, currentSoleLeaders: 0, currentJointLeaders: 0, tookAwards: 0, reclaimedAwards: 0, alreadyEarnedOrUnchanged: 0, failures: 0, dryRun, committedBatchesMayRemain: false };
}

class RollbackDryRun extends Error {}

export class ArenaLeadershipBackfillError extends Error {
  constructor(public readonly summary: ArenaLeadershipBackfillSummary, cause: unknown) {
    super(`Arena leadership backfill failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ArenaLeadershipBackfillError';
  }
}

function batch<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
}

function candidateFromResult(result: ArenaLeadershipReconciliationResult): Candidate[] {
  return (result.qualifyingEvents ?? []).map(({ arenaId, arenaName, event }) => ({
    userId: event.userId,
    key: event.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena',
    earnedAt: event.claimTimestamp,
    sourceFlightId: event.sourceFlightId,
    arenaId,
    arenaName,
    eventKey: event.eventKey,
  }));
}

async function selectArenas(database: Pick<Database, 'execute'>): Promise<ArenaRow[]> {
  const result = await database.execute<ArenaRow>(sql`
    SELECT id, arena_type AS "arenaType", claimable_cell_count AS "claimableCellCount",
           claimable_cell_size AS "claimableCellSize"
    FROM arenas
    WHERE arena_type IN ('general', 'state', 'country')
    ORDER BY id
  `);
  return result.rows;
}

async function selectTimestampFlights(database: Pick<Database, 'execute'>): Promise<FlightRow[]> {
  const result = await database.execute<FlightRow>(sql`
    SELECT DISTINCT flight.flight_id AS "flightId", flight.launch_timezone AS "launchTimezone"
    FROM flights flight
    INNER JOIN competition_grid_claims claim ON claim.claim_flight = flight.flight_id
    WHERE flight.launch_timezone IS NOT NULL
      AND EXISTS (SELECT 1 FROM track_points point WHERE point.flight_id = flight.flight_id)
    ORDER BY flight.flight_id
  `);
  return result.rows;
}

async function correctClaimTimestampBatch(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  flights: FlightRow[],
  cellSize: number,
  summary: ArenaLeadershipBackfillSummary,
): Promise<void> {
  for (const flight of flights) {
    const corrected = await transaction.execute(sql`
      ${gridClaimCandidateCtes({ flightId: flight.flightId, cellSize })},
      competition_events AS (
        SELECT
          date_trunc('month', claim_timestamp AT TIME ZONE ${flight.launchTimezone})::date AS competition_month,
          x, y, claim_timestamp
        FROM candidate_events
      ), first_claims AS (
        SELECT competition_month, x, y, MIN(claim_timestamp) AS claim_timestamp
        FROM competition_events
        GROUP BY competition_month, x, y
      )
      UPDATE competition_grid_claims claim
      SET claim_timestamp = first_claims.claim_timestamp
      FROM first_claims
      WHERE claim.claim_flight = ${flight.flightId}
        AND claim.cell_size = ${cellSize}
        AND claim.competition_month = first_claims.competition_month
        AND claim.x = first_claims.x AND claim.y = first_claims.y
        AND claim.claim_timestamp IS DISTINCT FROM first_claims.claim_timestamp
      RETURNING claim.claim_flight
    `);
    summary.claimTimestampFlightsInspected += 1;
    summary.claimTimestampsChanged += corrected.rows.length;
  }
}

async function processBatch(
  transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
  arenas: ArenaRow[],
  cellSize: number,
  summary: ArenaLeadershipBackfillSummary,
): Promise<Candidate[]> {
  const ids = arenas.map((arena) => arena.id);
  const candidates: Candidate[] = [];
  for (const arena of arenas) {
    const countResult = await transaction.execute<{ count: number | string }>(sql`
      SELECT ${claimableCellCountSql({ area: sql`arena.area`, cellSize: sql`${cellSize}` })} AS count
      FROM arenas arena WHERE arena.id = ${arena.id}
    `);
    const count = Number(countResult.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`Arena ${arena.id} has no positive claimable cells.`);
    if (arena.claimableCellCount === null) summary.denominatorsPopulated += 1;
    if (Number(arena.claimableCellCount) !== count || Number(arena.claimableCellSize) !== cellSize) summary.denominatorsChanged += 1;
    await transaction.execute(sql`UPDATE arenas SET claimable_cell_count = ${count}, claimable_cell_size = ${cellSize} WHERE id = ${arena.id}`);
  }
  const leadership = createArenaLeadershipReconciliationService(transaction as unknown as Database, { cellSize });
  const result = await leadership.reconcileInTransaction(transaction, { arenaIds: ids, awardAchievements: false });
  summary.arenasReconciled += result.arenas.length;
  summary.leadershipEventsBuilt += result.eventsBuilt;
  for (const arenaResult of result.arenas) {
    if (arenaResult.currentLeaderUserIds.length > 1) summary.currentJointLeaders += arenaResult.currentLeaderUserIds.length;
    else if (arenaResult.currentLeaderUserIds.length === 1) summary.currentSoleLeaders += 1;
  }
  candidates.push(...candidateFromResult(result));
  return candidates;
}

function chooseEarliest(candidates: Candidate[]): Candidate[] {
  const selected = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.userId}:${candidate.key}`;
    const existing = selected.get(key);
    if (!existing || candidate.earnedAt.getTime() < existing.earnedAt.getTime()
      || (candidate.earnedAt.getTime() === existing.earnedAt.getTime() && `${candidate.arenaId}:${candidate.eventKey}` < `${existing.arenaId}:${existing.eventKey}`)) selected.set(key, candidate);
  }
  return [...selected.values()].sort((a, b) => `${a.userId}:${a.key}`.localeCompare(`${b.userId}:${b.key}`));
}

export async function runArenaLeadershipBackfill(database: Database, options: { apply: boolean; cellSize: number; batchSize?: number; logger?: Logger }): Promise<ArenaLeadershipBackfillSummary> {
  const logger = options.logger ?? console;
  const summary = emptySummary(!options.apply);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new RangeError('Arena leadership backfill batch size must be a positive integer.');
  const arenas = await selectArenas(database);
  const timestampFlights = await selectTimestampFlights(database);
  summary.arenasInspected = arenas.length;
  const candidates: Candidate[] = [];
  let committed = 0;
  const award = async (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => {
    for (const candidate of chooseEarliest(candidates)) {
      const result = await awardAchievement(tx, { userId: candidate.userId, key: candidate.key, earnedAt: candidate.earnedAt, sourceFlightId: candidate.sourceFlightId, details: { arenaId: candidate.arenaId, arenaName: candidate.arenaName } });
      if (result.newlyEarned) {
        if (candidate.key === 'took_lead_in_arena') summary.tookAwards += 1; else summary.reclaimedAwards += 1;
      } else summary.alreadyEarnedOrUnchanged += 1;
    }
  };
  try {
    if (!options.apply) {
      try {
        await database.transaction(async (tx) => {
          for (const [index, flightBatch] of batch(timestampFlights, batchSize).entries()) {
            logger.log(`Correcting claim timestamp batch ${index + 1} / ${Math.ceil(timestampFlights.length / batchSize)}`);
            await correctClaimTimestampBatch(tx, flightBatch, options.cellSize, summary);
          }
          for (const [index, arenaBatch] of batch(arenas, batchSize).entries()) {
            logger.log(`Reconciling Arena batch ${index + 1} / ${Math.ceil(arenas.length / batchSize)}`);
            candidates.push(...await processBatch(tx, arenaBatch, options.cellSize, summary));
          }
          await award(tx);
          throw new RollbackDryRun();
        });
      } catch (error) {
        if (!(error instanceof RollbackDryRun)) throw error;
      }
      return summary;
    }

    for (const [index, flightBatch] of batch(timestampFlights, batchSize).entries()) {
      logger.log(`Correcting claim timestamp batch ${index + 1} / ${Math.ceil(timestampFlights.length / batchSize)}`);
      await database.transaction((tx) => correctClaimTimestampBatch(tx, flightBatch, options.cellSize, summary));
      committed += 1;
    }
    for (const [index, arenaBatch] of batch(arenas, batchSize).entries()) {
      logger.log(`Reconciling Arena batch ${index + 1} / ${Math.ceil(arenas.length / batchSize)}`);
      candidates.push(...await database.transaction((tx) => processBatch(tx, arenaBatch, options.cellSize, summary)));
      committed += 1;
    }
    await database.transaction(award);
    return summary;
  } catch (error) {
    summary.failures += 1;
    summary.committedBatchesMayRemain = options.apply && committed > 0;
    throw new ArenaLeadershipBackfillError(summary, error);
  }
}

export function printArenaLeadershipBackfillSummary(summary: ArenaLeadershipBackfillSummary, logger: Logger = console): void {
  logger.log(`${summary.dryRun ? 'Dry-run' : 'Applied'} Arena leadership backfill`);
  logger.log(`Claim timestamp flights inspected/cells changed: ${summary.claimTimestampFlightsInspected}/${summary.claimTimestampsChanged}`);
  logger.log(`Arenas inspected/reconciled: ${summary.arenasInspected}/${summary.arenasReconciled}`);
  logger.log(`Denominators populated/changed: ${summary.denominatorsPopulated}/${summary.denominatorsChanged}`);
  logger.log(`Leadership events built: ${summary.leadershipEventsBuilt}`);
  logger.log(`Current sole-leader pilots: ${summary.currentSoleLeaders}`);
  logger.log(`Current joint-leader pilots: ${summary.currentJointLeaders}`);
  logger.log(`Took awards: ${summary.tookAwards}`);
  logger.log(`Reclaimed awards: ${summary.reclaimedAwards}`);
  logger.log(`Already earned/unchanged: ${summary.alreadyEarnedOrUnchanged}`);
  logger.log(`Failures: ${summary.failures}`);
  logger.log(`dryRun: ${summary.dryRun}`);
}

async function main(): Promise<void> {
  const args = parseArenaLeadershipBackfillArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const cellSize = Number(process.env.GRID_CLAIM_CELL_SIZE);
  if (!Number.isSafeInteger(cellSize) || cellSize <= 0) throw new Error('GRID_CLAIM_CELL_SIZE must be a positive integer.');
  const rawBatch = process.env.ARENA_LEADERSHIP_BACKFILL_BATCH_SIZE;
  const batchSize = rawBatch === undefined ? DEFAULT_BATCH_SIZE : Number(rawBatch);
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error('ARENA_LEADERSHIP_BACKFILL_BATCH_SIZE must be a positive integer.');
  const database = createDatabase(databaseUrl);
  try {
    try { printArenaLeadershipBackfillSummary(await runArenaLeadershipBackfill(database.db, { apply: args.apply, cellSize, batchSize })); }
    catch (error) {
      if (!(error instanceof ArenaLeadershipBackfillError)) throw error;
      printArenaLeadershipBackfillSummary(error.summary);
      console.error(error.summary.committedBatchesMayRemain ? 'Previously committed batches may remain applied.' : 'No batches were committed.');
      process.exitCode = 1;
    }
  } finally { await database.pool.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
