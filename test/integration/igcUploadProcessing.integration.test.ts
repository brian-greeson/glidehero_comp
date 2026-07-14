import { readFileSync } from 'node:fs';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createCompetitionGridClaimService } from '../../src/services/competitionGridClaimService.js';
import { createFlightProcessingService } from '../../src/services/flightProcessingService.js';
import { createIgcFileService } from '../../src/services/igcFileService.js';
import { resetAndPushTestDatabase } from './database.js';

const fixturePath = new URL('../inputs/2026-05-10-XNA-54F3F9B76F42505D1B592F21726CAF48-01.igc', import.meta.url);
const fixture = readFileSync(fixturePath);

class InMemoryObjectStore {
  private readonly objects = new Map<string, Buffer>();
  private putOperations = 0;
  private firstTwoPutArrivals = 0;
  private firstTwoPutsReleased: Promise<void> | undefined;
  private releaseFirstTwoPuts: (() => void) | undefined;

  constructor(private readonly options: { blockFirstTwoPuts?: boolean } = {}) {}

  readonly send: S3['send'] = async (command) => {
    if (command instanceof PutObjectCommand) {
      await this.waitForFirstTwoPuts();
      const body = command.input.Body;
      if (!Buffer.isBuffer(body)) throw new Error('Expected the upload body to be a buffer.');
      this.objects.set(command.input.Key!, body);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const body = this.objects.get(command.input.Key!);
      if (!body) throw new Error(`Object ${command.input.Key} was not found.`);
      return { Body: { transformToString: async () => body.toString('utf8') } };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(command.input.Key!);
      return {};
    }
    throw new Error(`Unexpected S3 command: ${command.constructor.name}`);
  };

  objectCount(): number {
    return this.objects.size;
  }

  putCount(): number {
    return this.putOperations;
  }

  private async waitForFirstTwoPuts(): Promise<void> {
    this.putOperations += 1;
    if (!this.options.blockFirstTwoPuts || this.putOperations > 2) return;

    this.firstTwoPutsReleased ??= new Promise<void>((resolve) => {
      this.releaseFirstTwoPuts = resolve;
    });
    this.firstTwoPutArrivals += 1;
    if (this.firstTwoPutArrivals === 2) this.releaseFirstTwoPuts?.();
    await this.firstTwoPutsReleased;
  }
}

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>> | undefined;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database?.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  await database?.pool.end();
});

describe('IGC upload processing', () => {
  it('stores every fix and processes grid claims from the supplied IGC file', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'pilot@example.com', password: 'correct horse battery staple' });
    const objectStore = new InMemoryObjectStore();
    const processor = createFlightProcessingService(database.db, {
      s3Client: objectStore as never,
      bucketName: 'test-flights',
      gridClaimCellSize: 1000,
    });
    const uploads = createIgcFileService(
      database.db,
      { s3Client: objectStore as never, bucketName: 'test-flights', keyFactory: () => 'flights/known-good.igc' },
      processor,
    );

    const result = await uploads.upload({
      ownerUserId: pilot.user.userId,
      originalFilename: 'known-good.igc',
      contentType: 'application/vnd.fai.igc',
      bytes: fixture,
    });

    expect(result.status).toBe('completed');
    const stored = await database.pool.query<{
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
              f.launch_timezone,
              (SELECT count(*)::int FROM user_grid_claims ugc WHERE ugc.claim_flight = f.flight_id) AS grid_claim_count,
              (SELECT count(*)::int
               FROM competition_grid_claims cgc
               WHERE cgc.claim_flight = f.flight_id) AS competition_claim_count,
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

    expect(stored.rows).toEqual([
      expect.objectContaining({
        processing_status: 'completed',
        launch_timezone: 'America/Denver',
        grid_claim_count: expect.any(Number),
        competition_claim_count: expect.any(Number),
        competition_months: ['2026-05-01'],
        point_count: 10_835,
        first_fix: new Date('2026-05-10T18:50:26.000Z'),
      }),
    ]);
    expect(stored.rows[0]?.grid_claim_count).toBeGreaterThan(0);
    expect(stored.rows[0]?.competition_claim_count).toBeGreaterThan(0);
    expect(stored.rows[0]?.last_fix.getTime()).toBeGreaterThan(stored.rows[0]?.first_fix.getTime() ?? 0);
    const competition = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getCurrent({ competitionMonth: '2026-05-10' });
    expect(competition.features.length).toBeGreaterThan(0);
    expect(competition.features.every((feature) => feature.properties.ownerUserId === pilot.user.userId)).toBe(true);
  }, 60_000);

  it('rejects an identical upload from another pilot without retaining extra metadata or objects', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const firstPilot = await auth.signup({ email: 'first-pilot@example.com', password: 'correct horse battery staple' });
    const secondPilot = await auth.signup({ email: 'second-pilot@example.com', password: 'correct horse battery staple' });
    const objectStore = new InMemoryObjectStore({ blockFirstTwoPuts: true });
    const processor = createFlightProcessingService(database.db, {
      s3Client: objectStore as never,
      bucketName: 'test-flights',
      gridClaimCellSize: 1000,
    });
    let keyCount = 0;
    const uploads = createIgcFileService(
      database.db,
      { s3Client: objectStore as never, bucketName: 'test-flights', keyFactory: () => `flights/${++keyCount}.igc` },
      processor,
    );
    const [firstResult, secondResult] = await Promise.all([
      uploads.upload({
        ownerUserId: firstPilot.user.userId,
        originalFilename: 'first.igc',
        contentType: 'application/vnd.fai.igc',
        bytes: fixture,
      }),
      uploads.upload({
        ownerUserId: secondPilot.user.userId,
        originalFilename: 'second.igc',
        contentType: 'application/vnd.fai.igc',
        bytes: fixture,
      }),
    ]);

    expect([firstResult.status, secondResult.status].sort()).toEqual(['completed', 'duplicate']);
    expect(objectStore.putCount()).toBe(2);
    expect(keyCount).toBe(2);

    const counts = await database.pool.query<{ flight_count: number; igc_file_count: number }>(
      `SELECT (SELECT count(*)::int FROM flights) AS flight_count,
              (SELECT count(*)::int FROM igc_files) AS igc_file_count`,
    );
    expect(counts.rows).toEqual([{ flight_count: 1, igc_file_count: 1 }]);
    expect(objectStore.objectCount()).toBe(1);
  }, 60_000);
});
