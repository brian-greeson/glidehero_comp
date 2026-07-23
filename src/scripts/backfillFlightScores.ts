import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';
import { trackPoints } from '../db/schema.js';
import {
  mapSixPointDistanceMetadata,
  SIX_POINT_DISTANCE_CALC_VERSION,
  TOTAL_DISTANCE_CALC_VERSION,
  totalDistanceMeters,
  type SixPointDistance,
  type SixPointDistanceMetadata,
} from '../domain/igc/distance.js';
import { calculateSixPointDistanceInWorker } from '../domain/igc/sixPointDistanceWorkerAdapter.js';
import type { IgcFix } from '../domain/igc/types.js';

export const DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE = 10;
const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';
const BATCH_SIZE = '--batch-size';

export const flightScoreBackfillUsage = `Usage: npm run backfill:flight-scores [-- --dry-run|--apply] [--batch-size <positive integer>]

Dry-run is the default and does not write flight scores. Pass --apply to persist them.
Pause and drain the flight worker before running in apply mode.
`;

type Logger = Pick<Console, 'log' | 'error'>;

export type FlightScoreBackfillArgs = {
  apply: boolean;
  batchSize: number;
  help: boolean;
};

export type FlightScoreCandidate = {
  id: string;
  totalDistanceMeters: number | null;
  totalDistanceCalcVersion: number | null;
  totalDistanceMetadata: unknown | null;
  sixPointDistanceMeters: number | null;
  sixPointDistanceCalcVersion: number | null;
  sixPointDistanceMetadata: unknown | null;
};

export type FlightScoreValues = {
  totalDistanceMeters: number;
  totalDistanceCalcVersion: number;
  totalDistanceMetadata: Record<string, never>;
  sixPointDistanceMeters: number;
  sixPointDistanceCalcVersion: number;
  sixPointDistanceMetadata: SixPointDistanceMetadata;
};

export type FlightScoreBackfillSummary = {
  mode: 'dry-run' | 'apply';
  batchSize: number;
  inspected: number;
  calculated: number;
  skipped: number;
  written: number;
  failed: number;
};

export type FlightScoreBackfillOptions = {
  apply: boolean;
  batchSize?: number;
  logger?: Logger;
  /** Test seams. Production uses PostgreSQL and the exact scoring implementations. */
  listFlights?: (cursor: string | undefined, limit: number) => Promise<FlightScoreCandidate[]>;
  loadTrackPoints?: (flightId: string) => Promise<IgcFix[]>;
  calculateTotalDistance?: (points: readonly IgcFix[]) => number;
  calculateSixPointDistance?: (points: readonly IgcFix[]) => Promise<SixPointDistance>;
  writeScores?: (flightId: string, values: FlightScoreValues) => Promise<boolean>;
};

function parseBatchSize(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error('Batch size must be a positive integer.');
  const batchSize = Number(value);
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0)
    throw new Error('Batch size must be a positive integer.');
  return batchSize;
}

export function parseFlightScoreBackfillArgs(argv: string[]): FlightScoreBackfillArgs {
  if (argv.includes(HELP)) {
    if (argv.length !== 1) throw new Error('--help cannot be combined with other flags.');
    return { apply: false, batchSize: DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE, help: true };
  }

  let apply = false;
  let batchSize = DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE;
  let seenApply = false;
  let seenDryRun = false;
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
    } else if (arg === BATCH_SIZE || arg?.startsWith(`${BATCH_SIZE}=`)) {
      if (seenBatchSize) throw new Error('Duplicate --batch-size flag.');
      seenBatchSize = true;
      const value = arg === BATCH_SIZE ? argv[++index] : arg.slice(`${BATCH_SIZE}=`.length);
      if (!value) throw new Error('--batch-size requires a positive integer.');
      batchSize = parseBatchSize(value);
    } else {
      throw new Error(`Unknown argument: ${arg ?? ''}\n\n${flightScoreBackfillUsage}`);
    }
  }
  if (seenApply && seenDryRun) throw new Error('--apply and --dry-run cannot be used together.');
  return { apply, batchSize, help: false };
}

function totalScoreNeedsCalculation(flight: FlightScoreCandidate): boolean {
  return flight.totalDistanceCalcVersion === null
    || flight.totalDistanceCalcVersion < TOTAL_DISTANCE_CALC_VERSION
    || (
      flight.totalDistanceCalcVersion === TOTAL_DISTANCE_CALC_VERSION
      && (flight.totalDistanceMeters === null || flight.totalDistanceMetadata === null)
    );
}

function sixPointScoreNeedsCalculation(flight: FlightScoreCandidate): boolean {
  return flight.sixPointDistanceCalcVersion === null
    || flight.sixPointDistanceCalcVersion < SIX_POINT_DISTANCE_CALC_VERSION
    || (
      flight.sixPointDistanceCalcVersion === SIX_POINT_DISTANCE_CALC_VERSION
      && (flight.sixPointDistanceMeters === null || flight.sixPointDistanceMetadata === null)
    );
}

export async function selectFlightScoreBatch(
  database: Pick<Database, 'execute'>,
  cursor: string | undefined,
  limit: number,
): Promise<FlightScoreCandidate[]> {
  const cursorCondition = cursor ? sql`AND flights.flight_id > ${cursor}` : sql``;
  const result = await database.execute<FlightScoreCandidate>(sql`
    SELECT
      flights.flight_id AS id,
      scores.total_distance_meters AS "totalDistanceMeters",
      scores.total_distance_calc_version AS "totalDistanceCalcVersion",
      scores.total_distance_metadata AS "totalDistanceMetadata",
      scores.six_point_distance_meters AS "sixPointDistanceMeters",
      scores.six_point_distance_calc_version AS "sixPointDistanceCalcVersion",
      scores.six_point_distance_metadata AS "sixPointDistanceMetadata"
    FROM flights
    LEFT JOIN flight_scores scores ON scores.flight_id = flights.flight_id
    WHERE flights.processing_status = 'completed'
      ${cursorCondition}
    ORDER BY flights.flight_id
    LIMIT ${limit}
  `);
  return result.rows;
}

export async function selectOrderedTrackPoints(
  database: Pick<Database, 'select'>,
  flightId: string,
): Promise<IgcFix[]> {
  return database.select({
    sequenceNumber: trackPoints.sequenceNumber,
    recordedAt: trackPoints.recordedAt,
    latitude: trackPoints.latitude,
    longitude: trackPoints.longitude,
    pressureAltitudeMeters: trackPoints.pressureAltitudeMeters,
    gpsAltitudeMeters: trackPoints.gpsAltitudeMeters,
  }).from(trackPoints)
    .where(eq(trackPoints.flightId, flightId))
    .orderBy(asc(trackPoints.sequenceNumber));
}

export async function upsertFlightScores(
  database: Pick<Database, 'execute'>,
  flightId: string,
  values: FlightScoreValues,
): Promise<boolean> {
  const totalMetadata = JSON.stringify(values.totalDistanceMetadata);
  const sixPointMetadata = JSON.stringify(values.sixPointDistanceMetadata);
  const result = await database.execute<{ flightId: string }>(sql`
    INSERT INTO flight_scores (
      flight_id,
      total_distance_meters,
      total_distance_calc_version,
      total_distance_metadata,
      six_point_distance_meters,
      six_point_distance_calc_version,
      six_point_distance_metadata
    ) VALUES (
      ${flightId},
      ${values.totalDistanceMeters},
      ${values.totalDistanceCalcVersion},
      ${totalMetadata}::jsonb,
      ${values.sixPointDistanceMeters},
      ${values.sixPointDistanceCalcVersion},
      ${sixPointMetadata}::jsonb
    )
    ON CONFLICT (flight_id) DO UPDATE SET
      total_distance_meters = CASE
        WHEN flight_scores.total_distance_calc_version IS NULL
          OR flight_scores.total_distance_calc_version < ${TOTAL_DISTANCE_CALC_VERSION}
          OR (
            flight_scores.total_distance_calc_version = ${TOTAL_DISTANCE_CALC_VERSION}
            AND (
              flight_scores.total_distance_meters IS NULL
              OR flight_scores.total_distance_metadata IS NULL
            )
          )
        THEN EXCLUDED.total_distance_meters
        ELSE flight_scores.total_distance_meters
      END,
      total_distance_calc_version = CASE
        WHEN flight_scores.total_distance_calc_version IS NULL
          OR flight_scores.total_distance_calc_version < ${TOTAL_DISTANCE_CALC_VERSION}
          OR (
            flight_scores.total_distance_calc_version = ${TOTAL_DISTANCE_CALC_VERSION}
            AND (
              flight_scores.total_distance_meters IS NULL
              OR flight_scores.total_distance_metadata IS NULL
            )
          )
        THEN EXCLUDED.total_distance_calc_version
        ELSE flight_scores.total_distance_calc_version
      END,
      total_distance_metadata = CASE
        WHEN flight_scores.total_distance_calc_version IS NULL
          OR flight_scores.total_distance_calc_version < ${TOTAL_DISTANCE_CALC_VERSION}
          OR (
            flight_scores.total_distance_calc_version = ${TOTAL_DISTANCE_CALC_VERSION}
            AND (
              flight_scores.total_distance_meters IS NULL
              OR flight_scores.total_distance_metadata IS NULL
            )
          )
        THEN EXCLUDED.total_distance_metadata
        ELSE flight_scores.total_distance_metadata
      END,
      six_point_distance_meters = CASE
        WHEN flight_scores.six_point_distance_calc_version IS NULL
          OR flight_scores.six_point_distance_calc_version < ${SIX_POINT_DISTANCE_CALC_VERSION}
          OR (
            flight_scores.six_point_distance_calc_version = ${SIX_POINT_DISTANCE_CALC_VERSION}
            AND (
              flight_scores.six_point_distance_meters IS NULL
              OR flight_scores.six_point_distance_metadata IS NULL
            )
          )
        THEN EXCLUDED.six_point_distance_meters
        ELSE flight_scores.six_point_distance_meters
      END,
      six_point_distance_calc_version = CASE
        WHEN flight_scores.six_point_distance_calc_version IS NULL
          OR flight_scores.six_point_distance_calc_version < ${SIX_POINT_DISTANCE_CALC_VERSION}
          OR (
            flight_scores.six_point_distance_calc_version = ${SIX_POINT_DISTANCE_CALC_VERSION}
            AND (
              flight_scores.six_point_distance_meters IS NULL
              OR flight_scores.six_point_distance_metadata IS NULL
            )
          )
        THEN EXCLUDED.six_point_distance_calc_version
        ELSE flight_scores.six_point_distance_calc_version
      END,
      six_point_distance_metadata = CASE
        WHEN flight_scores.six_point_distance_calc_version IS NULL
          OR flight_scores.six_point_distance_calc_version < ${SIX_POINT_DISTANCE_CALC_VERSION}
          OR (
            flight_scores.six_point_distance_calc_version = ${SIX_POINT_DISTANCE_CALC_VERSION}
            AND (
              flight_scores.six_point_distance_meters IS NULL
              OR flight_scores.six_point_distance_metadata IS NULL
            )
          )
        THEN EXCLUDED.six_point_distance_metadata
        ELSE flight_scores.six_point_distance_metadata
      END
    WHERE flight_scores.total_distance_calc_version IS NULL
      OR flight_scores.total_distance_calc_version < ${TOTAL_DISTANCE_CALC_VERSION}
      OR (
        flight_scores.total_distance_calc_version = ${TOTAL_DISTANCE_CALC_VERSION}
        AND (
          flight_scores.total_distance_meters IS NULL
          OR flight_scores.total_distance_metadata IS NULL
        )
      )
      OR flight_scores.six_point_distance_calc_version IS NULL
      OR flight_scores.six_point_distance_calc_version < ${SIX_POINT_DISTANCE_CALC_VERSION}
      OR (
        flight_scores.six_point_distance_calc_version = ${SIX_POINT_DISTANCE_CALC_VERSION}
        AND (
          flight_scores.six_point_distance_meters IS NULL
          OR flight_scores.six_point_distance_metadata IS NULL
        )
      )
    RETURNING flight_id AS "flightId"
  `);
  return result.rows.length > 0;
}

function currentTotalValues(flight: FlightScoreCandidate): Pick<
  FlightScoreValues,
  'totalDistanceMeters' | 'totalDistanceCalcVersion' | 'totalDistanceMetadata'
> {
  if (
    flight.totalDistanceMeters === null
    || flight.totalDistanceCalcVersion === null
    || flight.totalDistanceMetadata === null
  ) throw new Error('Current total-distance score is incomplete.');
  return {
    totalDistanceMeters: flight.totalDistanceMeters,
    totalDistanceCalcVersion: flight.totalDistanceCalcVersion,
    totalDistanceMetadata: flight.totalDistanceMetadata as Record<string, never>,
  };
}

function currentSixPointValues(flight: FlightScoreCandidate): Pick<
  FlightScoreValues,
  'sixPointDistanceMeters' | 'sixPointDistanceCalcVersion' | 'sixPointDistanceMetadata'
> {
  if (
    flight.sixPointDistanceMeters === null
    || flight.sixPointDistanceCalcVersion === null
    || flight.sixPointDistanceMetadata === null
  ) throw new Error('Current six-point score is incomplete.');
  return {
    sixPointDistanceMeters: flight.sixPointDistanceMeters,
    sixPointDistanceCalcVersion: flight.sixPointDistanceCalcVersion,
    sixPointDistanceMetadata: flight.sixPointDistanceMetadata as SixPointDistanceMetadata,
  };
}

export async function runFlightScoreBackfill(
  database: Database,
  options: FlightScoreBackfillOptions,
): Promise<FlightScoreBackfillSummary> {
  const batchSize = options.batchSize ?? DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0)
    throw new RangeError('Flight score backfill batch size must be a positive integer.');

  const logger = options.logger ?? console;
  const listFlights = options.listFlights
    ?? ((cursor, limit) => selectFlightScoreBatch(database, cursor, limit));
  const loadTrackPoints = options.loadTrackPoints
    ?? ((flightId) => selectOrderedTrackPoints(database, flightId));
  const calculateTotal = options.calculateTotalDistance ?? totalDistanceMeters;
  const calculateSixPoint = options.calculateSixPointDistance
    ?? calculateSixPointDistanceInWorker;
  const writeScores = options.writeScores
    ?? ((flightId, values) => upsertFlightScores(database, flightId, values));
  const summary: FlightScoreBackfillSummary = {
    mode: options.apply ? 'apply' : 'dry-run',
    batchSize,
    inspected: 0,
    calculated: 0,
    skipped: 0,
    written: 0,
    failed: 0,
  };

  let cursor: string | undefined;
  while (true) {
    const batch = await listFlights(cursor, batchSize);
    if (batch.length === 0) break;
    for (const flight of batch) {
      summary.inspected += 1;
      const needsTotal = totalScoreNeedsCalculation(flight);
      const needsSixPoint = sixPointScoreNeedsCalculation(flight);
      if (!needsTotal && !needsSixPoint) {
        summary.skipped += 1;
        continue;
      }

      try {
        const points = await loadTrackPoints(flight.id);
        const totalValues = needsTotal
          ? {
              totalDistanceMeters: calculateTotal(points),
              totalDistanceCalcVersion: TOTAL_DISTANCE_CALC_VERSION,
              totalDistanceMetadata: {},
            }
          : currentTotalValues(flight);
        const sixPointValues = needsSixPoint
          ? (() => calculateSixPoint(points).then((distance) => ({
              sixPointDistanceMeters: distance.distanceMeters,
              sixPointDistanceCalcVersion: SIX_POINT_DISTANCE_CALC_VERSION,
              sixPointDistanceMetadata: mapSixPointDistanceMetadata(points, distance),
            })))()
          : Promise.resolve(currentSixPointValues(flight));
        const values: FlightScoreValues = { ...totalValues, ...await sixPointValues };
        summary.calculated += 1;
        if (options.apply && await writeScores(flight.id, values)) summary.written += 1;
      } catch {
        summary.failed += 1;
        logger.error(`Unable to calculate flight scores for flight ${flight.id}.`);
      }
    }
    cursor = batch[batch.length - 1]!.id;
  }
  return summary;
}

export function printFlightScoreBackfillSummary(
  summary: FlightScoreBackfillSummary,
  logger: Logger = console,
): void {
  logger.log(`${summary.mode === 'dry-run' ? 'Dry-run' : 'Applied'} flight score backfill`);
  logger.log(`Flights inspected: ${summary.inspected}`);
  logger.log(`Flights calculated: ${summary.calculated}`);
  logger.log(`Flights skipped: ${summary.skipped}`);
  logger.log(`Score rows written: ${summary.written}`);
  logger.log(`Failures: ${summary.failed}`);
}

async function main(): Promise<void> {
  const args = parseFlightScoreBackfillArgs(process.argv.slice(2));
  if (args.help) {
    console.log(flightScoreBackfillUsage);
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = createDatabase(databaseUrl);
  try {
    const summary = await runFlightScoreBackfill(database.db, {
      apply: args.apply,
      batchSize: args.batchSize,
    });
    printFlightScoreBackfillSummary(summary);
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
