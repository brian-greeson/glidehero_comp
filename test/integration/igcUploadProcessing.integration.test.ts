import { readFileSync } from 'node:fs';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createFlightAreaDetectionService } from '../../src/services/flightAreaDetectionService.js';
import { createFlightProcessingService } from '../../src/services/flightProcessingService.js';
import { createIgcFileService } from '../../src/services/igcFileService.js';
import { resetAndPushTestDatabase } from './database.js';

const fixturePath = new URL('../inputs/2026-05-10-XNA-54F3F9B76F42505D1B592F21726CAF48-01.igc', import.meta.url);
const fixture = readFileSync(fixturePath);

class InMemoryObjectStore {
  private readonly objects = new Map<string, Buffer>();

  readonly send: S3['send'] = async (command) => {
    if (command instanceof PutObjectCommand) {
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
  it('stores every fix and detects enclosed areas from the supplied IGC file', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 60 });
    const pilot = await auth.signup({ email: 'pilot@example.com', password: 'correct horse battery staple' });
    const objectStore = new InMemoryObjectStore();
    const processor = createFlightProcessingService(database.db, {
      areaDetection: createFlightAreaDetectionService(database.db),
      s3Client: objectStore as never,
      bucketName: 'test-flights',
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
      area_count: number;
      point_count: number;
      first_fix: Date;
      last_fix: Date;
    }>(
      `SELECT f.processing_status,
              (SELECT count(*)::int FROM flight_areas fa WHERE fa.flight_id = f.flight_id) AS area_count,
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
        area_count: expect.any(Number),
        point_count: 10_835,
        first_fix: new Date('2026-05-10T18:50:26.000Z'),
      }),
    ]);
    expect(stored.rows[0]?.area_count).toBeGreaterThan(0);
    expect(stored.rows[0]?.last_fix.getTime()).toBeGreaterThan(stored.rows[0]?.first_fix.getTime() ?? 0);
  }, 60_000);
});
