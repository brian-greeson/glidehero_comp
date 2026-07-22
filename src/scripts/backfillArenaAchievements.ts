import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { createDatabase } from '../db/client.js';
import { achievementRecordEvents, achievementRecords, achievements, flights } from '../db/schema.js';
import { lockUserProgression } from '../services/gridClaimService.js';
import {
  awardArenaAchievementsFromSnapshotInTransaction,
  evaluateArenaAchievementsInTransaction,
  type ArenaAchievementEvaluation,
  type ArenaAchievementSnapshotRow,
  type ArenaAchievementTransaction,
} from '../services/arenaAchievementService.js';
import { arenaCellOwnershipPredicateSql, claimCellCenterSql } from '../services/arenaGeometrySql.js';
import { achievementCatalog, type AchievementKey } from '../domain/achievement/catalog.js';

const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';
const DEFAULT_FLIGHT_BATCH_SIZE = 10;
const usage = `Usage: npm run backfill:arena-achievements [-- --dry-run|--apply]

The default is a dry-run. Pass --apply to persist the retroactive Release 2 awards.
The backfill is a one-time operation over completed flights and uses the existing
per-user progression advisory lock. Apply mode commits flights in batches; configure
ARENA_ACHIEVEMENT_BACKFILL_BATCH_SIZE to override the default batch size of 100.
`;

type Logger = Pick<Console, 'log' | 'error'>;

export type ArenaAchievementBackfillOptions = {
  apply: boolean;
  cellSize: number;
  batchSize?: number;
  logger?: Logger;
  /** Test/integration seam; production uses the shared evaluator. */
  evaluate?: (database: ArenaAchievementTransaction, input: Parameters<typeof evaluateArenaAchievementsInTransaction>[1]) => Promise<ArenaAchievementEvaluation>;
};

export type ArenaAchievementBackfillSummary = {
  usersExamined: number;
  flightsExamined: number;
  achievementCounts: Record<AchievementKey, number>;
  launchTagRecordEvents: number;
  unchangedOrAlreadyEarned: number;
  failures: number;
};

export type ArenaAchievementBackfillArgs = { apply: boolean; help: boolean };

export function parseArenaAchievementBackfillArgs(argv: string[]): ArenaAchievementBackfillArgs {
  if (argv.includes(HELP)) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other flags.');
    return { apply: false, help: true };
  }
  let apply = false;
  let seenApply = false;
  let seenDryRun = false;
  for (const arg of argv) {
    if (arg === APPLY) {
      if (seenApply) throw new Error('Duplicate --apply flag.');
      seenApply = true;
      apply = true;
      continue;
    }
    if (arg === DRY_RUN) {
      if (seenDryRun) throw new Error('Duplicate --dry-run flag.');
      seenDryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
  }
  if (argv.includes(APPLY) && argv.includes(DRY_RUN)) throw new Error('--apply and --dry-run cannot be used together.');
  return { apply, help: false };
}

function emptyCounts(): Record<AchievementKey, number> {
  return Object.fromEntries(achievementCatalog.map((definition) => [definition.key, 0])) as Record<AchievementKey, number>;
}

function emptySummary(): ArenaAchievementBackfillSummary {
  return {
    usersExamined: 0,
    flightsExamined: 0,
    achievementCounts: emptyCounts(),
    launchTagRecordEvents: 0,
    unchangedOrAlreadyEarned: 0,
    failures: 0,
  };
}

type HistoricalFlight = {
  id: string;
  userId: string;
  startedAt: Date | null;
  createdAt: Date;
};

type BackfillArenaCatalogRow = Pick<
  ArenaAchievementSnapshotRow,
  'id' | 'arenaType' | 'claimableCellCount'
>;
type BackfillCellMembership = { flightId: string; arenaId: string; x: number; y: number };
type BackfillOriginMembership = { flightId: string; arenaId: string };

class ArenaBackfillReplay {
  private readonly cellsByArena = new Map<string, Set<string>>();
  private readonly visitedLaunches = new Set<string>();
  private readonly catalogById: ReadonlyMap<string, BackfillArenaCatalogRow>;

  constructor(
    private readonly catalog: readonly BackfillArenaCatalogRow[],
    private readonly claimsByFlight: ReadonlyMap<string, readonly BackfillCellMembership[]>,
    private readonly originsByFlight: ReadonlyMap<string, ReadonlySet<string>>,
  ) {
    this.catalogById = new Map(catalog.map((arena) => [arena.id, arena]));
  }

  advance(flightId: string): ArenaAchievementSnapshotRow[] {
    const memberships = this.claimsByFlight.get(flightId) ?? [];
    const taggedLaunches = new Set<string>();
    for (const membership of memberships) {
      const cells = this.cellsByArena.get(membership.arenaId) ?? new Set<string>();
      cells.add(`${membership.x}:${membership.y}`);
      this.cellsByArena.set(membership.arenaId, cells);
      if (this.catalogById.get(membership.arenaId)?.arenaType === 'launch') taggedLaunches.add(membership.arenaId);
    }
    const currentOrigins = this.originsByFlight.get(flightId) ?? new Set<string>();
    for (const arenaId of currentOrigins) this.visitedLaunches.add(arenaId);

    return this.catalog.map((arena) => ({
      ...arena,
      claimedCells: this.cellsByArena.get(arena.id)?.size ?? 0,
      visited: arena.arenaType === 'launch' && this.visitedLaunches.has(arena.id),
      firstFromLaunch: arena.arenaType === 'launch' && currentOrigins.has(arena.id),
      tagged: arena.arenaType === 'launch' && taggedLaunches.has(arena.id),
    }));
  }
}

async function loadArenaCatalog(database: Database): Promise<BackfillArenaCatalogRow[]> {
  const result = await database.execute<BackfillArenaCatalogRow>(sql`
    SELECT id, arena_type AS "arenaType",
           CASE WHEN arena_type IN ('launch', 'general') THEN claimable_cell_count ELSE NULL END AS "claimableCellCount"
    FROM arenas
  `);
  return result.rows;
}

async function precomputeArenaReplay(
  database: Database,
  userId: string,
  flightsForUser: readonly HistoricalFlight[],
  catalog: readonly BackfillArenaCatalogRow[],
  cellSize: number,
): Promise<ArenaBackfillReplay> {
  const flightIds = flightsForUser.map((flight) => flight.id);
  const flightIdsJson = JSON.stringify(flightIds);
  const memberships = await database.execute<BackfillCellMembership>(sql`
    WITH selected_flights AS (
      SELECT value::uuid AS flight_id
      FROM jsonb_array_elements_text(${flightIdsJson}::jsonb)
    )
    SELECT claims.claim_flight AS "flightId", arena.id AS "arenaId", claims.x, claims.y
    FROM user_grid_claims claims
    INNER JOIN selected_flights ON selected_flights.flight_id = claims.claim_flight
    INNER JOIN arenas arena ON ${arenaCellOwnershipPredicateSql({ arenaId: sql`arena.id`, arenaType: sql`arena.arena_type`, externalId: sql`arena.external_id`, area: sql`arena.area`, cellCenter: claimCellCenterSql({ x: sql`claims.x`, y: sql`claims.y`, cellSize: sql`${cellSize}` }) })}
    WHERE claims.claim_user = ${userId}
  `);
  const origins = await database.execute<BackfillOriginMembership>(sql`
    WITH selected_flights AS (
      SELECT value::uuid AS flight_id
      FROM jsonb_array_elements_text(${flightIdsJson}::jsonb)
    )
    SELECT flight.flight_id AS "flightId", arena.id AS "arenaId"
    FROM flights flight
    INNER JOIN selected_flights ON selected_flights.flight_id = flight.flight_id
    INNER JOIN arenas arena
      ON arena.arena_type = 'launch'
     AND ST_Covers(
       arena.area,
       ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
    )
    WHERE flight.user_id = ${userId}
      AND flight.launch_latitude IS NOT NULL
      AND flight.launch_longitude IS NOT NULL
  `);
  const claimsByFlight = new Map<string, BackfillCellMembership[]>();
  for (const membership of memberships.rows) {
    const rows = claimsByFlight.get(membership.flightId) ?? [];
    rows.push(membership);
    claimsByFlight.set(membership.flightId, rows);
  }
  const originsByFlight = new Map<string, Set<string>>();
  for (const origin of origins.rows) {
    const arenaIds = originsByFlight.get(origin.flightId) ?? new Set<string>();
    arenaIds.add(origin.arenaId);
    originsByFlight.set(origin.flightId, arenaIds);
  }
  return new ArenaBackfillReplay(catalog, claimsByFlight, originsByFlight);
}

async function selectHistoricalFlights(database: Pick<Database, 'select'>): Promise<HistoricalFlight[]> {
  return database
    .select({ id: flights.id, userId: flights.userId, startedAt: flights.startedAt, createdAt: flights.createdAt })
    .from(flights)
    .where(eq(flights.processingStatus, 'completed'))
    .orderBy(
      asc(flights.userId),
      sql`COALESCE(${flights.startedAt}, ${flights.createdAt})`,
      asc(flights.createdAt),
      asc(flights.id),
    );
}

class DryRunRollback extends Error {
  constructor() {
    super('Arena achievement backfill dry-run rollback.');
  }
}

export class ArenaAchievementBackfillError extends Error {
  constructor(
    public readonly summary: ArenaAchievementBackfillSummary,
    public readonly committedBatchesMayRemain: boolean,
    cause: unknown,
  ) {
    super(`Release 2 Arena achievement backfill failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ArenaAchievementBackfillError';
  }
}

function addEvaluation(summary: ArenaAchievementBackfillSummary, result: ArenaAchievementEvaluation): void {
  for (const key of result.newlyEarned) summary.achievementCounts[key] += 1;
  if (result.record?.newRecord) summary.launchTagRecordEvents += 1;
  else if (result.record) summary.unchangedOrAlreadyEarned += 1;
}

function mergeEvaluationSummary(target: ArenaAchievementBackfillSummary, source: ArenaAchievementBackfillSummary): void {
  for (const definition of achievementCatalog) {
    target.achievementCounts[definition.key] += source.achievementCounts[definition.key];
  }
  target.launchTagRecordEvents += source.launchTagRecordEvents;
  target.unchangedOrAlreadyEarned += source.unchangedOrAlreadyEarned;
}

function flightBatches(flightsForUser: HistoricalFlight[], batchSize: number): HistoricalFlight[][] {
  const batches: HistoricalFlight[][] = [];
  for (let start = 0; start < flightsForUser.length; start += batchSize) {
    batches.push(flightsForUser.slice(start, start + batchSize));
  }
  return batches;
}

async function evaluateFlightBatch(
  transaction: ArenaAchievementTransaction,
  options: ArenaAchievementBackfillOptions,
  userId: string,
  batch: HistoricalFlight[],
  priorHistoricalIds: readonly string[],
  replay: ArenaBackfillReplay | null,
): Promise<{ summary: ArenaAchievementBackfillSummary; historicalIds: string[] }> {
  const batchSummary = emptySummary();
  const historicalIds = [...priorHistoricalIds];
  for (const flight of batch) {
    historicalIds.push(flight.id);
    const input = {
      userId,
      sourceFlightId: flight.id,
      cellSize: options.cellSize,
      earnedAt: flight.startedAt ?? flight.createdAt,
      historicalFlightIds: historicalIds,
    };
    const result = options.evaluate
      ? await options.evaluate(transaction, input)
      : await awardArenaAchievementsFromSnapshotInTransaction(transaction, input, replay!.advance(flight.id));
    addEvaluation(batchSummary, result);
  }
  return { summary: batchSummary, historicalIds };
}

async function preflightUsers(
  database: Database,
  byUser: ReadonlyMap<string, HistoricalFlight[]>,
  summary: ArenaAchievementBackfillSummary,
): Promise<void> {
  const release2Keys = new Set(achievementCatalog.map((definition) => definition.key));
  for (const userId of byUser.keys()) {
    const existingRecord = await database
      .select({ id: achievementRecords.id, recordKey: achievementRecords.recordKey })
      .from(achievementRecords)
      .where(and(eq(achievementRecords.userId, userId), eq(achievementRecords.recordKey, 'most_launches_tagged_one_flight')));
    const existingEvents = await database
      .select({ id: achievementRecordEvents.id })
      .from(achievementRecordEvents)
      .innerJoin(achievementRecords, eq(achievementRecordEvents.recordId, achievementRecords.id))
      .where(and(eq(achievementRecordEvents.userId, userId), eq(achievementRecords.recordKey, 'most_launches_tagged_one_flight')));
    if (existingRecord.length || existingEvents.length) {
      throw new Error(`User ${userId} has existing most_launches_tagged_one_flight record state; backfill made no changes. Resolve it before this one-time backfill.`);
    }
    const existingAwards = await database
      .select({ key: achievements.achievementKey })
      .from(achievements)
      .where(eq(achievements.userId, userId));
    summary.unchangedOrAlreadyEarned += existingAwards.filter((award) => release2Keys.has(award.key as AchievementKey)).length;
  }
}

/** Replays Release 2 awards against an as-of snapshot for every completed flight. */
export async function runArenaAchievementBackfill(
  database: Database,
  options: ArenaAchievementBackfillOptions,
): Promise<ArenaAchievementBackfillSummary> {
  const logger = options.logger ?? console;
  const summary = emptySummary();
  const batchSize = options.batchSize ?? DEFAULT_FLIGHT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new RangeError('Arena achievement backfill batch size must be a positive integer.');
  let committedBatchCount = 0;

  try {
    const historicalFlights = await selectHistoricalFlights(database);
    const byUser = new Map<string, HistoricalFlight[]>();
    for (const flight of historicalFlights) {
      const list = byUser.get(flight.userId) ?? [];
      list.push(flight);
      byUser.set(flight.userId, list);
    }
    summary.usersExamined = byUser.size;
    summary.flightsExamined = historicalFlights.length;
    await preflightUsers(database, byUser, summary);
    const arenaCatalog = options.evaluate ? [] : await loadArenaCatalog(database);

    let userIndex = 0;
    for (const [userId, flightsForUser] of byUser) {
      userIndex += 1;
      logger.log(`Updating user ${userIndex} / ${byUser.size}`);
      const batches = flightBatches(flightsForUser, batchSize);
      if (!options.evaluate) logger.log(`Precomputing Arena membership for user ${userIndex} / ${byUser.size}`);
      const replay = options.evaluate
        ? null
        : await precomputeArenaReplay(database, userId, flightsForUser, arenaCatalog, options.cellSize);

      if (!options.apply) {
        const userSummary = emptySummary();
        try {
          await database.transaction(async (tx) => {
            await lockUserProgression(tx, userId);
            let historicalIds: string[] = [];
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
              logger.log(`Processing flight batch ${batchIndex + 1} / ${batches.length}`);
              const result = await evaluateFlightBatch(tx, options, userId, batches[batchIndex]!, historicalIds, replay);
              mergeEvaluationSummary(userSummary, result.summary);
              historicalIds = result.historicalIds;
            }
            throw new DryRunRollback();
          });
        } catch (error) {
          if (!(error instanceof DryRunRollback)) throw error;
        }
        mergeEvaluationSummary(summary, userSummary);
        continue;
      }

      let historicalIds: string[] = [];
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        logger.log(`Processing flight batch ${batchIndex + 1} / ${batches.length}`);
        const result = await database.transaction(async (tx) => {
          await lockUserProgression(tx, userId);
          return evaluateFlightBatch(tx, options, userId, batches[batchIndex]!, historicalIds, replay);
        });
        committedBatchCount += 1;
        mergeEvaluationSummary(summary, result.summary);
        historicalIds = result.historicalIds;
      }
    }
  } catch (error) {
    summary.failures += 1;
    const partial = options.apply && committedBatchCount > 0;
    logger.error(`Arena achievement backfill failed${partial ? ' after one or more batches committed' : ' before any batch committed'}: ${error instanceof Error ? error.message : String(error)}`);
    throw new ArenaAchievementBackfillError(summary, partial, error);
  }
  return summary;
}

export function printArenaAchievementBackfillSummary(
  summary: ArenaAchievementBackfillSummary,
  apply: boolean,
  logger: Logger = console,
  failed = false,
): void {
  const outcome = failed ? (apply ? 'Failed/partial apply' : 'Failed dry-run') : (apply ? 'Applied' : 'Dry-run');
  logger.log(`${outcome} Release 2 Arena achievement backfill`);
  logger.log(`Users examined: ${summary.usersExamined}`);
  logger.log(`Flights examined: ${summary.flightsExamined}`);
  for (const definition of achievementCatalog) {
    logger.log(`${definition.key}: ${summary.achievementCounts[definition.key] ?? 0}`);
  }
  logger.log(`Launch-tag record events: ${summary.launchTagRecordEvents}`);
  logger.log(`Unchanged/already earned: ${summary.unchangedOrAlreadyEarned}`);
  logger.log(`Failures/rejections: ${summary.failures}`);
}

async function main(): Promise<void> {
  const args = parseArenaAchievementBackfillArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const cellSize = 500;
  const rawBatchSize = process.env.ARENA_ACHIEVEMENT_BACKFILL_BATCH_SIZE;
  const batchSize = rawBatchSize === undefined ? DEFAULT_FLIGHT_BATCH_SIZE : Number(rawBatchSize);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('ARENA_ACHIEVEMENT_BACKFILL_BATCH_SIZE must be a positive integer.');
  const database = createDatabase(databaseUrl);
  try {
    try {
      const summary = await runArenaAchievementBackfill(database.db, { apply: args.apply, cellSize, batchSize });
      printArenaAchievementBackfillSummary(summary, args.apply);
    } catch (error) {
      if (!(error instanceof ArenaAchievementBackfillError)) throw error;
      printArenaAchievementBackfillSummary(error.summary, args.apply, console, true);
      console.error(error.committedBatchesMayRemain
        ? 'Release 2 Arena achievement backfill failed; previously committed batches remain applied.'
        : 'Release 2 Arena achievement backfill failed before any batch committed.');
      process.exitCode = 1;
    }
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
