import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { achievements, arenaCurrentLeaders, arenaLeadershipEvents, competitionGridClaims, flights, igcFiles, personalGridClaims, trackPoints, users } from '../../src/db/schema.js';
import { createAdminFlightService } from '../../src/services/adminFlightService.js';
import { createArenaLeadershipReconciliationService } from '../../src/services/arenaLeadershipReconciliationService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;
beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
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

async function storedArena(input: { sourceId: number; arenaType: 'launch' | 'general' }) {
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO arenas (source_id, name, country, country_code, area, arena_type)
     VALUES ($1, $2, 'United States', 'US', ST_Multi(ST_GeomFromText('POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 6933)), $3)
     RETURNING id`,
    [input.sourceId, `Admin test ${input.sourceId}`, input.arenaType],
  );
  return result.rows[0]!.id;
}

function serviceHarness(send = vi.fn(async (_command: unknown) => ({}))) {
  const uploadQueue = { removeTerminalJobsForFlight: vi.fn(async () => undefined) };
  const reprocess = vi.fn(async () => ({ status: 'completed' as const, result: {
    flightId: 'flight', cellSize: 1000, directCellCount: 1, enclosedCellCount: 0,
    newPersonalCellCount: 1, personalCellTotalAfter: 1, progressionVersion: 1,
    evaluatedAt: new Date('2026-07-20T00:00:00Z'),
    arenaAchievements: { newlyEarned: [], alreadyEarned: 0, record: null },
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

  it('sorts selected-user flights by flight date or upload date in either direction', async () => {
    const first = await storedFlight();
    const second = await storedFlight('completed', first.user);
    const third = await storedFlight('completed', first.user);
    await database.db.update(flights).set({
      startedAt: new Date('2026-07-16T12:00:00Z'),
      createdAt: new Date('2026-07-14T09:00:00Z'),
    }).where(eq(flights.id, first.flight.id));
    await database.db.update(flights).set({
      startedAt: new Date('2026-07-14T12:00:00Z'),
      createdAt: new Date('2026-07-16T09:00:00Z'),
    }).where(eq(flights.id, second.flight.id));
    await database.db.update(flights).set({
      startedAt: null,
      createdAt: new Date('2026-07-15T09:00:00Z'),
    }).where(eq(flights.id, third.flight.id));
    const { service } = serviceHarness();
    const ids = async (sort: Parameters<typeof service.listUserFlights>[1]) => (
      await service.listUserFlights(first.user.id, sort)
    ).map(({ id }) => id);

    await expect(ids({ field: 'flightDate', direction: 'asc' }))
      .resolves.toEqual([second.flight.id, first.flight.id, third.flight.id]);
    await expect(ids({ field: 'flightDate', direction: 'desc' }))
      .resolves.toEqual([first.flight.id, second.flight.id, third.flight.id]);
    await expect(ids({ field: 'uploadDate', direction: 'asc' }))
      .resolves.toEqual([first.flight.id, third.flight.id, second.flight.id]);
    await expect(ids({ field: 'uploadDate', direction: 'desc' }))
      .resolves.toEqual([second.flight.id, third.flight.id, first.flight.id]);
  });

  it('deletes a terminal object and cascades its database records, and repeat deletion succeeds', async () => {
    const stored = await storedFlight();
    await database.db.insert(trackPoints).values({
      flightId: stored.flight.id, sequenceNumber: 0, recordedAt: new Date(), latitude: 40,
      longitude: -105, gpsAltitudeMeters: 1000, pressureAltitudeMeters: 1000,
    });
    await database.db.insert(personalGridClaims).values({
      x: 0, y: 0, claimFlight: stored.flight.id, claimUser: stored.user.id, claimTimestamp: new Date(),
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
    expect(uploadQueue.removeTerminalJobsForFlight).toHaveBeenCalledTimes(3);
    const remaining = await database.db.select({ status: flights.processingStatus }).from(flights)
      .where(eq(flights.userId, first.user.id));
    expect(remaining).toHaveLength(2);
    expect(remaining.filter(({ status }) => status === 'processing')).toHaveLength(1);
    expect(remaining.filter(({ status }) => status !== 'processing')).toHaveLength(1);
  });

  it('reconciles all eligible Arenas intersecting deleted competition cells and excludes Launch Arenas', async () => {
    const stored = await storedFlight();
    const general = await storedArena({ sourceId: 20_001, arenaType: 'general' });
    await storedArena({ sourceId: 20_002, arenaType: 'launch' });
    await database.db.insert(competitionGridClaims).values({
      competitionMonth: '2026-07-01', x: 0, y: 0,
      claimFlight: stored.flight.id, claimUser: stored.user.id, claimTimestamp: new Date('2026-07-14T12:00:00Z'),
    });
    const leadership = { reconcile: vi.fn(), reconcileInTransaction: vi.fn(async () => ({
      arenas: [], eventsBuilt: 0, achievements: { newlyEarned: [], alreadyEarned: 0 },
    })) };
    const { send, uploadQueue } = serviceHarness();
    const service = createAdminFlightService(database.db, { reprocess: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', uploadQueue,
    }, { arenaLeadership: leadership, cellSize: 1_000 });

    await expect(service.deleteFlight({ userId: stored.user.id, flightId: stored.flight.id })).resolves.toBe('deleted');
    expect(leadership.reconcileInTransaction).toHaveBeenCalledWith(expect.anything(), { arenaIds: [general] });
    expect(await database.db.select().from(competitionGridClaims)).toEqual([]);
  });

  it('rolls back flight deletion when Arena reconciliation fails', async () => {
    const stored = await storedFlight();
    await storedArena({ sourceId: 20_003, arenaType: 'general' });
    await database.db.insert(competitionGridClaims).values({
      competitionMonth: '2026-07-01', x: 0, y: 0,
      claimFlight: stored.flight.id, claimUser: stored.user.id, claimTimestamp: new Date('2026-07-14T12:00:00Z'),
    });
    const failure = new Error('forced deletion reconciliation failure');
    const leadership = { reconcile: vi.fn(), reconcileInTransaction: vi.fn(async () => { throw failure; }) };
    const { send, uploadQueue } = serviceHarness();
    const service = createAdminFlightService(database.db, { reprocess: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', uploadQueue,
    }, { arenaLeadership: leadership, cellSize: 1_000 });

    await expect(service.deleteFlight({ userId: stored.user.id, flightId: stored.flight.id })).rejects.toBe(failure);
    expect(await database.db.select({ id: flights.id }).from(flights).where(eq(flights.id, stored.flight.id))).toEqual([{ id: stored.flight.id }]);
    expect(await database.db.select().from(competitionGridClaims)).toHaveLength(1);
    expect(uploadQueue.removeTerminalJobsForFlight).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('canonically rebuilds leadership on deletion and preserves the earned award with a null source flight', async () => {
    const leader = await storedFlight();
    const remaining = await storedFlight();
    const general = await storedArena({ sourceId: 20_004, arenaType: 'general' });
    await storedArena({ sourceId: 20_005, arenaType: 'launch' });
    await database.db.insert(competitionGridClaims).values([
      {
        competitionMonth: '2026-07-01', x: 0, y: 0,
        claimFlight: leader.flight.id, claimUser: leader.user.id, claimTimestamp: new Date('2026-07-14T12:00:00Z'),
      },
      {
        competitionMonth: '2026-07-01', x: 0, y: 0,
        claimFlight: remaining.flight.id, claimUser: remaining.user.id, claimTimestamp: new Date('2026-07-15T12:00:00Z'),
      },
    ]);
    const leadership = createArenaLeadershipReconciliationService(database.db, { cellSize: 1_000 });
    await leadership.reconcile({ arenaIds: [general] });
    const [earnedBefore] = await database.db.select({ sourceFlightId: achievements.sourceFlightId })
      .from(achievements)
      .where(eq(achievements.userId, leader.user.id));
    expect(earnedBefore?.sourceFlightId).toBe(leader.flight.id);

    const { send, uploadQueue } = serviceHarness();
    const service = createAdminFlightService(database.db, { reprocess: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', uploadQueue,
    }, { arenaLeadership: leadership, cellSize: 1_000 });
    await expect(service.deleteFlight({ userId: leader.user.id, flightId: leader.flight.id })).resolves.toBe('deleted');

    const current = await database.db.select({ userId: arenaCurrentLeaders.userId })
      .from(arenaCurrentLeaders)
      .where(eq(arenaCurrentLeaders.arenaId, general));
    expect(current).toEqual([{ userId: remaining.user.id }]);
    expect(await database.db.select().from(arenaLeadershipEvents).where(eq(arenaLeadershipEvents.arenaId, general)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ userId: remaining.user.id, eventType: 'took' })]));
    const [earnedAfter] = await database.db.select({ sourceFlightId: achievements.sourceFlightId })
      .from(achievements)
      .where(eq(achievements.userId, leader.user.id));
    expect(earnedAfter?.sourceFlightId).toBeNull();
  });
});
