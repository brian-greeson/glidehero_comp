import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { igcFiles } from '../../src/db/schema.js';
import { createAuthService } from '../../src/services/authService.js';
import { createFlightProcessingService } from '../../src/services/flightProcessingService.js';
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

function processor() {
  if (!database) throw new Error('Test database was not initialized.');
  return createFlightProcessingService(database.db, {
    s3Client: { send: async () => { throw new Error('Worker-provided source should avoid object reads.'); } } as never,
    bucketName: 'test-flights',
    gridClaimCellSize: 1_000,
  });
}

async function installInsertFailureTrigger(table: 'competition_grid_claims' | 'flight_progress', message: string) {
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
  }>(
    `SELECT f.processing_status,
            f.processed_at,
            (SELECT count(*)::int FROM track_points WHERE flight_id = f.flight_id) AS track_point_count,
            (SELECT count(*)::int FROM user_grid_claims WHERE claim_flight = f.flight_id) AS personal_claim_count,
            (SELECT count(*)::int FROM competition_grid_claims WHERE claim_flight = f.flight_id) AS competition_claim_count,
            (SELECT count(*)::int FROM flight_progress WHERE flight_id = f.flight_id) AS progress_count,
            (SELECT count(*)::int FROM achievements WHERE source_flight_id = f.flight_id) AS achievement_count
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
    const stored = await storeFile(pilot.user.userId, 'flights/known-good.igc', 'known-good.igc');

    const result = await processor().process({
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
      launch_timezone: string;
      grid_claim_count: number;
      competition_claim_count: number;
      competition_months: string[];
      point_count: number;
      first_fix: Date;
      last_fix: Date;
    }>(
      `SELECT f.processing_status,
              f.processed_at,
              f.launch_timezone,
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
       LEFT JOIN track_points tp ON tp.flight_id = f.flight_id
       GROUP BY f.flight_id`,
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
      }),
    ]);
    expect(persisted.rows[0]?.grid_claim_count).toBeGreaterThan(0);
    expect(persisted.rows[0]?.competition_claim_count).toBeGreaterThan(0);
    expect(persisted.rows[0]?.last_fix.getTime()).toBeGreaterThan(persisted.rows[0]?.first_fix.getTime() ?? 0);

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
      });
    } finally {
      await removeTrigger();
    }
  }, 60_000);
});
