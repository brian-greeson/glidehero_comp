import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { HeadObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { parseConfig } from '../config.js';
import { createDatabase, type Database } from '../db/client.js';
import { createBucketClient } from '../resources/bucketClient.js';
import { flightThumbnailKeys } from '../services/flightThumbnailService.js';
import { USER_ACHIEVEMENT_PROGRESS_COMPLETE_VERSION } from '../services/userAchievementProgressService.js';

const SAMPLE_SIZE = 2;

export const releaseBackfillVerificationUsage = `Usage: npm run verify:release-backfills

Read-only spot checks for every release backfill. The command samples up to two
of the oldest eligible records for each backfill. PASS means every sampled
record has its expected artifact, FAIL means at least one artifact is missing,
SKIP means there is no eligible data to sample, and ERROR means a check could
not be performed.
`;

type CheckStatus = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';
type SampleRow = { id: string; artifactPresent: boolean };
type UserAchievementProgressSample = { id: string; projectionVersion: number | string | null };
type ThumbnailFlight = { id: string; userId: string };

export type ReleaseBackfillSpotCheck = {
  name: string;
  status: CheckStatus;
  sampled: number;
  present: number;
  missingIds: string[];
  error?: string;
};

export function summarizeReleaseBackfillSpotCheck(
  name: string,
  samples: readonly SampleRow[],
): ReleaseBackfillSpotCheck {
  const present = samples.filter((sample) => sample.artifactPresent).length;
  return {
    name,
    status: samples.length === 0 ? 'SKIP' : present === samples.length ? 'PASS' : 'FAIL',
    sampled: samples.length,
    present,
    missingIds: samples.filter((sample) => !sample.artifactPresent).map((sample) => sample.id),
  };
}

async function checkFlightProgress(database: Database): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<SampleRow>(sql`
    WITH sample AS (
      SELECT flight_id AS id
      FROM flights
      WHERE processing_status = 'completed'
      ORDER BY COALESCE(processed_at, created_at), flight_id
      LIMIT ${SAMPLE_SIZE}
    )
    SELECT sample.id, (progress.flight_id IS NOT NULL) AS "artifactPresent"
    FROM sample
    LEFT JOIN flight_progress progress ON progress.flight_id = sample.id
    ORDER BY sample.id
  `);
  return summarizeReleaseBackfillSpotCheck('flight-progress', result.rows);
}

export async function checkFlightAltitudes(database: Database): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<SampleRow>(sql`
    WITH sample AS (
      SELECT flight.flight_id AS id
      FROM flights flight
      WHERE flight.processing_status = 'completed'
        AND EXISTS (SELECT 1 FROM track_points point WHERE point.flight_id = flight.flight_id)
      ORDER BY COALESCE(flight.processed_at, flight.created_at), flight.flight_id
      LIMIT ${SAMPLE_SIZE}
    )
    SELECT sample.id,
      flight.launch_gps_altitude_meters = first_point.gps_altitude_meters
      AND flight.min_gps_altitude_meters = altitude.minimum
      AND flight.max_gps_altitude_meters = altitude.maximum AS "artifactPresent"
    FROM sample
    INNER JOIN flights flight ON flight.flight_id = sample.id
    INNER JOIN LATERAL (
      SELECT point.gps_altitude_meters
      FROM track_points point WHERE point.flight_id = sample.id
      ORDER BY point.sequence_number LIMIT 1
    ) first_point ON true
    INNER JOIN LATERAL (
      SELECT MIN(point.gps_altitude_meters)::integer AS minimum,
        MAX(point.gps_altitude_meters)::integer AS maximum
      FROM track_points point WHERE point.flight_id = sample.id
    ) altitude ON true
    ORDER BY sample.id
  `);
  return summarizeReleaseBackfillSpotCheck('flight-altitudes', result.rows);
}

async function checkArenaAchievements(database: Database): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<SampleRow>(sql`
    WITH first_qualifying_flight AS (
      SELECT DISTINCT ON (flight.user_id)
        flight.flight_id AS id,
        flight.user_id,
        COALESCE(flight.started_at, flight.created_at) AS occurred_at
      FROM flights flight
      INNER JOIN arenas arena
        ON arena.arena_type = 'launch'
       AND ST_Covers(
         arena.area,
         ST_Transform(
           ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326),
           6933
         )
       )
      WHERE flight.processing_status = 'completed'
        AND flight.launch_longitude IS NOT NULL
        AND flight.launch_latitude IS NOT NULL
      ORDER BY flight.user_id, COALESCE(flight.started_at, flight.created_at), flight.created_at, flight.flight_id
    ), sample AS (
      SELECT * FROM first_qualifying_flight
      ORDER BY occurred_at, id
      LIMIT ${SAMPLE_SIZE}
    )
    SELECT sample.id,
      EXISTS (
        SELECT 1 FROM achievements achievement
        WHERE achievement.user_id = sample.user_id
          AND achievement.achievement_key = 'first_flight_from_launch'
      ) AS "artifactPresent"
    FROM sample
    ORDER BY sample.id
  `);
  return summarizeReleaseBackfillSpotCheck('arena-achievements', result.rows);
}

async function checkArenaLeadership(database: Database): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<SampleRow>(sql`
    WITH sample AS (
      SELECT id
      FROM arenas
      WHERE arena_type IN ('general', 'state', 'country')
      ORDER BY id
      LIMIT ${SAMPLE_SIZE}
    )
    SELECT sample.id, (state.arena_id IS NOT NULL) AS "artifactPresent"
    FROM sample
    LEFT JOIN arena_leadership_states state ON state.arena_id = sample.id
    ORDER BY sample.id
  `);
  return summarizeReleaseBackfillSpotCheck('arena-leadership', result.rows);
}

export async function checkUserAchievementProgress(database: Database): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<UserAchievementProgressSample>(sql`
    WITH sample AS (
      SELECT user_id AS id
      FROM profiles
      ORDER BY created_at, user_id
      LIMIT ${SAMPLE_SIZE}
    )
    SELECT sample.id, progress.projection_version AS "projectionVersion"
    FROM sample
    LEFT JOIN user_achievement_progress progress ON progress.user_id = sample.id
    ORDER BY sample.id
  `);
  return summarizeReleaseBackfillSpotCheck('user-achievement-progress', result.rows.map((row) => ({
    id: row.id,
    artifactPresent: Number(row.projectionVersion) === USER_ACHIEVEMENT_PROGRESS_COMPLETE_VERSION,
  })));
}

async function checkUserArenaProgress(database: Database): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<SampleRow>(sql`
    WITH eligible AS (
      SELECT DISTINCT claims.claim_user AS id
      FROM user_grid_claims claims
      INNER JOIN arenas arena
        ON arena.arena_type IN ('general', 'state', 'country')
       AND ST_Covers(
         arena.area,
         ST_SetSRID(ST_MakePoint((claims.x * 500) + 250, (claims.y * 500) + 250), 6933)
       )
       AND (
         arena.arena_type = 'general'
         OR (
           arena.external_id IS NOT NULL
           AND btrim(arena.external_id) <> ''
           AND NOT EXISTS (
             SELECT 1 FROM arenas peer
             WHERE peer.arena_type = arena.arena_type
               AND peer.id <> arena.id
               AND peer.external_id IS NOT NULL
               AND btrim(peer.external_id) <> ''
               AND peer.external_id COLLATE "C" < arena.external_id COLLATE "C"
               AND ST_Covers(
                 peer.area,
                 ST_SetSRID(ST_MakePoint((claims.x * 500) + 250, (claims.y * 500) + 250), 6933)
               )
           )
         )
       )
      UNION
      SELECT DISTINCT flight.user_id AS id
      FROM flights flight
      INNER JOIN arenas arena
        ON arena.arena_type = 'launch'
       AND flight.launch_latitude IS NOT NULL
       AND flight.launch_longitude IS NOT NULL
       AND flight.processing_status = 'completed'
       AND ST_Covers(
         arena.area,
         ST_Transform(
           ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326),
           6933
         )
       )
    ), sample AS (
      SELECT id FROM eligible ORDER BY id LIMIT ${SAMPLE_SIZE}
    )
    SELECT sample.id,
      EXISTS (
        SELECT 1 FROM user_arena_progress progress
        WHERE progress.user_id = sample.id
      ) AS "artifactPresent"
    FROM sample
    ORDER BY sample.id
  `);
  return summarizeReleaseBackfillSpotCheck('user-arena-progress', result.rows);
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return candidate.name === 'NotFound'
    || candidate.name === 'NoSuchKey'
    || candidate.Code === 'NoSuchKey'
    || candidate.$metadata?.httpStatusCode === 404;
}

async function objectExists(
  s3Client: Pick<S3, 'send'>,
  bucketName: string,
  key: string,
): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function checkFlightThumbnails(
  database: Database,
  s3Client: Pick<S3, 'send'>,
  bucketName: string,
  bucketFolder: string,
): Promise<ReleaseBackfillSpotCheck> {
  const result = await database.execute<ThumbnailFlight>(sql`
    SELECT flight.flight_id AS id, flight.user_id AS "userId"
    FROM flights flight
    WHERE flight.processing_status = 'completed'
      AND EXISTS (SELECT 1 FROM track_points point WHERE point.flight_id = flight.flight_id)
      AND EXISTS (SELECT 1 FROM user_grid_claims claim WHERE claim.claim_flight = flight.flight_id)
    ORDER BY COALESCE(flight.processed_at, flight.created_at), flight.flight_id
    LIMIT ${SAMPLE_SIZE}
  `);
  const samples: SampleRow[] = [];
  for (const flight of result.rows) {
    const keys = flightThumbnailKeys(bucketFolder, flight.userId, flight.id);
    const widePresent = await objectExists(s3Client, bucketName, keys.wideKey);
    const squarePresent = await objectExists(s3Client, bucketName, keys.squareKey);
    samples.push({ id: flight.id, artifactPresent: widePresent && squarePresent });
  }
  return summarizeReleaseBackfillSpotCheck('flight-thumbnails', samples);
}

export function printReleaseBackfillSpotCheck(
  check: ReleaseBackfillSpotCheck,
  logger: Pick<Console, 'log'> = console,
): void {
  const detail = check.status === 'SKIP'
    ? 'no eligible records'
    : check.status === 'ERROR'
      ? check.error ?? 'unknown error'
      : `${check.present}/${check.sampled} sampled records have expected artifacts`;
  logger.log(`${check.status.padEnd(4)} ${check.name}: ${detail}`);
  if (check.missingIds.length > 0) logger.log(`     Missing sample IDs: ${check.missingIds.join(', ')}`);
}

async function runCheck(
  name: string,
  check: () => Promise<ReleaseBackfillSpotCheck>,
): Promise<ReleaseBackfillSpotCheck> {
  try {
    return await check();
  } catch (error) {
    return {
      name,
      status: 'ERROR',
      sampled: 0,
      present: 0,
      missingIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length > 0) {
    if (argv.length === 1 && argv[0] === '--help') {
      console.log(releaseBackfillVerificationUsage);
      return;
    }
    throw new Error(`Unknown argument: ${argv[0] ?? ''}\n\n${releaseBackfillVerificationUsage}`);
  }

  const config = parseConfig(process.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const s3Client = createBucketClient(config);
    const checks: ReleaseBackfillSpotCheck[] = [];
    checks.push(await runCheck('flight-progress', () => checkFlightProgress(db)));
    checks.push(await runCheck('flight-altitudes', () => checkFlightAltitudes(db)));
    checks.push(await runCheck('flight-thumbnails', () => checkFlightThumbnails(
      db,
      s3Client,
      config.bucket.bucketName,
      config.bucket.bucketFolder,
    )));
    checks.push(await runCheck('arena-achievements', () => checkArenaAchievements(db)));
    checks.push(await runCheck('arena-leadership', () => checkArenaLeadership(db)));
    checks.push(await runCheck('user-arena-progress', () => checkUserArenaProgress(db)));
    checks.push(await runCheck('user-achievement-progress', () => checkUserAchievementProgress(db)));
    for (const check of checks) printReleaseBackfillSpotCheck(check);
    const unsuccessful = checks.filter((check) => check.status === 'FAIL' || check.status === 'ERROR');
    console.log(`Release backfill spot checks: ${checks.length - unsuccessful.length}/${checks.length} passed or skipped.`);
    if (unsuccessful.length > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
