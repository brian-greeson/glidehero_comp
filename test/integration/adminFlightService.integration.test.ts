import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { flights, igcFiles, personalGridClaims, trackPoints, users } from '../../src/db/schema.js';
import { createAdminFlightService } from '../../src/services/adminFlightService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;
beforeAll(async () => { database = await resetAndPushTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function storedFlight(
  status: 'processing' | 'completed' | 'failed' = 'completed',
  existingUser?: typeof users.$inferSelect,
) {
  const [createdUser] = existingUser ? [] : await database.db.insert(users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const user = existingUser ?? createdUser!;
  const bucketKey = `glidehero/uploads/${user!.id}/${crypto.randomUUID()}.igc`;
  const [file] = await database.db.insert(igcFiles).values({
    userId: user!.id, originalFilename: 'flight.igc', contentType: 'text/plain', byteSize: 100, bucketKey,
  }).returning();
  const [flight] = await database.db.insert(flights).values({
    userId: user!.id, igcFileId: file!.id, contentHash: crypto.randomUUID(), processingStatus: status,
    startedAt: new Date('2026-07-14T12:00:00Z'),
  }).returning();
  return { user: user!, file: file!, flight: flight!, bucketKey };
}

function serviceHarness(send = vi.fn(async (_command: unknown) => ({}))) {
  const uploadQueue = { removeTerminalJobsForFlight: vi.fn(async () => undefined) };
  const reprocess = vi.fn(async () => ({ status: 'completed' as const, result: {
    flightId: 'flight', cellSize: 1000, directCellCount: 1, enclosedCellCount: 0,
  } }));
  const presign = vi.fn(async () => 'https://objects.example.test/download');
  return {
    service: createAdminFlightService(database.db, { reprocess }, {
      s3Client: { send } as never, bucketName: 'flights', uploadQueue, presign,
    }),
    send, uploadQueue, reprocess, presign,
  };
}

describe('adminFlightService management', () => {
  it('lists only the selected user flights and enforces ownership for reprocessing', async () => {
    const first = await storedFlight();
    await storedFlight();
    const { service, reprocess } = serviceHarness();
    await expect(service.listUserFlights(first.user.id)).resolves.toEqual([expect.objectContaining({
      id: first.flight.id, flightDate: '2026-07-14', originalFilename: 'flight.igc', processingStatus: 'completed',
    })]);
    await expect(service.reprocessFlight({ userId: crypto.randomUUID(), flightId: first.flight.id }))
      .resolves.toEqual({ status: 'not_found' });
    expect(reprocess).not.toHaveBeenCalled();
  });

  it('deletes a terminal object and cascades its database records, and repeat deletion succeeds', async () => {
    const stored = await storedFlight();
    await database.db.insert(trackPoints).values({
      flightId: stored.flight.id, sequenceNumber: 0, recordedAt: new Date(), latitude: 40,
      longitude: -105, gpsAltitudeMeters: 1000, pressureAltitudeMeters: 1000,
    });
    await database.db.insert(personalGridClaims).values({
      cellSize: 1000, x: 0, y: 0, claimFlight: stored.flight.id, claimUser: stored.user.id, claimTimestamp: new Date(),
    });
    const { service, send, uploadQueue } = serviceHarness();
    await expect(service.deleteFlight({ userId: stored.user.id, flightId: stored.flight.id })).resolves.toBe('deleted');
    expect((send.mock.calls[0]![0] as object).constructor.name).toBe('DeleteObjectCommand');
    expect(uploadQueue.removeTerminalJobsForFlight).toHaveBeenCalledWith(expect.objectContaining({
      userId: stored.user.id, flightId: stored.flight.id, bucketKey: stored.bucketKey,
    }));
    expect(await database.db.select().from(igcFiles)).toEqual([]);
    expect(await database.db.select().from(trackPoints)).toEqual([]);
    expect(await database.db.select().from(personalGridClaims)).toEqual([]);
    await expect(service.deleteFlight({ userId: stored.user.id, flightId: stored.flight.id })).resolves.toBe('already_deleted');
  });

  it('keeps processing flights read-only and creates short-lived downloads for terminal flights', async () => {
    const processing = await storedFlight('processing');
    const completed = await storedFlight('completed');
    const { service, send, presign } = serviceHarness();
    await expect(service.deleteFlight({ userId: processing.user.id, flightId: processing.flight.id })).resolves.toBe('processing');
    expect(send).not.toHaveBeenCalled();
    await expect(service.createDownloadUrl({ userId: processing.user.id, flightId: processing.flight.id })).resolves.toBeNull();
    await expect(service.createDownloadUrl({ userId: completed.user.id, flightId: completed.flight.id }))
      .resolves.toEqual({ url: 'https://objects.example.test/download', filename: 'flight.igc' });
    expect((send.mock.calls.at(-1)![0] as object).constructor.name).toBe('HeadObjectCommand');
    expect(presign).toHaveBeenCalledOnce();
  });

  it('deletes each terminal user flight independently, skips active work, and continues after a failure', async () => {
    const first = await storedFlight('completed');
    await storedFlight('failed', first.user);
    await storedFlight('completed', first.user);
    await storedFlight('processing', first.user);
    let deleteAttempt = 0;
    const send = vi.fn(async (command: unknown) => {
      if ((command as object).constructor.name !== 'DeleteObjectCommand') return {};
      deleteAttempt += 1;
      if (deleteAttempt === 2) throw new Error('object storage unavailable');
      return {};
    });
    const { service, uploadQueue } = serviceHarness(send);

    await expect(service.deleteAllUserFlights(first.user.id)).resolves.toEqual({ deleted: 2, skipped: 1, failed: 1 });
    expect(deleteAttempt).toBe(3);
    expect(uploadQueue.removeTerminalJobsForFlight).toHaveBeenCalledTimes(2);
    const remaining = await database.db.select({ status: flights.processingStatus }).from(flights)
      .where(eq(flights.userId, first.user.id));
    expect(remaining).toHaveLength(2);
    expect(remaining.filter(({ status }) => status === 'processing')).toHaveLength(1);
    expect(remaining.filter(({ status }) => status !== 'processing')).toHaveLength(1);
  });
});
