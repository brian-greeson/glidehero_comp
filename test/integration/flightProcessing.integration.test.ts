import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { igcFiles } from '../../src/db/schema.js';
import type { NPointDistances } from '../../src/domain/igc/distance.js';
import { createAuthService } from '../../src/services/authService.js';
import { createFlightProcessingService } from '../../src/services/flightProcessingService.js';
import { createProfileService } from '../../src/services/profileService.js';
import { resetAndMigrateTestDatabase } from './database.js';

const fixturePath = new URL('../inputs/2026-05-10-XNA-54F3F9B76F42505D1B592F21726CAF48-01.igc', import.meta.url);
const fixture = readFileSync(fixturePath);
const source = fixture.toString('utf8');
const contentHash = createHash('sha256').update(fixture).digest('hex');

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database?.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  await database?.pool.end();
});

async function storeFile(userId: string, bucketKey: string, originalFilename: string) {
  if (!database) throw new Error('Test database was not initialized.');
  const [stored] = await database.db.insert(igcFiles).values({
    userId,
    originalFilename,
    contentType: 'application/vnd.fai.igc',
    byteSize: fixture.byteLength,
    bucketKey,
  }).returning({ id: igcFiles.id });
  if (!stored) throw new Error('IGC file insert returned no row.');
  return stored;
}

const injectedNPointDistances: NPointDistances = {
  threePointDistance: { distanceMeters: 300, pointIndices: [0, 2, 5] },
  fourPointDistance: { distanceMeters: 400, pointIndices: [0, 1, 3, 5] },
  fivePointDistance: { distanceMeters: 500, pointIndices: [0, 1, 2, 4, 5] },
  sixPointDistance: { distanceMeters: 1_234, pointIndices: [0, 1, 2, 3, 4, 5] },
};

function processor(options: { useRealNPointCalculator?: boolean; nPointSolverEnabled?: boolean } = {}) {
  if (!database) throw new Error('Test database was not initialized.');
  return createFlightProcessingService(database.db, {
    s3Client: { send: async () => { throw new Error('Worker-provided source should avoid object reads.'); } } as never,
    bucketName: 'test-flights',
    gridClaimCellSize: 1_000,
    ...(options.useRealNPointCalculator
      ? {}
      : { calculateNPointDistances: async () => injectedNPointDistances }),
    isNPointSolverEnabled: async () => options.nPointSolverEnabled ?? true,
  });
}

async function installInsertFailureTrigger(table: 'activities' | 'competition_grid_claims' | 'flight_progress' | 'flight_scores', message: string) {
  if (!database) throw new Error('Test database was not initialized.');
  const suffix = randomUUID().replaceAll('-', '');
  const functionName = `test_${suffix}_fn`;
  const triggerName = `test_${suffix}_trigger`;
  await database.pool.query(`
    CREATE FUNCTION "${functionName}"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '${message.replaceAll("'", "''")}';
    END;
    $$;
    CREATE TRIGGER "${triggerName}"
    BEFORE INSERT ON ${table}
    FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
  `);
  return async () => {
    await database?.pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON ${table}`);
    await database?.pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
  };
}

async function persistedProcessingState(igcFileId: string) {
  if (!database) throw new Error('Test database was not initialized.');
  const result = await database.pool.query<{
    processing_status: string;
    processed_at: Date | null;
    track_point_count: number;
    personal_claim_count: number;
    competition_claim_count: number;
    progress_count: number;
    achievement_count: number;
    activity_count: number;
    score_count: number;
  }>(
    `SELECT f.processing_status,
            f.processed_at,
            (SELECT count(*)::int FROM track_points WHERE flight_id = f.flight_id) AS track_point_count,
            (SELECT count(*)::int FROM user_grid_claims WHERE claim_flight = f.flight_id) AS personal_claim_count,
            (SELECT count(*)::int FROM competition_grid_claims WHERE claim_flight = f.flight_id) AS competition_claim_count,
            (SELECT count(*)::int FROM flight_progress WHERE flight_id = f.flight_id) AS progress_count,
            (SELECT count(*)::int FROM achievements WHERE source_flight_id = f.flight_id) AS achievement_count,
            (SELECT count(*)::int FROM activities WHERE source_flight_id = f.flight_id) AS activity_count,
            (SELECT count(*)::int FROM flight_scores WHERE flight_id = f.flight_id) AS score_count
     FROM flights f
     WHERE f.igc_file_id = $1`,
    [igcFileId],
  );
  return result.rows;
}

describe('FlightProcessingService with a real IGC file', () => {
  it('stores every fix and processes personal and competition claims', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'pilot@example.com', password: 'correct horse battery staple' });
    await createProfileService(database.db, { cellSize: 1_000 }).saveGliderDetails?.({
      userId: pilot.user.userId,
      manufacturer: 'Ozone',
      model: 'Ultralite 5',
      size: '17',
      year: 2025,
      competitionId: null,
      hours: 0,
      resetHours: false,
    });
    const stored = await storeFile(pilot.user.userId, 'flights/known-good.igc', 'known-good.igc');

    const result = await processor({ useRealNPointCalculator: true }).process({
      ownerUserId: pilot.user.userId,
      igcFileId: stored.id,
      bucketKey: 'flights/known-good.igc',
      contentHash,
      processingToken: randomUUID(),
      source,
    });

    expect(result.status).toBe('completed');
    const persisted = await database.pool.query<{
      processing_status: string;
      processed_at: Date;
      launch_timezone: string;
      grid_claim_count: number;
      competition_claim_count: number;
      competition_months: string[];
      point_count: number;
      first_fix: Date;
      last_fix: Date;
      cumulative_distance_meters: number;
      duration_seconds: number;
      glider_hours_credited_seconds: number;
      glider_hours_seconds: number;
      total_distance_meters: number;
      total_distance_calc_version: number;
      total_distance_metadata: Record<string, never>;
      three_point_distance_meters: number;
      three_point_distance_calc_version: number;
      three_point_distance_metadata: {
        calculationVersion: number;
        distanceMeters: number;
        pointIndices: number[];
        points: Array<{
          sequenceNumber: number;
          recordedAt: string;
          latitude: number;
          longitude: number;
          gpsAltitudeMeters: number;
        }>;
      };
      four_point_distance_meters: number;
      four_point_distance_calc_version: number;
      four_point_distance_metadata: {
        calculationVersion: number;
        distanceMeters: number;
        pointIndices: number[];
        points: Array<{
          sequenceNumber: number;
          recordedAt: string;
          latitude: number;
          longitude: number;
          gpsAltitudeMeters: number;
        }>;
      };
      five_point_distance_meters: number;
      five_point_distance_calc_version: number;
      five_point_distance_metadata: {
        calculationVersion: number;
        distanceMeters: number;
        pointIndices: number[];
        points: Array<{
          sequenceNumber: number;
          recordedAt: string;
          latitude: number;
          longitude: number;
          gpsAltitudeMeters: number;
        }>;
      };
      six_point_distance_meters: number;
      six_point_distance_calc_version: number;
      six_point_distance_metadata: {
        calculationVersion: number;
        distanceMeters: number;
        pointIndices: number[];
        points: Array<{
          sequenceNumber: number;
          recordedAt: string;
          latitude: number;
          longitude: number;
          gpsAltitudeMeters: number;
        }>;
      };
    }>(
      `SELECT f.processing_status,
              f.processed_at,
              f.launch_timezone,
              f.distance_meters AS cumulative_distance_meters,
              f.duration_seconds,
              f.glider_hours_credited_seconds,
              (SELECT glider_hours_seconds FROM profiles WHERE user_id = f.user_id) AS glider_hours_seconds,
              fs.total_distance_meters,
              fs.total_distance_calc_version,
              fs.total_distance_metadata,
              fs.three_point_distance_meters,
              fs.three_point_distance_calc_version,
              fs.three_point_distance_metadata,
              fs.four_point_distance_meters,
              fs.four_point_distance_calc_version,
              fs.four_point_distance_metadata,
              fs.five_point_distance_meters,
              fs.five_point_distance_calc_version,
              fs.five_point_distance_metadata,
              fs.six_point_distance_meters,
              fs.six_point_distance_calc_version,
              fs.six_point_distance_metadata,
              (SELECT count(*)::int FROM user_grid_claims ugc WHERE ugc.claim_flight = f.flight_id) AS grid_claim_count,
              (SELECT count(*)::int FROM competition_grid_claims cgc WHERE cgc.claim_flight = f.flight_id) AS competition_claim_count,
              ARRAY(
                SELECT DISTINCT cgc.competition_month::text
                FROM competition_grid_claims cgc
                WHERE cgc.claim_flight = f.flight_id
                ORDER BY cgc.competition_month::text
              ) AS competition_months,
              count(tp.track_point_id)::int AS point_count,
              min(tp.recorded_at) AS first_fix,
              max(tp.recorded_at) AS last_fix
       FROM flights f
       LEFT JOIN flight_scores fs ON fs.flight_id = f.flight_id
       LEFT JOIN track_points tp ON tp.flight_id = f.flight_id
       GROUP BY f.flight_id, fs.flight_id`,
    );

    expect(persisted.rows).toEqual([
      expect.objectContaining({
        processing_status: 'completed',
        processed_at: expect.any(Date),
        launch_timezone: 'America/Denver',
        grid_claim_count: expect.any(Number),
        competition_claim_count: expect.any(Number),
        competition_months: ['2026-05-01'],
        point_count: 10_835,
        first_fix: new Date('2026-05-10T18:50:26.000Z'),
        total_distance_calc_version: 1,
        total_distance_metadata: {},
        three_point_distance_calc_version: 1,
        four_point_distance_calc_version: 1,
        five_point_distance_calc_version: 1,
        six_point_distance_calc_version: 1,
      }),
    ]);
    expect(persisted.rows[0]?.glider_hours_credited_seconds).toBe(persisted.rows[0]?.duration_seconds);
    expect(persisted.rows[0]?.glider_hours_seconds).toBe(persisted.rows[0]?.duration_seconds);
    expect(persisted.rows[0]?.total_distance_meters).toBe(persisted.rows[0]?.cumulative_distance_meters);
    expect(persisted.rows[0]?.three_point_distance_meters).toBeCloseTo(24_089.859916730784, 8);
    expect(persisted.rows[0]?.three_point_distance_metadata).toEqual({
      calculationVersion: 1,
      distanceMeters: 24_089.859916730784,
      pointIndices: [2691, 7161, 9224],
      points: [
        {
          sequenceNumber: 2691,
          recordedAt: '2026-05-10T19:35:18.000Z',
          latitude: 40.01558333333333,
          longitude: -105.29353333333333,
          gpsAltitudeMeters: 3010,
        },
        {
          sequenceNumber: 7161,
          recordedAt: '2026-05-10T20:50:01.000Z',
          latitude: 40.098483333333334,
          longitude: -105.18663333333333,
          gpsAltitudeMeters: 2488,
        },
        {
          sequenceNumber: 9224,
          recordedAt: '2026-05-10T21:24:24.000Z',
          latitude: 40.061733333333336,
          longitude: -105.30841666666667,
          gpsAltitudeMeters: 2835,
        },
      ],
    });
    expect(persisted.rows[0]?.four_point_distance_meters).toBeCloseTo(28_726.374353149327, 8);
    expect(persisted.rows[0]?.four_point_distance_metadata).toEqual({
      calculationVersion: 1,
      distanceMeters: 28_726.374353149327,
      pointIndices: [1490, 2692, 7161, 9224],
      points: [
        {
          sequenceNumber: 1490,
          recordedAt: '2026-05-10T19:15:17.000Z',
          latitude: 40.05703333333334,
          longitude: -105.29931666666667,
          gpsAltitudeMeters: 2358,
        },
        {
          sequenceNumber: 2692,
          recordedAt: '2026-05-10T19:35:19.000Z',
          latitude: 40.01555,
          longitude: -105.29343333333334,
          gpsAltitudeMeters: 3007,
        },
        {
          sequenceNumber: 7161,
          recordedAt: '2026-05-10T20:50:01.000Z',
          latitude: 40.098483333333334,
          longitude: -105.18663333333333,
          gpsAltitudeMeters: 2488,
        },
        {
          sequenceNumber: 9224,
          recordedAt: '2026-05-10T21:24:24.000Z',
          latitude: 40.061733333333336,
          longitude: -105.30841666666667,
          gpsAltitudeMeters: 2835,
        },
      ],
    });
    expect(persisted.rows[0]?.five_point_distance_meters).toBeCloseTo(33_416.10832975811, 8);
    expect(persisted.rows[0]?.five_point_distance_metadata).toEqual({
      calculationVersion: 1,
      distanceMeters: 33_416.10832975811,
      pointIndices: [2691, 7161, 9223, 9634, 10708],
      points: [
        {
          sequenceNumber: 2691,
          recordedAt: '2026-05-10T19:35:18.000Z',
          latitude: 40.01558333333333,
          longitude: -105.29353333333333,
          gpsAltitudeMeters: 3010,
        },
        {
          sequenceNumber: 7161,
          recordedAt: '2026-05-10T20:50:01.000Z',
          latitude: 40.098483333333334,
          longitude: -105.18663333333333,
          gpsAltitudeMeters: 2488,
        },
        {
          sequenceNumber: 9223,
          recordedAt: '2026-05-10T21:24:23.000Z',
          latitude: 40.06163333333333,
          longitude: -105.3083,
          gpsAltitudeMeters: 2833,
        },
        {
          sequenceNumber: 9634,
          recordedAt: '2026-05-10T21:31:14.000Z',
          latitude: 40.0991,
          longitude: -105.29686666666667,
          gpsAltitudeMeters: 2375,
        },
        {
          sequenceNumber: 10708,
          recordedAt: '2026-05-10T21:49:08.000Z',
          latitude: 40.05375,
          longitude: -105.29303333333333,
          gpsAltitudeMeters: 1808,
        },
      ],
    });
    expect(persisted.rows[0]?.six_point_distance_meters).toBeCloseTo(38_052.62276617665, 8);
    expect(persisted.rows[0]?.six_point_distance_metadata).toEqual({
      calculationVersion: 1,
      distanceMeters: 38_052.62276617665,
      pointIndices: [1490, 2692, 7161, 9223, 9634, 10708],
      points: [
        {
          sequenceNumber: 1490,
          recordedAt: '2026-05-10T19:15:17.000Z',
          latitude: 40.05703333333334,
          longitude: -105.29931666666667,
          gpsAltitudeMeters: 2358,
        },
        {
          sequenceNumber: 2692,
          recordedAt: '2026-05-10T19:35:19.000Z',
          latitude: 40.01555,
          longitude: -105.29343333333334,
          gpsAltitudeMeters: 3007,
        },
        {
          sequenceNumber: 7161,
          recordedAt: '2026-05-10T20:50:01.000Z',
          latitude: 40.098483333333334,
          longitude: -105.18663333333333,
          gpsAltitudeMeters: 2488,
        },
        {
          sequenceNumber: 9223,
          recordedAt: '2026-05-10T21:24:23.000Z',
          latitude: 40.06163333333333,
          longitude: -105.3083,
          gpsAltitudeMeters: 2833,
        },
        {
          sequenceNumber: 9634,
          recordedAt: '2026-05-10T21:31:14.000Z',
          latitude: 40.0991,
          longitude: -105.29686666666667,
          gpsAltitudeMeters: 2375,
        },
        {
          sequenceNumber: 10708,
          recordedAt: '2026-05-10T21:49:08.000Z',
          latitude: 40.05375,
          longitude: -105.29303333333333,
          gpsAltitudeMeters: 1808,
        },
      ],
    });
    expect(persisted.rows[0]?.grid_claim_count).toBeGreaterThan(0);
    expect(persisted.rows[0]?.competition_claim_count).toBeGreaterThan(0);
    expect(persisted.rows[0]?.last_fix.getTime()).toBeGreaterThan(persisted.rows[0]?.first_fix.getTime() ?? 0);

    const activity = await database.pool.query<{ actor_user_id: string; source_flight_id: string; published_at: Date }>(
      'SELECT actor_user_id, source_flight_id, published_at FROM activities',
    );
    expect(activity.rows).toEqual([{
      actor_user_id: pilot.user.userId,
      source_flight_id: expect.any(String),
      published_at: expect.any(Date),
    }]);
    expect(activity.rows[0]?.published_at.getTime()).toBe(persisted.rows[0]?.processed_at.getTime());

  }, 180_000);

  it('completes with empty N-point scores when the solver was disabled at processing start', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'solver-disabled@example.com', password: 'correct horse battery staple' });
    const stored = await storeFile(pilot.user.userId, 'flights/solver-disabled.igc', 'solver-disabled.igc');

    const result = await processor({ nPointSolverEnabled: false }).process({
      ownerUserId: pilot.user.userId,
      igcFileId: stored.id,
      bucketKey: 'flights/solver-disabled.igc',
      contentHash: createHash('sha256').update(fixture).digest('hex').replace(/^./, 'e'),
      processingToken: randomUUID(),
      source,
    });

    expect(result.status).toBe('completed');
    const score = await database.pool.query<{
      total_distance_meters: number;
      three_point_distance_meters: number | null;
      three_point_distance_calc_version: number | null;
      three_point_distance_metadata: unknown | null;
      four_point_distance_meters: number | null;
      four_point_distance_calc_version: number | null;
      four_point_distance_metadata: unknown | null;
      five_point_distance_meters: number | null;
      five_point_distance_calc_version: number | null;
      five_point_distance_metadata: unknown | null;
      six_point_distance_meters: number | null;
      six_point_distance_calc_version: number | null;
      six_point_distance_metadata: unknown | null;
    }>(
      `SELECT total_distance_meters,
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
       FROM flight_scores`,
    );
    expect(score.rows).toEqual([expect.objectContaining({
      total_distance_meters: expect.any(Number),
      three_point_distance_meters: null,
      three_point_distance_calc_version: null,
      three_point_distance_metadata: null,
      four_point_distance_meters: null,
      four_point_distance_calc_version: null,
      four_point_distance_metadata: null,
      five_point_distance_meters: null,
      five_point_distance_calc_version: null,
      five_point_distance_metadata: null,
      six_point_distance_meters: null,
      six_point_distance_calc_version: null,
      six_point_distance_metadata: null,
    })]);
  }, 60_000);

  it('allows only one concurrent processor to persist identical flight content', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const firstPilot = await auth.signup({ email: 'first-pilot@example.com', password: 'correct horse battery staple' });
    const secondPilot = await auth.signup({ email: 'second-pilot@example.com', password: 'correct horse battery staple' });
    const firstFile = await storeFile(firstPilot.user.userId, 'flights/first.igc', 'first.igc');
    const secondFile = await storeFile(secondPilot.user.userId, 'flights/second.igc', 'second.igc');
    const service = processor();

    const [firstResult, secondResult] = await Promise.all([
      service.process({
        ownerUserId: firstPilot.user.userId,
        igcFileId: firstFile.id,
        bucketKey: 'flights/first.igc',
        contentHash,
        processingToken: randomUUID(),
        source,
      }),
      service.process({
        ownerUserId: secondPilot.user.userId,
        igcFileId: secondFile.id,
        bucketKey: 'flights/second.igc',
        contentHash,
        processingToken: randomUUID(),
        source,
      }),
    ]);

    expect([firstResult.status, secondResult.status].sort()).toEqual(['completed', 'duplicate']);
    const counts = await database.pool.query<{ flight_count: number }>(
      'SELECT count(*)::int AS flight_count FROM flights',
    );
    expect(counts.rows).toEqual([{ flight_count: 1 }]);
  }, 60_000);

  it('does not complete a flight when its score row cannot be persisted', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'score-failure@example.com', password: 'correct horse battery staple' });
    const stored = await storeFile(pilot.user.userId, 'flights/score-failure.igc', 'score-failure.igc');
    const removeTrigger = await installInsertFailureTrigger('flight_scores', 'test score persistence failure');

    try {
      await expect(processor().process({
        ownerUserId: pilot.user.userId,
        igcFileId: stored.id,
        bucketKey: 'flights/score-failure.igc',
        contentHash: createHash('sha256').update(fixture).digest('hex').replace(/^./, 'a'),
        processingToken: randomUUID(),
        source,
      })).rejects.toThrow();

      expect(await persistedProcessingState(stored.id)).toEqual([
        expect.objectContaining({
          processing_status: 'processing',
          processed_at: null,
          track_point_count: 0,
          personal_claim_count: 0,
          competition_claim_count: 0,
          progress_count: 0,
          achievement_count: 0,
          activity_count: 0,
          score_count: 0,
        }),
      ]);
    } finally {
      await removeTrigger();
    }
  }, 60_000);

  it('does not complete a flight or retain partial work when progression persistence fails', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'progression-failure@example.com', password: 'correct horse battery staple' });
    const stored = await storeFile(pilot.user.userId, 'flights/progression-failure.igc', 'progression-failure.igc');
    const removeTrigger = await installInsertFailureTrigger('flight_progress', 'test progression persistence failure');

    try {
      await expect(processor().process({
        ownerUserId: pilot.user.userId,
        igcFileId: stored.id,
        bucketKey: 'flights/progression-failure.igc',
        contentHash: createHash('sha256').update(fixture).digest('hex').replace(/^./, 'b'),
        processingToken: randomUUID(),
        source,
      })).rejects.toThrow();

      const persisted = await persistedProcessingState(stored.id);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.processing_status).not.toBe('completed');
      expect(persisted[0]).toMatchObject({
        processed_at: null,
        track_point_count: 0,
        personal_claim_count: 0,
        competition_claim_count: 0,
        progress_count: 0,
        achievement_count: 0,
        activity_count: 0,
        score_count: 0,
      });
    } finally {
      await removeTrigger();
    }
  }, 60_000);

  it('does not complete a flight or retain partial work when competition persistence fails', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'competition-failure@example.com', password: 'correct horse battery staple' });
    const stored = await storeFile(pilot.user.userId, 'flights/competition-failure.igc', 'competition-failure.igc');
    const removeTrigger = await installInsertFailureTrigger('competition_grid_claims', 'test competition persistence failure');

    try {
      await expect(processor().process({
        ownerUserId: pilot.user.userId,
        igcFileId: stored.id,
        bucketKey: 'flights/competition-failure.igc',
        contentHash: createHash('sha256').update(fixture).digest('hex').replace(/^./, 'c'),
        processingToken: randomUUID(),
        source,
      })).rejects.toThrow();

      const persisted = await persistedProcessingState(stored.id);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.processing_status).not.toBe('completed');
      expect(persisted[0]).toMatchObject({
        processed_at: null,
        track_point_count: 0,
        personal_claim_count: 0,
        competition_claim_count: 0,
        progress_count: 0,
        achievement_count: 0,
        activity_count: 0,
        score_count: 0,
      });
    } finally {
      await removeTrigger();
    }
  }, 60_000);

  it('does not complete a flight or retain partial work when activity publication fails', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'activity-failure@example.com', password: 'correct horse battery staple' });
    const stored = await storeFile(pilot.user.userId, 'flights/activity-failure.igc', 'activity-failure.igc');
    const removeTrigger = await installInsertFailureTrigger('activities', 'test activity persistence failure');

    try {
      await expect(processor().process({
        ownerUserId: pilot.user.userId,
        igcFileId: stored.id,
        bucketKey: 'flights/activity-failure.igc',
        contentHash: createHash('sha256').update(fixture).digest('hex').replace(/^./, 'd'),
        processingToken: randomUUID(),
        source,
      })).rejects.toThrow();

      const persisted = await persistedProcessingState(stored.id);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        processing_status: 'processing',
        processed_at: null,
        track_point_count: 0,
        personal_claim_count: 0,
        competition_claim_count: 0,
        progress_count: 0,
        achievement_count: 0,
        activity_count: 0,
        score_count: 0,
      });
    } finally {
      await removeTrigger();
    }
  }, 60_000);
});
