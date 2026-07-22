import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSessions, flights, igcFiles, profiles, userPasswords, users } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { createAdminUserService } from '../../src/services/adminUserService.js';
import { verifyPassword } from '../../src/services/passwordService.js';
import { resetAndMigrateTestDatabase } from './database.js';
import { createArenaLeadershipReconciliationService } from '../../src/services/arenaLeadershipReconciliationService.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

function harness(options: { activeJobs?: number; listedKeys?: string[] } = {}) {
  const deletedKeys: string[] = [];
  const send = vi.fn(async (command: object) => {
    if (command.constructor.name === 'ListObjectsV2Command') {
      return { Contents: (options.listedKeys ?? []).map((Key) => ({ Key })), IsTruncated: false };
    }
    if (command.constructor.name === 'DeleteObjectCommand') {
      const key = (command as { input: { Key: string } }).input.Key;
      deletedKeys.push(key);
      return {};
    }
    throw new Error(`Unexpected command ${command.constructor.name}`);
  });
  const uploadQueue = {
    activeJobCountForUser: vi.fn(async () => options.activeJobs ?? 0),
    removeTerminalJobsForUser: vi.fn(async () => undefined),
  };
  return {
    service: createAdminUserService(database.db, {
      uploadQueue,
      s3Client: { send } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero',
      arenaLeadership: createArenaLeadershipReconciliationService(database.db, { cellSize: 500 }),
      cellSize: 500,
    }),
    uploadQueue,
    deletedKeys,
  };
}

async function insertAccount(email: string, displayName = 'Pilot') {
  const [account] = await database.db.insert(users).values({ email }).returning();
  if (!account) throw new Error('Missing account.');
  await database.db.insert(profiles).values({ userId: account.id, displayName });
  await database.db.insert(userPasswords).values({ userId: account.id, passwordHash: 'old' });
  return account;
}

describe('adminUserService', () => {
  it('creates accounts without sessions and searches users by literal email in sorted order', async () => {
    const { service } = harness();
    const first = await service.create({ email: ' Zebra@Example.com ', displayName: 'Zebra', password: 'secret password' });
    const second = await service.create({ email: 'alpha@example.com', displayName: 'Alpha', password: 'secret password' });
    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect((await service.list('EXAMPLE')).map(({ email }) => email)).toEqual(['alpha@example.com', 'zebra@example.com']);
    expect(await database.db.select().from(appSessions)).toEqual([]);
    const passwords = await database.db.select().from(userPasswords);
    expect(await verifyPassword('secret password', passwords[0]!.passwordHash)).toBe(true);
    await expect(service.create({ email: 'ALPHA@example.com', displayName: 'Duplicate', password: 'secret password' }))
      .resolves.toEqual({ status: 'duplicate_email' });
  });

  it('repairs missing profile and password records and revokes every session on password reset', async () => {
    const actor = await insertAccount('admin@example.com', 'Admin');
    const [target] = await database.db.insert(users).values({ email: 'broken@example.com' }).returning();
    if (!target) throw new Error('Missing target.');
    await database.db.insert(appSessions).values([
      { userId: target.id, tokenHash: 'one', expiresAt: new Date(Date.now() + 60_000) },
      { userId: target.id, tokenHash: 'two', expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const { service } = harness();

    await expect(service.update({ actorUserId: actor.id, userId: target.id, email: 'fixed@example.com', displayName: 'Fixed' }))
      .resolves.toBe('completed');
    await expect(service.setPassword({ actorUserId: actor.id, userId: target.id, password: 'new password' }))
      .resolves.toBe('completed');
    const detail = await service.get(target.id);
    expect(detail).toMatchObject({ email: 'fixed@example.com', displayName: 'Fixed', hasPassword: true });
    expect(await database.db.select().from(appSessions)).toEqual([]);
    const [credential] = await database.db.select().from(userPasswords).where(eq(userPasswords.userId, target.id));
    expect(await verifyPassword('new password', credential!.passwordHash)).toBe(true);
  });

  it('protects the acting admin and blocks deletion while database or queue work is active', async () => {
    const actor = await insertAccount('admin@example.com', 'Admin');
    const { service } = harness();
    await expect(service.update({ actorUserId: actor.id, userId: actor.id, email: 'changed@example.com', displayName: 'Changed' }))
      .resolves.toBe('protected');
    await expect(service.delete({ actorUserId: actor.id, userId: actor.id })).resolves.toBe('protected');

    const target = await insertAccount('pilot@example.com');
    const [file] = await database.db.insert(igcFiles).values({
      userId: target.id, originalFilename: 'active.igc', contentType: 'text/plain', byteSize: 10, bucketKey: 'glidehero/uploads/active.igc',
    }).returning();
    await database.db.insert(flights).values({
      userId: target.id, igcFileId: file!.id, contentHash: 'a'.repeat(64), processingStatus: 'processing',
    });
    await expect(service.delete({ actorUserId: actor.id, userId: target.id })).resolves.toBe('active_work');

    const queued = harness({ activeJobs: 1 }).service;
    const queuedTarget = await insertAccount('queued@example.com');
    await expect(queued.delete({ actorUserId: actor.id, userId: queuedTarget.id })).resolves.toBe('active_work');
  });

  it('purges known and prefix objects, terminal queue state, and cascading database rows idempotently', async () => {
    const actor = await insertAccount('admin@example.com', 'Admin');
    const target = await insertAccount('pilot@example.com');
    const knownKey = `glidehero/uploads/${target.id}/known.igc`;
    const extraKey = `glidehero/uploads/${target.id}/orphan.igc`;
    const [file] = await database.db.insert(igcFiles).values({
      userId: target.id, originalFilename: 'known.igc', contentType: 'text/plain', byteSize: 10, bucketKey: knownKey,
    }).returning();
    await database.db.insert(flights).values({
      userId: target.id, igcFileId: file!.id, contentHash: 'b'.repeat(64), processingStatus: 'completed',
    });
    await database.db.delete(profiles).where(eq(profiles.userId, target.id));
    await database.db.delete(userPasswords).where(eq(userPasswords.userId, target.id));
    const { service, uploadQueue, deletedKeys } = harness({ listedKeys: [extraKey] });

    await expect(service.delete({ actorUserId: actor.id, userId: target.id })).resolves.toBe('completed');
    expect(new Set(deletedKeys)).toEqual(new Set([knownKey, extraKey]));
    expect(uploadQueue.removeTerminalJobsForUser).toHaveBeenCalledWith(target.id);
    expect(await database.db.select().from(users)).toHaveLength(1);
    expect(await database.db.select().from(flights)).toEqual([]);
    await expect(service.delete({ actorUserId: actor.id, userId: target.id })).resolves.toBe('completed');
  });

  it('reconciles affected Arena leadership after the deleted pilot claims cascade', async () => {
    const actor = await insertAccount('admin@example.com', 'Admin');
    const target = await insertAccount('leader@example.com', 'Leader');
    const remaining = await insertAccount('remaining@example.com', 'Remaining');
    const targetFile = crypto.randomUUID();
    const remainingFile = crypto.randomUUID();
    const targetFlight = crypto.randomUUID();
    const remainingFlight = crypto.randomUUID();
    const arenaId = crypto.randomUUID();
    await database.pool.query(
      `INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key)
       VALUES ($1::uuid, $3, 'leader.igc', 'text/plain', 1, $1::uuid::text),
              ($2::uuid, $4, 'remaining.igc', 'text/plain', 1, $2::uuid::text)`,
      [targetFile, remainingFile, target.id, remaining.id],
    );
    await database.pool.query(
      `INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status)
       VALUES ($1::uuid, $3, $5, $1::uuid::text, 'completed'),
              ($2::uuid, $4, $6, $2::uuid::text, 'completed')`,
      [targetFlight, remainingFlight, target.id, remaining.id, targetFile, remainingFile],
    );
    await database.pool.query(
      `INSERT INTO arenas (id, source_id, name, country, country_code, area, arena_type)
       VALUES ($1, 90001, 'Deletion Arena', 'United States', 'US',
         ST_GeomFromText('MULTIPOLYGON (((0 0, 1500 0, 1500 1500, 0 1500, 0 0)))', 6933), 'general')`,
      [arenaId],
    );
    await database.pool.query(
      `INSERT INTO competition_grid_claims
         (competition_month, x, y, claim_flight, claim_user, claim_timestamp)
       VALUES
         ('2026-01-01', 0, 0, $1, $3, '2026-01-01T00:00:00Z'),
         ('2026-01-01', 1, 0, $1, $3, '2026-01-02T00:00:00Z'),
         ('2026-01-01', 2, 0, $2, $4, '2026-01-03T00:00:00Z')`,
      [targetFlight, remainingFlight, target.id, remaining.id],
    );
    const leadership = createArenaLeadershipReconciliationService(database.db, { cellSize: 500 });
    await leadership.reconcile({ arenaIds: [arenaId] });

    const { service } = harness();
    await expect(service.delete({ actorUserId: actor.id, userId: target.id })).resolves.toBe('completed');

    const projection = await database.pool.query<{
      user_id: string;
      cells_claimed: number;
      leading_cell_count: number;
      next_rank_cell_count: number;
    }>(
      `SELECT leader.user_id, leader.cells_claimed, state.leading_cell_count, state.next_rank_cell_count
       FROM arena_leadership_states state
       INNER JOIN arena_current_leaders leader ON leader.arena_id = state.arena_id
       WHERE state.arena_id = $1`,
      [arenaId],
    );
    expect(projection.rows).toEqual([{
      user_id: remaining.id,
      cells_claimed: 1,
      leading_cell_count: 1,
      next_rank_cell_count: 0,
    }]);
  });
});
