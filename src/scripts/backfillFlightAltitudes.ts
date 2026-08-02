import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/client.js';

export const DEFAULT_FLIGHT_ALTITUDE_BACKFILL_BATCH_SIZE = 100;

export type FlightAltitudeValues = {
  launchGpsAltitudeMeters: number;
  minGpsAltitudeMeters: number;
  maxGpsAltitudeMeters: number;
};

export type FlightAltitudeCandidate = FlightAltitudeValues & {
  id: string;
  storedLaunchGpsAltitudeMeters: number | string | null;
  storedMinGpsAltitudeMeters: number | string | null;
  storedMaxGpsAltitudeMeters: number | string | null;
};

export type FlightAltitudeBackfillSummary = {
  mode: 'dry-run' | 'apply';
  inspected: number;
  changed: number;
  skipped: number;
  written: number;
  failed: number;
};

type Logger = Pick<Console, 'log' | 'error'>;

export function parseFlightAltitudeBackfillArgs(argv: string[]) {
  if (argv.includes('--help')) return { help: true, apply: false, batchSize: DEFAULT_FLIGHT_ALTITUDE_BACKFILL_BATCH_SIZE };
  let apply = false;
  let batchSize = DEFAULT_FLIGHT_ALTITUDE_BACKFILL_BATCH_SIZE;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--batch-size' || arg?.startsWith('--batch-size=')) {
      const raw = arg === '--batch-size' ? argv[++index] : arg.slice('--batch-size='.length);
      if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) throw new Error('Batch size must be a positive integer.');
      batchSize = Number(raw);
    } else throw new Error(`Unknown argument: ${arg ?? ''}`);
  }
  return { help: false, apply, batchSize };
}

export async function selectFlightAltitudeBatch(
  database: Pick<Database, 'execute'>,
  cursor: string | undefined,
  limit: number,
): Promise<FlightAltitudeCandidate[]> {
  const cursorSql = cursor ? sql`AND flight.flight_id > ${cursor}` : sql``;
  const result = await database.execute<FlightAltitudeCandidate>(sql`
    SELECT flight.flight_id AS id,
      flight.launch_gps_altitude_meters AS "storedLaunchGpsAltitudeMeters",
      flight.min_gps_altitude_meters AS "storedMinGpsAltitudeMeters",
      flight.max_gps_altitude_meters AS "storedMaxGpsAltitudeMeters",
      first_point.gps_altitude_meters AS "launchGpsAltitudeMeters",
      altitude.minimum AS "minGpsAltitudeMeters",
      altitude.maximum AS "maxGpsAltitudeMeters"
    FROM flights flight
    INNER JOIN LATERAL (
      SELECT point.gps_altitude_meters
      FROM track_points point
      WHERE point.flight_id = flight.flight_id
      ORDER BY point.sequence_number
      LIMIT 1
    ) first_point ON true
    INNER JOIN LATERAL (
      SELECT MIN(point.gps_altitude_meters)::integer AS minimum,
        MAX(point.gps_altitude_meters)::integer AS maximum
      FROM track_points point
      WHERE point.flight_id = flight.flight_id
    ) altitude ON true
    WHERE flight.processing_status = 'completed' ${cursorSql}
    ORDER BY flight.flight_id
    LIMIT ${limit}
  `);
  return result.rows;
}

export async function writeFlightAltitudes(
  database: Pick<Database, 'execute'>,
  flightId: string,
  values: FlightAltitudeValues,
): Promise<boolean> {
  const result = await database.execute<{ id: string }>(sql`
    UPDATE flights SET
      launch_gps_altitude_meters = ${values.launchGpsAltitudeMeters},
      min_gps_altitude_meters = ${values.minGpsAltitudeMeters},
      max_gps_altitude_meters = ${values.maxGpsAltitudeMeters},
      updated_at = now()
    WHERE flight_id = ${flightId}
      AND (launch_gps_altitude_meters IS DISTINCT FROM ${values.launchGpsAltitudeMeters}
        OR min_gps_altitude_meters IS DISTINCT FROM ${values.minGpsAltitudeMeters}
        OR max_gps_altitude_meters IS DISTINCT FROM ${values.maxGpsAltitudeMeters})
    RETURNING flight_id AS id
  `);
  return result.rows.length > 0;
}

export async function runFlightAltitudeBackfill(
  database: Database,
  options: {
    apply: boolean;
    batchSize?: number;
    logger?: Logger;
    listFlights?: (cursor: string | undefined, limit: number) => Promise<FlightAltitudeCandidate[]>;
    writeValues?: (flightId: string, values: FlightAltitudeValues) => Promise<boolean>;
  },
): Promise<FlightAltitudeBackfillSummary> {
  const logger = options.logger ?? console;
  const batchSize = options.batchSize ?? DEFAULT_FLIGHT_ALTITUDE_BACKFILL_BATCH_SIZE;
  const listFlights = options.listFlights ?? ((cursor, limit) => selectFlightAltitudeBatch(database, cursor, limit));
  const writeValues = options.writeValues ?? ((flightId, values) => writeFlightAltitudes(database, flightId, values));
  const summary: FlightAltitudeBackfillSummary = {
    mode: options.apply ? 'apply' : 'dry-run', inspected: 0, changed: 0, skipped: 0, written: 0, failed: 0,
  };
  let cursor: string | undefined;
  let batchNum = 0;
  while (true) {
    const batch = await listFlights(cursor, batchSize);
    if (!batch.length) break;
    for (const flight of batch) {
      summary.inspected += 1;
      const values = {
        launchGpsAltitudeMeters: Number(flight.launchGpsAltitudeMeters),
        minGpsAltitudeMeters: Number(flight.minGpsAltitudeMeters),
        maxGpsAltitudeMeters: Number(flight.maxGpsAltitudeMeters),
      };
      const changed = Number(flight.storedLaunchGpsAltitudeMeters) !== values.launchGpsAltitudeMeters
        || Number(flight.storedMinGpsAltitudeMeters) !== values.minGpsAltitudeMeters
        || Number(flight.storedMaxGpsAltitudeMeters) !== values.maxGpsAltitudeMeters
        || flight.storedLaunchGpsAltitudeMeters === null
        || flight.storedMinGpsAltitudeMeters === null
        || flight.storedMaxGpsAltitudeMeters === null;
      if (!changed) {
        summary.skipped += 1;
        continue;
      }
      summary.changed += 1;
      if (!options.apply) continue;
      try {
        if (await writeValues(flight.id, values)) summary.written += 1;
      } catch {
        summary.failed += 1;
        logger.error(`Unable to backfill GPS altitude metrics for flight ${flight.id}.`);
      }
    }

    logger.log(`Completed batch ${batchNum}`);
    batchNum++;
    cursor = batch.at(-1)!.id;
  }
  return summary;
}

async function main() {
  const args = parseFlightAltitudeBackfillArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npm run backfill:flight-altitudes [-- --dry-run|--apply] [--batch-size N]');
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const database = createDatabase(databaseUrl);
  try {
    const summary = await runFlightAltitudeBackfill(database.db, args);
    console.log(summary);
    if (summary.failed) process.exitCode = 1;
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
