import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';
import { trackPoints } from '../db/schema.js';
import {
  FIVE_POINT_DISTANCE_CALC_VERSION,
  FOUR_POINT_DISTANCE_CALC_VERSION,
  mapNPointDistanceMetadata,
  SIX_POINT_DISTANCE_CALC_VERSION,
  THREE_POINT_DISTANCE_CALC_VERSION,
  TOTAL_DISTANCE_CALC_VERSION,
  totalDistanceMeters,
  type NPointDistances,
  type PointDistanceMetadata,
} from '../domain/igc/distance.js';
import { calculateNPointDistancesInWorker } from '../domain/igc/nPointDistanceWorkerAdapter.js';
import type { IgcFix } from '../domain/igc/types.js';

export const DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE = 10;
const APPLY = '--apply';
const DRY_RUN = '--dry-run';
const HELP = '--help';
const BATCH_SIZE = '--batch-size';

export const flightScoreBackfillUsage = `Usage: npm run backfill:flight-scores [-- --dry-run|--apply] [--batch-size <positive integer>]

Dry-run is the default and does not write flight scores. Pass --apply to persist them.
Calculates the best chronologically ordered 3-, 4-, 5-, and 6-point routes in one solver pass.
Existing route scores with newer calculation versions are preserved independently.
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
  threePointDistanceMeters: number | null;
  threePointDistanceCalcVersion: number | null;
  threePointDistanceMetadata: unknown | null;
  fourPointDistanceMeters: number | null;
  fourPointDistanceCalcVersion: number | null;
  fourPointDistanceMetadata: unknown | null;
  fivePointDistanceMeters: number | null;
  fivePointDistanceCalcVersion: number | null;
  fivePointDistanceMetadata: unknown | null;
  sixPointDistanceMeters: number | null;
  sixPointDistanceCalcVersion: number | null;
  sixPointDistanceMetadata: unknown | null;
};

export type FlightScoreValues = {
  totalDistanceMeters: number;
  totalDistanceCalcVersion: number;
  totalDistanceMetadata: Record<string, never>;
  threePointDistanceMeters: number;
  threePointDistanceCalcVersion: number;
  threePointDistanceMetadata: PointDistanceMetadata<3>;
  fourPointDistanceMeters: number;
  fourPointDistanceCalcVersion: number;
  fourPointDistanceMetadata: PointDistanceMetadata<4>;
  fivePointDistanceMeters: number;
  fivePointDistanceCalcVersion: number;
  fivePointDistanceMetadata: PointDistanceMetadata<5>;
  sixPointDistanceMeters: number;
  sixPointDistanceCalcVersion: number;
  sixPointDistanceMetadata: PointDistanceMetadata<6>;
};

export type RouteBackfillCounters = {
  calculated: number;
  skipped: number;
  updated: number;
};

export type FlightScoreBackfillSummary = {
  mode: 'dry-run' | 'apply';
  batchSize: number;
  inspected: number;
  calculated: number;
  skipped: number;
  written: number;
  failed: number;
  routes: {
    threePoint: RouteBackfillCounters;
    fourPoint: RouteBackfillCounters;
    fivePoint: RouteBackfillCounters;
    sixPoint: RouteBackfillCounters;
  };
};

export type FlightScoreBackfillOptions = {
  apply: boolean;
  batchSize?: number;
  logger?: Logger;
  /** Test seams. Production uses PostgreSQL and the exact scoring implementations. */
  listFlights?: (cursor: string | undefined, limit: number) => Promise<FlightScoreCandidate[]>;
  loadTrackPoints?: (flightId: string) => Promise<IgcFix[]>;
  calculateTotalDistance?: (points: readonly IgcFix[]) => number;
  calculateNPointDistances?: (points: readonly IgcFix[]) => Promise<NPointDistances>;
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

function routeScoreNeedsCalculation(
  calculationVersion: number | null,
  distanceMeters: number | null,
  metadata: unknown | null,
  currentVersion: number,
): boolean {
  return calculationVersion === null
    || calculationVersion < currentVersion
    || (
      calculationVersion === currentVersion
      && (distanceMeters === null || metadata === null)
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
      scores.three_point_distance_meters AS "threePointDistanceMeters",
      scores.three_point_distance_calc_version AS "threePointDistanceCalcVersion",
      scores.three_point_distance_metadata AS "threePointDistanceMetadata",
      scores.four_point_distance_meters AS "fourPointDistanceMeters",
      scores.four_point_distance_calc_version AS "fourPointDistanceCalcVersion",
      scores.four_point_distance_metadata AS "fourPointDistanceMetadata",
      scores.five_point_distance_meters AS "fivePointDistanceMeters",
      scores.five_point_distance_calc_version AS "fivePointDistanceCalcVersion",
      scores.five_point_distance_metadata AS "fivePointDistanceMetadata",
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
  const threePointMetadata = JSON.stringify(values.threePointDistanceMetadata);
  const fourPointMetadata = JSON.stringify(values.fourPointDistanceMetadata);
  const fivePointMetadata = JSON.stringify(values.fivePointDistanceMetadata);
  const sixPointMetadata = JSON.stringify(values.sixPointDistanceMetadata);
  const totalNeedsUpdate = sql`
    flight_scores.total_distance_calc_version IS NULL
    OR flight_scores.total_distance_calc_version < ${TOTAL_DISTANCE_CALC_VERSION}
    OR (
      flight_scores.total_distance_calc_version = ${TOTAL_DISTANCE_CALC_VERSION}
      AND (
        flight_scores.total_distance_meters IS NULL
        OR flight_scores.total_distance_metadata IS NULL
      )
    )
  `;
  const threePointNeedsUpdate = sql`
    flight_scores.three_point_distance_calc_version IS NULL
    OR flight_scores.three_point_distance_calc_version < ${THREE_POINT_DISTANCE_CALC_VERSION}
    OR (
      flight_scores.three_point_distance_calc_version = ${THREE_POINT_DISTANCE_CALC_VERSION}
      AND (
        flight_scores.three_point_distance_meters IS NULL
        OR flight_scores.three_point_distance_metadata IS NULL
      )
    )
  `;
  const fourPointNeedsUpdate = sql`
    flight_scores.four_point_distance_calc_version IS NULL
    OR flight_scores.four_point_distance_calc_version < ${FOUR_POINT_DISTANCE_CALC_VERSION}
    OR (
      flight_scores.four_point_distance_calc_version = ${FOUR_POINT_DISTANCE_CALC_VERSION}
      AND (
        flight_scores.four_point_distance_meters IS NULL
        OR flight_scores.four_point_distance_metadata IS NULL
      )
    )
  `;
  const fivePointNeedsUpdate = sql`
    flight_scores.five_point_distance_calc_version IS NULL
    OR flight_scores.five_point_distance_calc_version < ${FIVE_POINT_DISTANCE_CALC_VERSION}
    OR (
      flight_scores.five_point_distance_calc_version = ${FIVE_POINT_DISTANCE_CALC_VERSION}
      AND (
        flight_scores.five_point_distance_meters IS NULL
        OR flight_scores.five_point_distance_metadata IS NULL
      )
    )
  `;
  const sixPointNeedsUpdate = sql`
    flight_scores.six_point_distance_calc_version IS NULL
    OR flight_scores.six_point_distance_calc_version < ${SIX_POINT_DISTANCE_CALC_VERSION}
    OR (
      flight_scores.six_point_distance_calc_version = ${SIX_POINT_DISTANCE_CALC_VERSION}
      AND (
        flight_scores.six_point_distance_meters IS NULL
        OR flight_scores.six_point_distance_metadata IS NULL
      )
    )
  `;
  const result = await database.execute<{ flightId: string }>(sql`
    INSERT INTO flight_scores (
      flight_id,
      total_distance_meters,
      total_distance_calc_version,
      total_distance_metadata,
      three_point_distance_meters,
      three_point_distance_calc_version,
      three_point_distance_metadata,
      four_point_distance_meters,
      four_point_distance_calc_version,
      four_point_distance_metadata,
      five_point_distance_meters,
      five_point_distance_calc_version,
      five_point_distance_metadata,
      six_point_distance_meters,
      six_point_distance_calc_version,
      six_point_distance_metadata
    ) VALUES (
      ${flightId},
      ${values.totalDistanceMeters},
      ${values.totalDistanceCalcVersion},
      ${totalMetadata}::jsonb,
      ${values.threePointDistanceMeters},
      ${values.threePointDistanceCalcVersion},
      ${threePointMetadata}::jsonb,
      ${values.fourPointDistanceMeters},
      ${values.fourPointDistanceCalcVersion},
      ${fourPointMetadata}::jsonb,
      ${values.fivePointDistanceMeters},
      ${values.fivePointDistanceCalcVersion},
      ${fivePointMetadata}::jsonb,
      ${values.sixPointDistanceMeters},
      ${values.sixPointDistanceCalcVersion},
      ${sixPointMetadata}::jsonb
    )
    ON CONFLICT (flight_id) DO UPDATE SET
      total_distance_meters = CASE
        WHEN ${totalNeedsUpdate}
        THEN EXCLUDED.total_distance_meters
        ELSE flight_scores.total_distance_meters
      END,
      total_distance_calc_version = CASE
        WHEN ${totalNeedsUpdate}
        THEN EXCLUDED.total_distance_calc_version
        ELSE flight_scores.total_distance_calc_version
      END,
      total_distance_metadata = CASE
        WHEN ${totalNeedsUpdate}
        THEN EXCLUDED.total_distance_metadata
        ELSE flight_scores.total_distance_metadata
      END,
      three_point_distance_meters = CASE
        WHEN ${threePointNeedsUpdate}
        THEN EXCLUDED.three_point_distance_meters
        ELSE flight_scores.three_point_distance_meters
      END,
      three_point_distance_calc_version = CASE
        WHEN ${threePointNeedsUpdate}
        THEN EXCLUDED.three_point_distance_calc_version
        ELSE flight_scores.three_point_distance_calc_version
      END,
      three_point_distance_metadata = CASE
        WHEN ${threePointNeedsUpdate}
        THEN EXCLUDED.three_point_distance_metadata
        ELSE flight_scores.three_point_distance_metadata
      END,
      four_point_distance_meters = CASE
        WHEN ${fourPointNeedsUpdate}
        THEN EXCLUDED.four_point_distance_meters
        ELSE flight_scores.four_point_distance_meters
      END,
      four_point_distance_calc_version = CASE
        WHEN ${fourPointNeedsUpdate}
        THEN EXCLUDED.four_point_distance_calc_version
        ELSE flight_scores.four_point_distance_calc_version
      END,
      four_point_distance_metadata = CASE
        WHEN ${fourPointNeedsUpdate}
        THEN EXCLUDED.four_point_distance_metadata
        ELSE flight_scores.four_point_distance_metadata
      END,
      five_point_distance_meters = CASE
        WHEN ${fivePointNeedsUpdate}
        THEN EXCLUDED.five_point_distance_meters
        ELSE flight_scores.five_point_distance_meters
      END,
      five_point_distance_calc_version = CASE
        WHEN ${fivePointNeedsUpdate}
        THEN EXCLUDED.five_point_distance_calc_version
        ELSE flight_scores.five_point_distance_calc_version
      END,
      five_point_distance_metadata = CASE
        WHEN ${fivePointNeedsUpdate}
        THEN EXCLUDED.five_point_distance_metadata
        ELSE flight_scores.five_point_distance_metadata
      END,
      six_point_distance_meters = CASE
        WHEN ${sixPointNeedsUpdate}
        THEN EXCLUDED.six_point_distance_meters
        ELSE flight_scores.six_point_distance_meters
      END,
      six_point_distance_calc_version = CASE
        WHEN ${sixPointNeedsUpdate}
        THEN EXCLUDED.six_point_distance_calc_version
        ELSE flight_scores.six_point_distance_calc_version
      END,
      six_point_distance_metadata = CASE
        WHEN ${sixPointNeedsUpdate}
        THEN EXCLUDED.six_point_distance_metadata
        ELSE flight_scores.six_point_distance_metadata
      END
    WHERE ${totalNeedsUpdate}
      OR ${threePointNeedsUpdate}
      OR ${fourPointNeedsUpdate}
      OR ${fivePointNeedsUpdate}
      OR ${sixPointNeedsUpdate}
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

function currentRouteValues<PointCount extends 3 | 4 | 5 | 6>(
  distanceMeters: number | null,
  calculationVersion: number | null,
  metadata: unknown | null,
  label: string,
): {
  distanceMeters: number;
  calculationVersion: number;
  metadata: PointDistanceMetadata<PointCount>;
} {
  if (distanceMeters === null || calculationVersion === null || metadata === null) {
    throw new Error(`Current ${label} score is incomplete.`);
  }
  return {
    distanceMeters,
    calculationVersion,
    metadata: metadata as PointDistanceMetadata<PointCount>,
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
  const calculateNPoint = options.calculateNPointDistances
    ?? calculateNPointDistancesInWorker;
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
    routes: {
      threePoint: { calculated: 0, skipped: 0, updated: 0 },
      fourPoint: { calculated: 0, skipped: 0, updated: 0 },
      fivePoint: { calculated: 0, skipped: 0, updated: 0 },
      sixPoint: { calculated: 0, skipped: 0, updated: 0 },
    },
  };

  let cursor: string | undefined;
  let batchNumber = 0;
  while (true) {
    const batch = await listFlights(cursor, batchSize);
    if (batch.length === 0) break;
    batchNumber += 1;
    for (const flight of batch) {
      summary.inspected += 1;
      const needsTotal = totalScoreNeedsCalculation(flight);
      const needsThreePoint = routeScoreNeedsCalculation(
        flight.threePointDistanceCalcVersion,
        flight.threePointDistanceMeters,
        flight.threePointDistanceMetadata,
        THREE_POINT_DISTANCE_CALC_VERSION,
      );
      const needsFourPoint = routeScoreNeedsCalculation(
        flight.fourPointDistanceCalcVersion,
        flight.fourPointDistanceMeters,
        flight.fourPointDistanceMetadata,
        FOUR_POINT_DISTANCE_CALC_VERSION,
      );
      const needsFivePoint = routeScoreNeedsCalculation(
        flight.fivePointDistanceCalcVersion,
        flight.fivePointDistanceMeters,
        flight.fivePointDistanceMetadata,
        FIVE_POINT_DISTANCE_CALC_VERSION,
      );
      const needsSixPoint = routeScoreNeedsCalculation(
        flight.sixPointDistanceCalcVersion,
        flight.sixPointDistanceMeters,
        flight.sixPointDistanceMetadata,
        SIX_POINT_DISTANCE_CALC_VERSION,
      );
      const needsAnyRoute = needsThreePoint || needsFourPoint || needsFivePoint || needsSixPoint;
      if (!needsThreePoint) summary.routes.threePoint.skipped += 1;
      if (!needsFourPoint) summary.routes.fourPoint.skipped += 1;
      if (!needsFivePoint) summary.routes.fivePoint.skipped += 1;
      if (!needsSixPoint) summary.routes.sixPoint.skipped += 1;
      if (!needsTotal && !needsAnyRoute) {
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
        const calculatedMetadata = needsAnyRoute
          ? mapNPointDistanceMetadata(points, await calculateNPoint(points))
          : undefined;
        const threePoint = needsThreePoint
          ? {
              distanceMeters: calculatedMetadata!.threePointDistance.distanceMeters,
              calculationVersion: THREE_POINT_DISTANCE_CALC_VERSION,
              metadata: calculatedMetadata!.threePointDistance,
            }
          : currentRouteValues<3>(
              flight.threePointDistanceMeters,
              flight.threePointDistanceCalcVersion,
              flight.threePointDistanceMetadata,
              'three-point',
            );
        const fourPoint = needsFourPoint
          ? {
              distanceMeters: calculatedMetadata!.fourPointDistance.distanceMeters,
              calculationVersion: FOUR_POINT_DISTANCE_CALC_VERSION,
              metadata: calculatedMetadata!.fourPointDistance,
            }
          : currentRouteValues<4>(
              flight.fourPointDistanceMeters,
              flight.fourPointDistanceCalcVersion,
              flight.fourPointDistanceMetadata,
              'four-point',
            );
        const fivePoint = needsFivePoint
          ? {
              distanceMeters: calculatedMetadata!.fivePointDistance.distanceMeters,
              calculationVersion: FIVE_POINT_DISTANCE_CALC_VERSION,
              metadata: calculatedMetadata!.fivePointDistance,
            }
          : currentRouteValues<5>(
              flight.fivePointDistanceMeters,
              flight.fivePointDistanceCalcVersion,
              flight.fivePointDistanceMetadata,
              'five-point',
            );
        const sixPoint = needsSixPoint
          ? {
              distanceMeters: calculatedMetadata!.sixPointDistance.distanceMeters,
              calculationVersion: SIX_POINT_DISTANCE_CALC_VERSION,
              metadata: calculatedMetadata!.sixPointDistance,
            }
          : currentRouteValues<6>(
              flight.sixPointDistanceMeters,
              flight.sixPointDistanceCalcVersion,
              flight.sixPointDistanceMetadata,
              'six-point',
            );
        const values: FlightScoreValues = {
          ...totalValues,
          threePointDistanceMeters: threePoint.distanceMeters,
          threePointDistanceCalcVersion: threePoint.calculationVersion,
          threePointDistanceMetadata: threePoint.metadata,
          fourPointDistanceMeters: fourPoint.distanceMeters,
          fourPointDistanceCalcVersion: fourPoint.calculationVersion,
          fourPointDistanceMetadata: fourPoint.metadata,
          fivePointDistanceMeters: fivePoint.distanceMeters,
          fivePointDistanceCalcVersion: fivePoint.calculationVersion,
          fivePointDistanceMetadata: fivePoint.metadata,
          sixPointDistanceMeters: sixPoint.distanceMeters,
          sixPointDistanceCalcVersion: sixPoint.calculationVersion,
          sixPointDistanceMetadata: sixPoint.metadata,
        };
        summary.calculated += 1;
        if (needsThreePoint) summary.routes.threePoint.calculated += 1;
        if (needsFourPoint) summary.routes.fourPoint.calculated += 1;
        if (needsFivePoint) summary.routes.fivePoint.calculated += 1;
        if (needsSixPoint) summary.routes.sixPoint.calculated += 1;
        if (options.apply && await writeScores(flight.id, values)) {
          summary.written += 1;
          if (needsThreePoint) summary.routes.threePoint.updated += 1;
          if (needsFourPoint) summary.routes.fourPoint.updated += 1;
          if (needsFivePoint) summary.routes.fivePoint.updated += 1;
          if (needsSixPoint) summary.routes.sixPoint.updated += 1;
        }
      } catch {
        summary.failed += 1;
        logger.error(`Unable to calculate flight scores for flight ${flight.id}.`);
      }
    }
    logger.log(
      `Completed flight score batch ${batchNumber} (${batch.length} flight${batch.length === 1 ? '' : 's'}): `
        + `${summary.inspected} inspected, ${summary.calculated} calculated, `
        + `${summary.skipped} skipped, ${summary.written} written, ${summary.failed} failed`,
    );
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
  logger.log(
    `3-point routes: ${summary.routes.threePoint.calculated} calculated, `
      + `${summary.routes.threePoint.skipped} skipped, ${summary.routes.threePoint.updated} updated`,
  );
  logger.log(
    `4-point routes: ${summary.routes.fourPoint.calculated} calculated, `
      + `${summary.routes.fourPoint.skipped} skipped, ${summary.routes.fourPoint.updated} updated`,
  );
  logger.log(
    `5-point routes: ${summary.routes.fivePoint.calculated} calculated, `
      + `${summary.routes.fivePoint.skipped} skipped, ${summary.routes.fivePoint.updated} updated`,
  );
  logger.log(
    `6-point routes: ${summary.routes.sixPoint.calculated} calculated, `
      + `${summary.routes.sixPoint.skipped} skipped, ${summary.routes.sixPoint.updated} updated`,
  );
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
