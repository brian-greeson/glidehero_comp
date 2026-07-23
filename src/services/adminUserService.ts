import { DeleteObjectCommand, ListObjectsV2Command, type S3 } from '@aws-sdk/client-s3';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { appSessions, flights, igcFiles, profiles, userPasswords, users } from '../db/schema.js';
import { buildLiteralSearchPatterns } from '../domain/search/searchSanitizer.js';
import { flightUploadPrefix, type FlightUploadQueueService } from './flightUploadQueueService.js';
import { hashPassword } from './passwordService.js';
import type { ArenaLeadershipReconciliationService } from './arenaLeadershipReconciliationService.js';
import { findEligibleArenaIdsForCompetitionUser } from './arenaClaimImpact.js';
import { lockArenaCatalogShared } from './arenaCatalogLock.js';
import type { UserAchievementProgressService } from './userAchievementProgressService.js';

export type AdminUserSummary = {
  id: string;
  email: string;
  displayName: string | null;
};

export type AdminUserDetail = AdminUserSummary & {
  hasPassword: boolean;
  lastLogin: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminUserMutationResult = 'completed' | 'not_found' | 'duplicate_email' | 'protected' | 'active_work';

export interface AdminUserService {
  list(search?: string): Promise<AdminUserSummary[]>;
  get(userId: string): Promise<AdminUserDetail | null>;
  create(input: { email: string; displayName: string; password: string }): Promise<{ status: AdminUserMutationResult; userId?: string }>;
  update(input: { actorUserId: string; userId: string; email: string; displayName: string }): Promise<AdminUserMutationResult>;
  setPassword(input: { actorUserId: string; userId: string; password: string }): Promise<AdminUserMutationResult>;
  delete(input: { actorUserId: string; userId: string }): Promise<AdminUserMutationResult>;
}

type CleanupOptions = {
  uploadQueue: Pick<FlightUploadQueueService, 'activeJobCountForUser' | 'removeTerminalJobsForUser'>;
  s3Client: S3;
  bucketName: string;
  bucketFolder: string;
  arenaLeadership: ArenaLeadershipReconciliationService;
  cellSize: number;
  userAchievementProgress?: Pick<UserAchievementProgressService, 'initializeInTransaction'>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}

export function createAdminUserService(database: Database, cleanup: CleanupOptions): AdminUserService {
  async function deleteStoredObjects(userId: string, knownKeys: string[]): Promise<void> {
    const keys = new Set(knownKeys);
    let continuationToken: string | undefined;
    do {
      const page = await cleanup.s3Client.send(new ListObjectsV2Command({
        Bucket: cleanup.bucketName,
        Prefix: flightUploadPrefix(cleanup.bucketFolder, userId),
        ContinuationToken: continuationToken,
      }));
      for (const object of page.Contents ?? []) if (object.Key) keys.add(object.Key);
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    for (const key of keys) {
      await cleanup.s3Client.send(new DeleteObjectCommand({ Bucket: cleanup.bucketName, Key: key }));
    }
  }

  return {
    async list(search = '') {
      const trimmed = search.trim();
      const pattern = buildLiteralSearchPatterns(trimmed).contains;
      const result = await database.execute<AdminUserSummary>(sql`
        SELECT account.user_id AS id, account.email, profile.display_name AS "displayName"
        FROM users account
        LEFT JOIN profiles profile ON profile.user_id = account.user_id
        WHERE ${trimmed === ''} OR account.email ILIKE ${pattern} ESCAPE E'\\\\'
        ORDER BY lower(account.email), account.user_id
      `);
      return result.rows;
    },

    async get(userId) {
      const [account] = await database
        .select({
          id: users.id,
          email: users.email,
          displayName: profiles.displayName,
          passwordUserId: userPasswords.userId,
          lastLogin: users.lastLogin,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .leftJoin(profiles, eq(profiles.userId, users.id))
        .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);
      return account ? {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        hasPassword: Boolean(account.passwordUserId),
        lastLogin: account.lastLogin,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      } : null;
    },

    async create(input) {
      const passwordHash = await hashPassword(input.password);
      try {
        const userId = await database.transaction(async (tx) => {
          const [account] = await tx.insert(users).values({ email: normalizeEmail(input.email) }).returning({ id: users.id });
          if (!account) throw new Error('User insert returned no row.');
          await tx.insert(profiles).values({ userId: account.id, displayName: input.displayName.trim() });
          if (cleanup.userAchievementProgress) {
            await cleanup.userAchievementProgress.initializeInTransaction(tx, account.id);
          }
          await tx.insert(userPasswords).values({ userId: account.id, passwordHash });
          return account.id;
        });
        return { status: 'completed', userId };
      } catch (error) {
        if (isUniqueViolation(error)) return { status: 'duplicate_email' };
        throw error;
      }
    },

    async update(input) {
      if (input.actorUserId === input.userId) return 'protected';
      try {
        return await database.transaction(async (tx) => {
          const now = new Date();
          const [account] = await tx
            .update(users)
            .set({ email: normalizeEmail(input.email), updatedAt: now })
            .where(eq(users.id, input.userId))
            .returning({ id: users.id });
          if (!account) return 'not_found';
          await tx.insert(profiles)
            .values({ userId: input.userId, displayName: input.displayName.trim(), updatedAt: now })
            .onConflictDoUpdate({
              target: profiles.userId,
              set: { displayName: input.displayName.trim(), updatedAt: now },
            });
          return 'completed';
        });
      } catch (error) {
        if (isUniqueViolation(error)) return 'duplicate_email';
        throw error;
      }
    },

    async setPassword(input) {
      if (input.actorUserId === input.userId) return 'protected';
      const passwordHash = await hashPassword(input.password);
      return database.transaction(async (tx) => {
        const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
        if (!account) return 'not_found';
        const now = new Date();
        await tx.insert(userPasswords)
          .values({ userId: input.userId, passwordHash, updatedAt: now })
          .onConflictDoUpdate({ target: userPasswords.userId, set: { passwordHash, updatedAt: now } });
        await tx.delete(appSessions).where(eq(appSessions.userId, input.userId));
        return 'completed';
      });
    },

    async delete(input) {
      if (input.actorUserId === input.userId) return 'protected';
      const [processingFlight] = await database
        .select({ id: flights.id })
        .from(flights)
        .where(and(eq(flights.userId, input.userId), eq(flights.processingStatus, 'processing')))
        .limit(1);
      if (processingFlight || await cleanup.uploadQueue.activeJobCountForUser(input.userId) > 0) return 'active_work';

      const storedFiles = await database
        .select({ bucketKey: igcFiles.bucketKey })
        .from(igcFiles)
        .where(eq(igcFiles.userId, input.userId));
      await deleteStoredObjects(input.userId, storedFiles.map(({ bucketKey }) => bucketKey));
      await cleanup.uploadQueue.removeTerminalJobsForUser(input.userId);
      await database.transaction(async (tx) => {
        await lockArenaCatalogShared(tx);
        const arenaIds = await findEligibleArenaIdsForCompetitionUser(tx, {
          userId: input.userId,
          cellSize: cleanup.cellSize,
        });
        await tx.delete(users).where(eq(users.id, input.userId));
        if (arenaIds.length > 0) {
          await cleanup.arenaLeadership.reconcileInTransaction(tx, { arenaIds });
        }
      });
      return 'completed';
    },
  };
}
