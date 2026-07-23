import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';
import type { ArenaAchievementSnapshotRow } from '../services/arenaAchievementService.js';
import { createUserAchievementProgressService, type UserAchievementProgressService } from '../services/userAchievementProgressService.js';
import { createUserArenaProgressService, type UserArenaProgressService } from '../services/userArenaProgressService.js';
import { lockArenaCatalogShared } from '../services/arenaCatalogLock.js';

const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';
const APP_GRID_CELL_SIZE = 500;

const usage = `Usage: npm run backfill:user-arena-progress [-- --dry-run|--apply]

The default is a dry-run. Pass --apply to persist each pilot's canonical Arena
progress and the derived achievement progress projection. Workers must be
paused and drained before applying this backfill.
`;

type Logger = Pick<Console, 'log' | 'error'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type UserArenaProgressBackfillArgs = { apply: boolean; help: boolean };

export function parseUserArenaProgressBackfillArgs(argv: string[]): UserArenaProgressBackfillArgs {
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
  if (seenApply && seenDryRun) throw new Error('--apply and --dry-run cannot be used together.');
  return { apply, help: false };
}

export type UserArenaProgressBackfillSummary = {
  usersInspected: number;
  arenaProgressRowsInserted: number;
  arenaProgressRowsUpdated: number;
  arenaProgressRowsDeleted: number;
  achievementProgressRowsInserted: number;
  achievementProgressRowsUpdated: number;
  usersWithChanges: number;
  failures: number;
  dryRun: boolean;
  committedUsersMayRemain: boolean;
  elapsedMs: number;
};

export type UserArenaProgressBackfillOptions = {
  apply: boolean;
  cellSize?: number;
  logger?: Logger;
  /** Test seams; production uses the shared authoritative projection services. */
  arenaProgressService?: Pick<UserArenaProgressService, 'rebuildInTransaction'>;
  achievementProgressService?: Pick<UserAchievementProgressService, 'upsertFromArenaSnapshotInTransaction'>;
};

export class UserArenaProgressBackfillError extends Error {
  constructor(
    public readonly summary: UserArenaProgressBackfillSummary,
    cause: unknown,
  ) {
    super(`User Arena progress backfill failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'UserArenaProgressBackfillError';
  }
}

class DryRunRollback extends Error {
  constructor() {
    super('User Arena progress backfill dry-run rollback.');
  }
}

type UserIdRow = { userId: string };
type ExistingArenaRow = { arenaId: string; claimedCellCount: number | string; visited: boolean };
type ExistingAchievementRow = { userId: string; lifetimeUniqueCellCount: number | string; launchArenasVisited: number | string; generalArenasExplored: number | string; statesFlownIn: number | string; countriesFlownIn: number | string; bestGeneralArenaId: string | null; bestGeneralClaimedCellCount: number | string; bestGeneralClaimableCellCount: number | string; projectionVersion: number | string };

async function selectUsers(database: Pick<Database, 'execute'>): Promise<string[]> {
  const result = await database.execute<UserIdRow>(sql`SELECT user_id AS "userId" FROM users ORDER BY user_id`);
  return result.rows.map((row) => row.userId);
}

async function existingArenaRows(transaction: Transaction, userId: string): Promise<ExistingArenaRow[]> {
  const result = await transaction.execute<ExistingArenaRow>(sql`
    SELECT arena_id AS "arenaId", claimed_cell_count AS "claimedCellCount", visited
    FROM user_arena_progress
    WHERE user_id = ${userId}
  `);
  return result.rows;
}

async function existingAchievementRow(transaction: Transaction, userId: string): Promise<ExistingAchievementRow | null> {
  const result = await transaction.execute<ExistingAchievementRow>(sql`
    SELECT user_id AS "userId",
           lifetime_unique_cell_count AS "lifetimeUniqueCellCount",
           launch_arenas_visited AS "launchArenasVisited",
           general_arenas_explored AS "generalArenasExplored",
           states_flown_in AS "statesFlownIn",
           countries_flown_in AS "countriesFlownIn",
           best_general_arena_id AS "bestGeneralArenaId",
           best_general_claimed_cell_count AS "bestGeneralClaimedCellCount",
           best_general_claimable_cell_count AS "bestGeneralClaimableCellCount",
           projection_version AS "projectionVersion"
    FROM user_achievement_progress
    WHERE user_id = ${userId}
  `);
  return result.rows[0] ?? null;
}

function arenaChanges(before: readonly ExistingArenaRow[], after: readonly ArenaAchievementSnapshotRow[]): Pick<UserArenaProgressBackfillSummary, 'arenaProgressRowsInserted' | 'arenaProgressRowsUpdated' | 'arenaProgressRowsDeleted'> {
  const previous = new Map(before.map((row) => [row.arenaId, row]));
  let inserted = 0;
  let updated = 0;
  for (const row of after) {
    const prior = previous.get(row.id);
    if (!prior) inserted += 1;
    else if (Number(prior.claimedCellCount) !== Number(row.claimedCells) || Boolean(prior.visited) !== Boolean(row.visited)) updated += 1;
    previous.delete(row.id);
  }
  return { arenaProgressRowsInserted: inserted, arenaProgressRowsUpdated: updated, arenaProgressRowsDeleted: previous.size };
}

function achievementChanged(before: ExistingAchievementRow | null, after: Awaited<ReturnType<UserAchievementProgressService['upsertFromArenaSnapshotInTransaction']>>): boolean {
  if (!before) return true;
  return Number(before.lifetimeUniqueCellCount) !== after.lifetimeUniqueCellCount
    || Number(before.launchArenasVisited) !== after.launchArenasVisited
    || Number(before.generalArenasExplored) !== after.generalArenasExplored
    || Number(before.statesFlownIn) !== after.statesFlownIn
    || Number(before.countriesFlownIn) !== after.countriesFlownIn
    || before.bestGeneralArenaId !== after.bestGeneralArenaId
    || Number(before.bestGeneralClaimedCellCount) !== after.bestGeneralClaimedCellCount
    || Number(before.bestGeneralClaimableCellCount) !== after.bestGeneralClaimableCellCount
    || Number(before.projectionVersion) !== after.projectionVersion;
}

export async function runUserArenaProgressBackfill(
  database: Database,
  options: UserArenaProgressBackfillOptions,
): Promise<UserArenaProgressBackfillSummary> {
  const logger = options.logger ?? console;
  const startedAt = Date.now();
  const summary: UserArenaProgressBackfillSummary = {
    usersInspected: 0,
    arenaProgressRowsInserted: 0,
    arenaProgressRowsUpdated: 0,
    arenaProgressRowsDeleted: 0,
    achievementProgressRowsInserted: 0,
    achievementProgressRowsUpdated: 0,
    usersWithChanges: 0,
    failures: 0,
    dryRun: !options.apply,
    committedUsersMayRemain: false,
    elapsedMs: 0,
  };
  const arenaService = options.arenaProgressService ?? createUserArenaProgressService(database, { cellSize: options.cellSize ?? APP_GRID_CELL_SIZE });
  const achievementService = options.achievementProgressService ?? createUserAchievementProgressService(database, { cellSize: options.cellSize ?? APP_GRID_CELL_SIZE });
  let committedUsers = 0;
  try {
    const userIds = await selectUsers(database);
    logger.log(`User Arena progress backfill started: ${userIds.length} users`);
    for (const [index, userId] of userIds.entries()) {
      let changes: Pick<UserArenaProgressBackfillSummary, 'arenaProgressRowsInserted' | 'arenaProgressRowsUpdated' | 'arenaProgressRowsDeleted'> = {
        arenaProgressRowsInserted: 0, arenaProgressRowsUpdated: 0, arenaProgressRowsDeleted: 0,
      };
      let achievementInserted = false;
      let achievementUpdated = false;
      try {
        await database.transaction(async (transaction) => {
          await lockArenaCatalogShared(transaction);
          const beforeArena = await existingArenaRows(transaction, userId);
          const beforeAchievement = await existingAchievementRow(transaction, userId);
          const snapshot = await arenaService.rebuildInTransaction(transaction, userId);
          const afterAchievement = await achievementService.upsertFromArenaSnapshotInTransaction(transaction, userId, snapshot, { promoteToComplete: true });
          changes = arenaChanges(beforeArena, snapshot.rows);
          achievementInserted = beforeAchievement === null;
          achievementUpdated = beforeAchievement !== null && achievementChanged(beforeAchievement, afterAchievement);
          if (!options.apply) throw new DryRunRollback();
        });
        committedUsers += 1;
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
      summary.usersInspected += 1;
      summary.arenaProgressRowsInserted += changes.arenaProgressRowsInserted;
      summary.arenaProgressRowsUpdated += changes.arenaProgressRowsUpdated;
      summary.arenaProgressRowsDeleted += changes.arenaProgressRowsDeleted;
      if (achievementInserted) summary.achievementProgressRowsInserted += 1;
      if (achievementUpdated) summary.achievementProgressRowsUpdated += 1;
      if (changes.arenaProgressRowsInserted > 0 || changes.arenaProgressRowsUpdated > 0 || changes.arenaProgressRowsDeleted > 0 || achievementInserted || achievementUpdated) summary.usersWithChanges += 1;
      logger.log(`Processed user ${index + 1} / ${userIds.length} (${userId}): Arena rows +${changes.arenaProgressRowsInserted}/~${changes.arenaProgressRowsUpdated}/-${changes.arenaProgressRowsDeleted}, achievement ${achievementInserted ? 'insert' : achievementUpdated ? 'update' : 'unchanged'}`);
    }
    summary.elapsedMs = Date.now() - startedAt;
    return summary;
  } catch (error) {
    summary.failures += 1;
    summary.committedUsersMayRemain = options.apply && committedUsers > 0;
    summary.elapsedMs = Date.now() - startedAt;
    throw new UserArenaProgressBackfillError(summary, error);
  }
}

export function printUserArenaProgressBackfillSummary(summary: UserArenaProgressBackfillSummary, logger: Logger = console): void {
  logger.log(`${summary.dryRun ? 'Dry-run' : 'Applied'} user Arena progress backfill`);
  logger.log(`Users inspected/with changes: ${summary.usersInspected}/${summary.usersWithChanges}`);
  logger.log(`Arena rows inserted/updated/deleted: ${summary.arenaProgressRowsInserted}/${summary.arenaProgressRowsUpdated}/${summary.arenaProgressRowsDeleted}`);
  logger.log(`Achievement progress rows inserted/updated: ${summary.achievementProgressRowsInserted}/${summary.achievementProgressRowsUpdated}`);
  logger.log(`Failures: ${summary.failures}`);
  logger.log(`Elapsed: ${summary.elapsedMs} ms`);
}

async function main(): Promise<void> {
  const args = parseUserArenaProgressBackfillArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = createDatabase(databaseUrl);
  try {
    try {
      printUserArenaProgressBackfillSummary(await runUserArenaProgressBackfill(database.db, { apply: args.apply, cellSize: APP_GRID_CELL_SIZE }));
    } catch (error) {
      if (!(error instanceof UserArenaProgressBackfillError)) throw error;
      printUserArenaProgressBackfillSummary(error.summary);
      console.error(error.summary.committedUsersMayRemain ? 'Previously committed users may remain applied.' : 'No users were committed.');
      process.exitCode = 1;
    }
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
