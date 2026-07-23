import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createDatabase } from '../db/client.js';
import {
  BatchedUserHistoryRebuildError,
  createUserHistoryRebuildService,
  USER_HISTORY_REBUILD_BATCH_SIZE,
  type BatchedUserHistoryRebuildSummary,
  type UserHistoryBatchedRebuildService,
  type UserHistoryRebuildInspection,
} from '../services/userHistoryRebuildService.js';

const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const EMAIL = '--email';
const HELP = '--help';
const APP_GRID_CELL_SIZE = 500;

export const rebuildUserHistoryUsage = `Usage: npm run rebuild:user-history -- --email <address> [--dry-run|--apply]

The default is a read-only validation. It reports the matched user, completed-flight
count, and any completed flights missing started_at. Pass --apply to delete and
rebuild that user's Achievement and Activity history in fixed batches of
${USER_HISTORY_REBUILD_BATCH_SIZE} flights. Workers must be paused and drained first.
`;

type Logger = Pick<Console, 'log' | 'error'>;

export type RebuildUserHistoryArgs = {
  email: string;
  apply: boolean;
  help: boolean;
};

const emailSchema = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(320));

export function parseRebuildUserHistoryArgs(argv: string[]): RebuildUserHistoryArgs {
  if (argv.includes(HELP)) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other flags.');
    return { email: '', apply: false, help: true };
  }

  let email: string | undefined;
  let apply = false;
  let seenApply = false;
  let seenDryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
    if (arg === EMAIL || arg?.startsWith(`${EMAIL}=`)) {
      if (email !== undefined) throw new Error('Duplicate --email option.');
      const value = arg === EMAIL ? argv[++index] : arg.slice(`${EMAIL}=`.length);
      if (!value) throw new Error('--email requires an email address.');
      const parsed = emailSchema.safeParse(value);
      if (!parsed.success) throw new Error('--email must be a valid email address.');
      email = parsed.data;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ''}\n\n${rebuildUserHistoryUsage}`);
  }
  if (seenApply && seenDryRun) throw new Error('--apply and --dry-run cannot be used together.');
  if (!email) throw new Error(`--email is required.\n\n${rebuildUserHistoryUsage}`);
  return { email, apply, help: false };
}

function printInspection(inspection: Exclude<UserHistoryRebuildInspection, { status: 'not_found' }>, logger: Logger): void {
  logger.log(`User: ${inspection.email} (${inspection.userId})`);
  logger.log(`Completed flights found at startup: ${inspection.completedFlightCount}`);
  logger.log(`Completed flights missing started_at: ${inspection.invalidFlightIds.length}`);
  for (const flightId of inspection.invalidFlightIds) logger.log(`Invalid flight: ${flightId}`);
}

export function printBatchedUserHistoryRebuildSummary(
  summary: BatchedUserHistoryRebuildSummary,
  logger: Logger = console,
  failed = false,
): void {
  logger.log(`${failed ? 'Partial/failed' : 'Applied'} user Achievement and Activity history rebuild`);
  logger.log(`Flight batches committed: ${summary.committedBatches}/${summary.totalBatches}`);
  logger.log(`Flights committed: ${summary.committedFlights}/${summary.completedFlights}`);
  logger.log(`Reset committed: ${summary.resetCommitted ? 'yes' : 'no'}`);
  logger.log(`Finalization committed: ${summary.finalizationCommitted ? 'yes' : 'no'}`);
  logger.log(`Activities deleted/created: ${summary.activitiesDeleted}/${summary.activitiesCreated}`);
  logger.log(`Achievements deleted/created: ${summary.achievementsDeleted}/${summary.achievementsCreated}`);
  logger.log(`Achievement record events deleted/created: ${summary.achievementRecordEventsDeleted}/${summary.achievementRecordEventsCreated}`);
  logger.log(`Achievement records deleted/created: ${summary.achievementRecordsDeleted}/${summary.achievementRecordsCreated}`);
  logger.log(`Flight progress rows deleted/created: ${summary.flightProgressDeleted}/${summary.flightProgressCreated}`);
  logger.log(`Achievement progress rows deleted: ${summary.userAchievementProgressDeleted}`);
}

export async function runRebuildUserHistoryCommand(
  service: UserHistoryBatchedRebuildService,
  args: RebuildUserHistoryArgs,
  logger: Logger = console,
): Promise<number> {
  const inspection = await service.inspectByEmail(args.email);
  if (inspection.status === 'not_found') {
    logger.error(`No user found for ${inspection.email}.`);
    return 1;
  }

  printInspection(inspection, logger);
  if (inspection.status === 'no_completed_flights') {
    logger.error('The matched user has no completed flights to rebuild.');
    return 1;
  }
  if (inspection.status === 'invalid_flight_history') {
    logger.error('The rebuild cannot run because one or more completed flights are missing started_at.');
    return 1;
  }
  if (!args.apply) {
    logger.log('Dry-run validation completed. No changes were made.');
    return 0;
  }

  logger.log(`Applying rebuild in fixed batches of ${USER_HISTORY_REBUILD_BATCH_SIZE} flights.`);
  try {
    const summary = await service.rebuildSnapshot(inspection.snapshot, {
      onBatchCommitted(progress) {
        logger.log(`Committed flight batch ${progress.batchNumber}/${progress.totalBatches} (${progress.flightCount} flights).`);
      },
    });
    printBatchedUserHistoryRebuildSummary(summary, logger);
    return 0;
  } catch (error) {
    if (!(error instanceof BatchedUserHistoryRebuildError)) throw error;
    logger.error(error.message);
    printBatchedUserHistoryRebuildSummary(error.summary, logger, true);
    logger.error(error.summary.resetCommitted
      ? 'The reset and any reported flight batches remain committed. Rerun the command to rebuild from scratch.'
      : 'No rebuild changes were committed.');
    return 1;
  }
}

async function main(): Promise<void> {
  const args = parseRebuildUserHistoryArgs(process.argv.slice(2));
  if (args.help) {
    console.log(rebuildUserHistoryUsage);
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = createDatabase(databaseUrl);
  try {
    const service = createUserHistoryRebuildService(database.db, { cellSize: APP_GRID_CELL_SIZE });
    process.exitCode = await runRebuildUserHistoryCommand(service, args);
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
