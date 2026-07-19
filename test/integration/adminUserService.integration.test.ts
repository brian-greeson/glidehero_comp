import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSessions, flights, igcFiles, profiles, userPasswords, users } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { createAdminUserService } from '../../src/services/adminUserService.js';
import { verifyPassword } from '../../src/services/passwordService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
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
});
