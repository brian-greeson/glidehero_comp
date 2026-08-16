import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';
import {
  FLIGHT_MAP_LOD_DEFINITIONS,
  FLIGHT_MAP_PROJECTION_VERSION,
  buildFlightMapProjection,
  type FlightMapPoint,
} from '../domain/flightMap/flightMapGeometry.js';
import { scoringProtectedSequenceNumbers, storeFlightMapProjection } from '../services/flightMapProjectionService.js';

export const DEFAULT_FLIGHT_MAP_BACKFILL_BATCH_SIZE = 25;
export const DEFAULT_FLIGHT_MAP_BACKFILL_LIMIT = 1_000;

type Logger = Pick<Console, 'log' | 'error'>;
type Candidate = { id: string };
type PointRow = FlightMapPoint;
type ScoreRow = {
  threePointDistanceMetadata: { points?: Array<{ sequenceNumber: number }> } | null;
  fourPointDistanceMetadata: { points?: Array<{ sequenceNumber: number }> } | null;
  fivePointDistanceMetadata: { points?: Array<{ sequenceNumber: number }> } | null;
  sixPointDistanceMetadata: { points?: Array<{ sequenceNumber: number }> } | null;
};

export type FlightMapBackfillSummary = {
  mode: 'dry-run' | 'apply';
  inspected: number;
  stale: number;
  written: number;
  failed: number;
  limited: boolean;
};

export function parseFlightMapBackfillArgs(argv: string[]) {
  let apply = false;
  let batchSize = DEFAULT_FLIGHT_MAP_BACKFILL_BATCH_SIZE;
  let limit = DEFAULT_FLIGHT_MAP_BACKFILL_LIMIT;
  if (argv.includes('--help')) return { help: true, apply, batchSize, limit };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--batch-size' || arg?.startsWith('--batch-size=')) {
      const raw = arg === '--batch-size' ? argv[++index] : arg.slice('--batch-size='.length);
      if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) throw new Error('Batch size must be a positive integer.');
      batchSize = Number(raw);
    } else if (arg === '--limit' || arg?.startsWith('--limit=')) {
      const raw = arg === '--limit' ? argv[++index] : arg.slice('--limit='.length);
      if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) throw new Error('Limit must be a positive integer.');
      limit = Number(raw);
    } else throw new Error(`Unknown argument: ${arg ?? ''}`);
  }
  return { help: false, apply, batchSize, limit };
}

export async function selectFlightMapBackfillBatch(
  database: Pick<Database, 'execute'>,
  cursor: string | undefined,
  limit: number,
): Promise<Candidate[]> {
  const cursorSql = cursor ? sql`AND flight.flight_id > ${cursor}` : sql``;
  const result = await database.execute<Candidate>(sql`
    SELECT flight.flight_id AS id
    FROM flights flight
    LEFT JOIN flight_map_features feature ON feature.flight_id = flight.flight_id
    WHERE flight.processing_status = 'completed'
      AND (SELECT COUNT(*) FROM track_points point WHERE point.flight_id = flight.flight_id) >= 2
      AND (
        feature.flight_id IS NULL
        OR feature.projection_version <> ${FLIGHT_MAP_PROJECTION_VERSION}
        OR feature.source_point_count <> (SELECT COUNT(*)::integer FROM track_points point WHERE point.flight_id = flight.flight_id)
        OR (SELECT COUNT(*) FROM flight_map_geometry_lods lod
            WHERE lod.flight_id = flight.flight_id
              AND lod.projection_version = ${FLIGHT_MAP_PROJECTION_VERSION}) <> ${FLIGHT_MAP_LOD_DEFINITIONS.length}
      )
      ${cursorSql}
    ORDER BY flight.flight_id
    LIMIT ${limit}
  `);
  return result.rows;
}

async function loadFlightMapProjectionInput(database: Pick<Database, 'execute'>, flightId: string) {
  const [pointsResult, scoreResult] = await Promise.all([
    database.execute<PointRow>(sql`
      SELECT sequence_number AS "sequenceNumber", latitude, longitude
      FROM track_points WHERE flight_id = ${flightId} ORDER BY sequence_number
    `),
    database.execute<ScoreRow>(sql`
      SELECT three_point_distance_metadata AS "threePointDistanceMetadata",
        four_point_distance_metadata AS "fourPointDistanceMetadata",
        five_point_distance_metadata AS "fivePointDistanceMetadata",
        six_point_distance_metadata AS "sixPointDistanceMetadata"
      FROM flight_scores WHERE flight_id = ${flightId}
    `),
  ]);
  const score = scoreResult.rows[0];
  return {
    points: pointsResult.rows,
    protectedSequenceNumbers: scoringProtectedSequenceNumbers(score ? {
      threePointDistance: score.threePointDistanceMetadata ?? undefined,
      fourPointDistance: score.fourPointDistanceMetadata ?? undefined,
      fivePointDistance: score.fivePointDistanceMetadata ?? undefined,
      sixPointDistance: score.sixPointDistanceMetadata ?? undefined,
    } : undefined),
  };
}

export async function runFlightMapBackfill(
  database: Database,
  options: {
    apply: boolean;
    batchSize?: number;
    limit?: number;
    logger?: Logger;
    listCandidates?: (cursor: string | undefined, limit: number) => Promise<Candidate[]>;
    loadInput?: (flightId: string) => ReturnType<typeof loadFlightMapProjectionInput>;
    writeProjection?: (flightId: string, projection: ReturnType<typeof buildFlightMapProjection>) => Promise<void>;
  },
): Promise<FlightMapBackfillSummary> {
  const logger = options.logger ?? console;
  const batchSize = options.batchSize ?? DEFAULT_FLIGHT_MAP_BACKFILL_BATCH_SIZE;
  const limit = options.limit ?? DEFAULT_FLIGHT_MAP_BACKFILL_LIMIT;
  const summary: FlightMapBackfillSummary = {
    mode: options.apply ? 'apply' : 'dry-run', inspected: 0, stale: 0, written: 0, failed: 0, limited: false,
  };
  const listCandidates = options.listCandidates
    ?? ((cursor, candidateLimit) => selectFlightMapBackfillBatch(database, cursor, candidateLimit));
  const loadInput = options.loadInput ?? ((flightId) => loadFlightMapProjectionInput(database, flightId));
  const writeProjection = options.writeProjection
    ?? ((flightId, projection) => database.transaction((tx) => storeFlightMapProjection(tx, flightId, projection)));
  let cursor: string | undefined;
  while (summary.inspected < limit) {
    const remaining = limit - summary.inspected;
    const batch = await listCandidates(cursor, Math.min(batchSize, remaining));
    if (!batch.length) break;
    for (const candidate of batch) {
      summary.inspected += 1;
      summary.stale += 1;
      if (!options.apply) continue;
      try {
        const input = await loadInput(candidate.id);
        const projection = buildFlightMapProjection(input.points, input.protectedSequenceNumbers);
        await writeProjection(candidate.id, projection);
        summary.written += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(`Unable to backfill flight map geometry for ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    cursor = batch.at(-1)!.id;
    logger.log(`Inspected ${summary.inspected} stale flight map projections.`);
    if (batch.length < Math.min(batchSize, remaining)) break;
  }
  if (summary.inspected === limit) {
    const more = await listCandidates(cursor, 1);
    summary.limited = more.length > 0;
  }
  return summary;
}

async function main() {
  const args = parseFlightMapBackfillArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run backfill:flight-map [-- --dry-run|--apply] [--batch-size N] [--limit N]');
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const { db, pool } = createDatabase(databaseUrl);
  try {
    const summary = await runFlightMapBackfill(db, args);
    console.log(summary);
    if (summary.failed || summary.limited) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
