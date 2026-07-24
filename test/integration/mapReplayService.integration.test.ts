import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createMapReplayService } from '../../src/services/mapReplayService.js';
import { flights, igcFiles, trackPoints } from '../../src/db/schema.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;
beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

describe('map replay service', () => {
  it('uses launch-local month, completed flights, pilot scope, and full intersecting tracks', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 3600 });
    const a = (await auth.signup({ email: 'a@example.com', password: 'password-long', displayName: 'A' })).user;
    const b = (await auth.signup({ email: 'b@example.com', password: 'password-long', displayName: 'B' })).user;
    async function add(userId: string, status: 'completed' | 'processing', startedAt: string, points: Array<[number, number, string]>) {
      const [igc] = await database.db.insert(igcFiles).values({ userId, originalFilename: `${userId}.igc`, contentType: 'text/plain', byteSize: 1, bucketKey: `${userId}-${crypto.randomUUID()}` }).returning({ id: igcFiles.id });
      const [flight] = await database.db.insert(flights).values({ userId, igcFileId: igc!.id, contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'), processingStatus: status, startedAt: new Date(startedAt), launchTimezone: 'America/Denver' }).returning({ id: flights.id });
      await database.db.insert(trackPoints).values(points.map(([longitude, latitude, recordedAt], i) => ({ flightId: flight!.id, sequenceNumber: i + 1, longitude, latitude, recordedAt: new Date(recordedAt), gpsAltitudeMeters: 1, pressureAltitudeMeters: 1 })));
      return flight!.id;
    }
    await add(a.userId, 'completed', '2026-08-01T07:00:00Z', [[-106, 39.5, '2026-08-01T07:00:00Z'], [-104, 39.5, '2026-08-01T07:00:10Z'], [-103, 39.5, '2026-08-01T07:00:20Z']]);
    await add(b.userId, 'completed', '2026-07-31T23:00:00Z', [[-105, 39.5, '2026-07-31T23:00:00Z'], [-104.5, 39.5, '2026-07-31T23:00:10Z']]);
    await add(a.userId, 'processing', '2026-07-15T12:00:00Z', [[-105, 39.5, '2026-07-15T12:00:00Z'], [-104, 39.5, '2026-07-15T12:00:10Z']]);
    await add(a.userId, 'completed', '2026-08-05T07:00:00Z', [[179, 39.5, '2026-08-05T07:00:00Z'], [-179, 39.5, '2026-08-05T07:00:10Z']]);
    await add(a.userId, 'completed', '2026-08-06T07:00:00Z', [[-179, 39.6, '2026-08-06T07:00:00Z'], [179, 39.6, '2026-08-06T07:00:10Z']]);
    const service = createMapReplayService(database.db);
    const input = { month: '2026-08', west: -105, south: 39, east: -104, north: 40 } as const;
    const personal = await service.getReplay({ ...input, mode: 'personal', userId: a.userId });
    expect(personal.flights).toHaveLength(1);
    expect(personal.flights[0]!.points).toEqual([[-106, 39.5, 0], [-104, 39.5, 10_000], [-103, 39.5, 20_000]]);
    const fractionalViewport = await service.getReplay({
      month: '2026-08',
      mode: 'personal',
      userId: a.userId,
      west: -107.27116699218737,
      south: 37.711731414937276,
      east: -104.12883300781243,
      north: 40.65739558460467,
    });
    expect(fractionalViewport.flights).toHaveLength(1);
    expect((await service.getReplay({ ...input, mode: 'competitive', userId: a.userId })).flights).toHaveLength(1);
    const dateline = await service.getReplay({ month: '2026-08', mode: 'personal', userId: a.userId, west: 179, south: 39, east: -179, north: 40 });
    expect(dateline.flights).toHaveLength(2);
    const central = await service.getReplay({ month: '2026-08', mode: 'personal', userId: a.userId, west: -1, south: 39, east: 1, north: 40 });
    expect(central.flights).toHaveLength(0);
  });
});
