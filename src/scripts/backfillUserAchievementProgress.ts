import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';
import { createUserAchievementProgressService, type UserAchievementProgressService } from '../services/userAchievementProgressService.js';

const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';
const DEFAULT_BATCH_SIZE = 10;
const APP_GRID_CELL_SIZE = 500;

const usage = `Usage: npm run backfill:user-achievement-progress [-- --dry-run|--apply]

The default is a dry-run. Pass --apply to persist current achievement progress.
Apply mode commits each user batch independently. Previously committed batches may
remain applied if a later batch fails. Set
USER_ACHIEVEMENT_PROGRESS_BACKFILL_BATCH_SIZE to a positive integer (default ${DEFAULT_BATCH_SIZE}).
`;

type Logger = Pick<Console, 'log' | 'error'>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type UserAchievementProgressBackfillArgs = { apply: boolean; help: boolean };

export function parseUserAchievementProgressBackfillArgs(argv: string[]): UserAchievementProgressBackfillArgs {
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

export type UserAchievementProgressBackfillSummary = {
  usersInspected: number;
  projectionsInserted: number;
  projectionsUpdated: number;
  failures: number;
  dryRun: boolean;
  committedBatchesMayRemain: boolean;
  elapsedMs: number;
};

export type UserAchievementProgressBackfillOptions = {
  apply: boolean;
  batchSize?: number;
  cellSize?: number;
  logger?: Logger;
  /** Test seam; production uses the shared authoritative projection service. */
  projectionService?: Pick<UserAchievementProgressService, 'rebuildUsersInTransaction'>;
};

export class UserAchievementProgressBackfillError extends Error {
  constructor(
    public readonly summary: UserAchievementProgressBackfillSummary,
    cause: unknown,
  ) {
    super(`User achievement progress backfill failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'UserAchievementProgressBackfillError';
  }
}

class DryRunRollback extends Error {
  constructor() {
    super('User achievement progress backfill dry-run rollback.');
  }
}

type UserIdRow = { userId: string };
type CountRow = { count: number | string };
type ExistingRow = { userId: string };

async function countProfileUsers(database: Pick<Database, 'execute'>): Promise<number> {
  const result = await database.execute<CountRow>(sql`SELECT COUNT(*)::integer AS count
    FROM users INNER JOIN profiles ON profiles.user_id = users.user_id`);
  return Number(result.rows[0]?.count ?? 0);
}

async function selectProfileUsers(database: Pick<Database, 'execute'>, afterUserId: string | null, limit: number): Promise<string[]> {
  // Keep UUID keyset pagination stable and avoid offset scans as the table grows.
  const cursor = afterUserId ? sql`WHERE users.user_id > ${afterUserId}` : sql``;
  const result = await database.execute<UserIdRow>(sql`SELECT users.user_id AS "userId"
    FROM users INNER JOIN profiles ON profiles.user_id = users.user_id
    ${cursor}
    ORDER BY users.user_id LIMIT ${limit}`);
  return result.rows.map((row) => row.userId);
}

async function existingProjectionUsers(transaction: Transaction, userIds: readonly string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const ids = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
  const result = await transaction.execute<ExistingRow>(sql`SELECT user_id AS "userId"
    FROM user_achievement_progress WHERE user_id IN (${ids})`);
  return new Set(result.rows.map((row) => row.userId));
}

async function verifyProjectionCoverage(database: Pick<Database, 'execute'>): Promise<void> {
  const result = await database.execute<CountRow>(sql`SELECT COUNT(*)::integer AS count
    FROM profiles
    WHERE NOT EXISTS (
      SELECT 1 FROM user_achievement_progress progress
      WHERE progress.user_id = profiles.user_id
    )`);
  const missing = Number(result.rows[0]?.count ?? 0);
  if (missing !== 0) throw new Error(`User achievement progress backfill left ${missing} profile users without a projection row.`);
}

function validateBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new RangeError('User achievement progress backfill batch size must be a positive integer.');
}

export async function runUserAchievementProgressBackfill(
  database: Database,
  options: UserAchievementProgressBackfillOptions,
): Promise<UserAchievementProgressBackfillSummary> {
  const logger = options.logger ?? console;
  const startedAt = Date.now();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  validateBatchSize(batchSize);
  const summary: UserAchievementProgressBackfillSummary = {
    usersInspected: 0,
    projectionsInserted: 0,
    projectionsUpdated: 0,
    failures: 0,
    dryRun: !options.apply,
    committedBatchesMayRemain: false,
    elapsedMs: 0,
  };
  const projectionService = options.projectionService ?? createUserAchievementProgressService(database, { cellSize: options.cellSize ?? APP_GRID_CELL_SIZE });
  let committedBatches = 0;
  try {
    const totalUsers = await countProfileUsers(database);
    const totalBatches = Math.ceil(totalUsers / batchSize);
    logger.log(`User achievement progress backfill started: ${totalUsers} users, batch size ${batchSize}`);
    let afterUserId: string | null = null;
    for (let batchNumber = 1; batchNumber <= totalBatches; batchNumber += 1) {
      const userIds = await selectProfileUsers(database, afterUserId, batchSize);
      if (!userIds.length) break;
      const batchStartedAt = Date.now();
      logger.log(`Processing batch ${batchNumber} / ${totalBatches} (${userIds.length} users)`);
      let inserted = 0;
      let updated = 0;
      try {
        await database.transaction(async (transaction) => {
          const existing = await existingProjectionUsers(transaction, userIds);
          await projectionService.rebuildUsersInTransaction(transaction, userIds);
          inserted = userIds.filter((userId) => !existing.has(userId)).length;
          updated = userIds.length - inserted;
          if (!options.apply) throw new DryRunRollback();
        });
        committedBatches += 1;
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
      }
      summary.usersInspected += userIds.length;
      if (options.apply) {
        summary.projectionsInserted += inserted;
        summary.projectionsUpdated += updated;
      }
      logger.log(`Completed batch ${batchNumber} / ${totalBatches}: ${userIds.length} projections updated (${inserted} inserted, ${updated} updated) in ${Date.now() - batchStartedAt} ms`);
      afterUserId = userIds[userIds.length - 1] ?? null;
    }
    if (options.apply) await verifyProjectionCoverage(database);
    summary.elapsedMs = Date.now() - startedAt;
    return summary;
  } catch (error) {
    summary.failures += 1;
    summary.committedBatchesMayRemain = options.apply && committedBatches > 0;
    summary.elapsedMs = Date.now() - startedAt;
    throw new UserAchievementProgressBackfillError(summary, error);
  }
}

export function printUserAchievementProgressBackfillSummary(summary: UserAchievementProgressBackfillSummary, logger: Logger = console): void {
  logger.log(`${summary.dryRun ? 'Dry-run' : 'Applied'} user achievement progress backfill`);
  logger.log(`Users inspected: ${summary.usersInspected}`);
  logger.log(`Projections inserted/updated: ${summary.projectionsInserted}/${summary.projectionsUpdated}`);
  logger.log(`Failures: ${summary.failures}`);
  logger.log(`Elapsed: ${summary.elapsedMs} ms`);
}

function batchSizeFromEnvironment(): number {
  const raw = process.env.USER_ACHIEVEMENT_PROGRESS_BACKFILL_BATCH_SIZE;
  const batchSize = raw === undefined ? DEFAULT_BATCH_SIZE : Number(raw);
  validateBatchSize(batchSize);
  return batchSize;
}

async function main(): Promise<void> {
  const args = parseUserAchievementProgressBackfillArgs(process.argv.slice(2));
  if (args.help) { console.log(usage); return; }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = createDatabase(databaseUrl);
  try {
    try {
      const summary = await runUserAchievementProgressBackfill(database.db, {
        apply: args.apply,
        batchSize: batchSizeFromEnvironment(),
        cellSize: APP_GRID_CELL_SIZE,
      });
      printUserAchievementProgressBackfillSummary(summary);
    } catch (error) {
      if (!(error instanceof UserAchievementProgressBackfillError)) throw error;
      printUserAchievementProgressBackfillSummary(error.summary);
      console.error(error.summary.committedBatchesMayRemain ? 'Previously committed batches may remain applied.' : 'No batches were committed.');
      process.exitCode = 1;
    }
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
