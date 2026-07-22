import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { HeadObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { createDatabase } from '../db/client.js';
import { flights } from '../db/schema.js';
import { parseConfig } from '../config.js';
import { createBucketClient } from '../resources/bucketClient.js';
import {
  createFlightThumbnailService,
  flightThumbnailKeys,
} from '../services/flightThumbnailService.js';
import { createFlightThumbnailLifecycleService } from '../services/flightThumbnailLifecycleService.js';

export const DEFAULT_BATCH_SIZE = 10;
const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const FORCE = '--force';
const HELP = '--help';
const BATCH_SIZE = '--batch-size';

export const flightThumbnailBackfillUsage = `Usage: npm run backfill:flight-thumbnails [-- --dry-run|--apply] [--force] [--batch-size <positive integer>]

Dry-run is the default and does not write thumbnails. Pass --apply to generate them.
Missing-only is the default; pass --force to regenerate every completed flight.
`;

type Logger = Pick<Console, 'log' | 'error'>;
export type FlightThumbnailBackfillArgs = {
  apply: boolean;
  force: boolean;
  batchSize: number;
  help: boolean;
};

export type FlightThumbnailBackfillFlight = { id: string; userId: string };
export type FlightThumbnailBackfillSummary = {
  mode: 'dry-run' | 'apply';
  batchSize: number;
  inspected: number;
  wouldGenerate: number;
  generated: number;
  skippedPresent: number;
  failed: number;
};

export type FlightThumbnailBackfillOptions = {
  apply: boolean;
  force?: boolean;
  batchSize?: number;
  bucketName?: string;
  bucketFolder?: string;
  s3Client?: Pick<S3, 'send'>;
  logger?: Logger;
  /** Test seams. Production uses the database, S3 HEAD, and lifecycle service. */
  listFlights?: (
    cursor: string | undefined,
    limit: number,
  ) => Promise<FlightThumbnailBackfillFlight[]>;
  headObject?: (key: string) => Promise<'present' | 'missing'>;
  generate?: (flightId: string) => Promise<void>;
};

function parseBatchSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Batch size must be a positive integer.');
  const batchSize = Number(value);
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0)
    throw new Error('Batch size must be a positive integer.');
  return batchSize;
}

export function parseFlightThumbnailBackfillArgs(argv: string[]): FlightThumbnailBackfillArgs {
  if (argv.includes(HELP)) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other flags.');
    return { apply: false, force: false, batchSize: DEFAULT_BATCH_SIZE, help: true };
  }
  let apply = false;
  let force = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let seenApply = false;
  let seenDryRun = false;
  let seenForce = false;
  let seenBatchSize = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === APPLY) {
      if (seenApply) throw new Error('Duplicate --apply flag.');
      seenApply = true;
      apply = true;
    } else if (arg === DRY_RUN) {
      if (seenDryRun) throw new Error('Duplicate --dry-run flag.');
      seenDryRun = true;
    } else if (arg === FORCE) {
      if (seenForce) throw new Error('Duplicate --force flag.');
      seenForce = true;
      force = true;
    } else if (arg === BATCH_SIZE || arg?.startsWith(`${BATCH_SIZE}=`)) {
      if (seenBatchSize) throw new Error('Duplicate --batch-size flag.');
      seenBatchSize = true;
      const value = arg === BATCH_SIZE ? argv[++index] : arg.slice(`${BATCH_SIZE}=`.length);
      if (!value) throw new Error('--batch-size requires a positive integer.');
      batchSize = parseBatchSize(value);
    } else {
      throw new Error(`Unknown argument: ${arg ?? ''}\n\n${flightThumbnailBackfillUsage}`);
    }
  }
  if (seenApply && seenDryRun) throw new Error('--apply and --dry-run cannot be used together.');
  return { apply, force, batchSize, help: false };
}

export function selectEligibleFlightBatch(
  database: Pick<Database, 'select'>,
  cursor: string | undefined,
  limit: number,
): Promise<FlightThumbnailBackfillFlight[]> {
  const conditions = cursor
    ? and(eq(flights.processingStatus, 'completed'), gt(flights.id, cursor))
    : eq(flights.processingStatus, 'completed');
  return database
    .select({ id: flights.id, userId: flights.userId })
    .from(flights)
    .where(conditions)
    .orderBy(asc(flights.id))
    .limit(limit);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.Code === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

async function inspectThumbnailPair(
  flight: FlightThumbnailBackfillFlight,
  bucketFolder: string,
  headObject: (key: string) => Promise<'present' | 'missing'>,
): Promise<'present' | 'missing' | 'error'> {
  const keys = flightThumbnailKeys(bucketFolder, flight.userId, flight.id);
  let missing = false;
  let failed = false;
  for (const key of [keys.wideKey, keys.squareKey]) {
    try {
      if ((await headObject(key)) === 'missing') missing = true;
    } catch {
      failed = true;
    }
  }
  if (failed) return 'error';
  return missing ? 'missing' : 'present';
}

export async function runFlightThumbnailBackfill(
  database: Pick<Database, 'select'>,
  options: FlightThumbnailBackfillOptions,
): Promise<FlightThumbnailBackfillSummary> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0)
    throw new Error('Batch size must be a positive integer.');
  const logger = options.logger ?? console;
  const bucketFolder = options.bucketFolder ?? '';
  const listFlights =
    options.listFlights ?? ((cursor, limit) => selectEligibleFlightBatch(database, cursor, limit));
  if (!options.force && !options.headObject)
    throw new Error('headObject is required for missing-only backfill.');
  if (options.apply && !options.generate) throw new Error('generate is required for apply mode.');

  const summary: FlightThumbnailBackfillSummary = {
    mode: options.apply ? 'apply' : 'dry-run',
    batchSize,
    inspected: 0,
    wouldGenerate: 0,
    generated: 0,
    skippedPresent: 0,
    failed: 0,
  };
  let cursor: string | undefined;
  let batchNum = 0;
  while (true) {
    const batch = await listFlights(cursor, batchSize);
    batchNum++;
    logger.log(`Processing batch ${batchNum}`);
    if (!batch.length) break;
    for (const flight of batch) {
      summary.inspected += 1;
      let shouldGenerate = options.force === true;
      if (!shouldGenerate) {
        const state = await inspectThumbnailPair(flight, bucketFolder, options.headObject!);
        if (state === 'error') {
          summary.failed += 1;
          logger.error(`Unable to inspect thumbnail objects for flight ${flight.id}.`);
          continue;
        }
        shouldGenerate = state === 'missing';
        if (!shouldGenerate) {
          summary.skippedPresent += 1;
          continue;
        }
      }
      summary.wouldGenerate += 1;
      if (!options.apply) continue;
      try {
        await options.generate!(flight.id);
        summary.generated += 1;
      } catch {
        summary.failed += 1;
        logger.error(`Unable to generate thumbnail objects for flight ${flight.id}.`);
      }
    }
    cursor = batch[batch.length - 1]?.id;
  }
  return summary;
}

export function printFlightThumbnailBackfillSummary(
  summary: FlightThumbnailBackfillSummary,
  logger: Logger = console,
): void {
  logger.log(`Mode: ${summary.mode}`);
  logger.log(`Batch size: ${summary.batchSize}`);
  logger.log(`Inspected: ${summary.inspected}`);
  logger.log(`Would generate: ${summary.wouldGenerate}`);
  logger.log(`Generated: ${summary.generated}`);
  logger.log(`Skipped present: ${summary.skippedPresent}`);
  logger.log(`Failed: ${summary.failed}`);
}

async function headObjectOrMissing(
  s3Client: Pick<S3, 'send'>,
  bucketName: string,
  key: string,
): Promise<'present' | 'missing'> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return 'present';
  } catch (error) {
    if (isNotFound(error)) return 'missing';
    throw new Error('Unable to inspect thumbnail object.', { cause: error });
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseFlightThumbnailBackfillArgs(argv);
  if (args.help) {
    console.log(flightThumbnailBackfillUsage);
    return;
  }
  const config = parseConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const s3Client = createBucketClient(config);
    const thumbnails = createFlightThumbnailService({
      mapTilerApiKey: config.mapTilerApiKey,
      bucketName: config.bucket.bucketName,
      bucketFolder: config.bucket.bucketFolder,
      cellSize: config.gridClaimCellSize,
      s3Client,
    });
    const lifecycle = createFlightThumbnailLifecycleService(db, thumbnails, {
      cellSize: config.gridClaimCellSize,
      s3Client,
      bucketName: config.bucket.bucketName,
      bucketFolder: config.bucket.bucketFolder,
    });
    const summary = await runFlightThumbnailBackfill(db, {
      apply: args.apply,
      force: args.force,
      batchSize: args.batchSize,
      bucketFolder: config.bucket.bucketFolder,
      headObject: (key) => headObjectOrMissing(s3Client, config.bucket.bucketName, key),
      generate: lifecycle.generateForFlight,
    });
    printFlightThumbnailBackfillSummary(summary);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
