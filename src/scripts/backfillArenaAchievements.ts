import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { createDatabase } from '../db/client.js';
import { achievementRecordEvents, achievementRecords, achievements, flights } from '../db/schema.js';
import { lockUserProgression } from '../services/gridClaimService.js';
import { evaluateArenaAchievementsInTransaction, type ArenaAchievementEvaluation, type ArenaAchievementTransaction } from '../services/arenaAchievementService.js';
import { achievementCatalog, type AchievementKey } from '../domain/achievement/catalog.js';

const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';
const usage = `Usage: npm run backfill:arena-achievements [-- --dry-run|--apply]

The default is a dry-run. Pass --apply to persist the retroactive Release 2 awards.
The backfill is a one-time operation over completed flights and uses the existing
per-user progression advisory lock.
`;

type Logger = Pick<Console, 'log' | 'error'>;

export type ArenaAchievementBackfillOptions = {
  apply: boolean;
  cellSize: number;
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
  constructor(public readonly summary: ArenaAchievementBackfillSummary) {
    super('Arena achievement backfill dry-run rollback.');
  }
}

export class ArenaAchievementBackfillError extends Error {
  constructor(public readonly summary: ArenaAchievementBackfillSummary, cause: unknown) {
    super(`Release 2 Arena achievement backfill rolled back: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ArenaAchievementBackfillError';
  }
}

/**
 * Replays Release 2 awards against an as-of snapshot for every completed flight.
 * The whole operation is one transaction: dry-run rolls it back and apply either
 * commits all users or leaves no writes behind.
 */
export async function runArenaAchievementBackfill(
  database: Database,
  options: ArenaAchievementBackfillOptions,
): Promise<ArenaAchievementBackfillSummary> {
  const logger = options.logger ?? console;
  const summary = emptySummary();

  try {
    await database.transaction(async (tx) => {
      // Inventory and locks are both transaction-scoped. This prevents a live
      // evaluator from changing the completed-flight set between inventory and replay.
      const candidateUsers = await tx
        .select({ userId: flights.userId })
        .from(flights)
        .where(eq(flights.processingStatus, 'completed'))
        .orderBy(asc(flights.userId));
      const userIds = [...new Set(candidateUsers.map((row) => row.userId))];
      for (const userId of userIds) await lockUserProgression(tx, userId);
      const historicalFlights = await selectHistoricalFlights(tx);
      const byUser = new Map<string, HistoricalFlight[]>();
      for (const flight of historicalFlights) {
        const list = byUser.get(flight.userId) ?? [];
        list.push(flight);
        byUser.set(flight.userId, list);
      }
      summary.usersExamined = byUser.size;
      summary.flightsExamined = historicalFlights.length;
      for (const [userId, flightsForUser] of byUser) {
        // Existing personal-best rows cannot safely reveal whether earlier events
        // were omitted. Ordinary achievement rows remain permanent/idempotent.
        const existingRecord = await tx
          .select({ id: achievementRecords.id, recordKey: achievementRecords.recordKey })
          .from(achievementRecords)
          .where(and(eq(achievementRecords.userId, userId), eq(achievementRecords.recordKey, 'most_launches_tagged_one_flight')));
        const existingEvents = await tx
          .select({ id: achievementRecordEvents.id })
          .from(achievementRecordEvents)
          .innerJoin(achievementRecords, eq(achievementRecordEvents.recordId, achievementRecords.id))
          .where(and(eq(achievementRecordEvents.userId, userId), eq(achievementRecords.recordKey, 'most_launches_tagged_one_flight')));
        if (existingRecord.length || existingEvents.length) {
          throw new Error(`User ${userId} has existing most_launches_tagged_one_flight record state; backfill made no changes. Resolve it before this one-time backfill.`);
        }
        const existingAwards = await tx
          .select({ key: achievements.achievementKey })
          .from(achievements)
          .where(eq(achievements.userId, userId));
        const release2Keys = new Set(achievementCatalog.map((definition) => definition.key));
        summary.unchangedOrAlreadyEarned += existingAwards.filter((award) => release2Keys.has(award.key as AchievementKey)).length;

        const historicalIds: string[] = [];
        for (const flight of flightsForUser) {
          historicalIds.push(flight.id);
          const evaluatedAt = flight.startedAt ?? flight.createdAt;
          const result = await (options.evaluate ?? evaluateArenaAchievementsInTransaction)(tx, {
            userId,
            sourceFlightId: flight.id,
            cellSize: options.cellSize,
            earnedAt: evaluatedAt,
            historicalFlightIds: historicalIds,
          });
          for (const key of result.newlyEarned) summary.achievementCounts[key] += 1;
          if (result.record?.newRecord) summary.launchTagRecordEvents += 1;
          else if (result.record) summary.unchangedOrAlreadyEarned += 1;
        }
      }
      if (!options.apply) throw new DryRunRollback(summary);
    });
  } catch (error) {
    if (error instanceof DryRunRollback) return error.summary;
    summary.failures += 1;
    logger.error(`Arena achievement backfill rolled back: ${error instanceof Error ? error.message : String(error)}`);
    throw new ArenaAchievementBackfillError(summary, error);
  }
  return summary;
}

export function printArenaAchievementBackfillSummary(
  summary: ArenaAchievementBackfillSummary,
  apply: boolean,
  logger: Logger = console,
): void {
  logger.log(`${apply ? 'Applied' : 'Dry-run'} Release 2 Arena achievement backfill`);
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
  const rawCellSize = process.env.GRID_CLAIM_CELL_SIZE;
  const cellSize = Number(rawCellSize);
  if (!Number.isInteger(cellSize) || cellSize < 1) throw new Error('GRID_CLAIM_CELL_SIZE must be a positive integer.');
  const database = createDatabase(databaseUrl);
  try {
    try {
      const summary = await runArenaAchievementBackfill(database.db, { apply: args.apply, cellSize });
      printArenaAchievementBackfillSummary(summary, args.apply);
    } catch (error) {
      if (!(error instanceof ArenaAchievementBackfillError)) throw error;
      printArenaAchievementBackfillSummary(error.summary, false);
      console.error('Release 2 Arena achievement backfill failed; transaction rolled back.');
      process.exitCode = 1;
    }
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
