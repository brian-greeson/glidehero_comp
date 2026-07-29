import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  bulkImportMembers,
  bulkImports,
  flights,
  regularUploadBatches,
  regularUploadMembers,
  userWorkflowState,
} from '../db/schema.js';

export const BULK_FLIGHT_BATCH_SIZE = 3;
type MemberInput = { flightId: string; startedAt: Date; uploadJobId?: string };
type ClaimedMember = { id: string; flightId: string; startedAt: Date; uploadJobId: string | null; importId?: string; batchId?: string };
export type RecoverableWorkflowMember = ClaimedMember & {
  userId: string;
  kind: 'regular' | 'bulk';
  flightStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingToken: string | null;
  claimedAt: Date | null;
  failureReason: string | null;
};
export type ExpiredWorkflowJob = { uploadJobId: string; userId: string; reason: string };

export interface FlightUploadWorkflowService {
  createRegularBatch(userId: string): Promise<{ id: string; status: 'open' }>;
  sealRegularBatch(batchId: string, userId: string): Promise<boolean>;
  addRegularMembers(batchId: string, userId: string, members: MemberInput[]): Promise<number>;
  createBulkImport(userId: string): Promise<{ id: string; phase: 'preparing' }>;
  sealBulkImport(importId: string, userId: string): Promise<boolean>;
  addBulkMembers(importId: string, userId: string, members: MemberInput[]): Promise<number>;
  getActiveBulkImport(userId: string): Promise<typeof bulkImports.$inferSelect | null>;
  claimNextRegular(userId: string): Promise<ClaimedMember | null>;
  claimNextBulk(importId: string, userId: string): Promise<ClaimedMember | null>;
  releaseRegularClaim(memberId: string): Promise<void>;
  releaseBulkClaim(memberId: string): Promise<void>;
  recordRegularOutcome(memberId: string, status: 'completed' | 'failed', failureReason?: string): Promise<void>;
  recordBulkOutcome(memberId: string, status: 'completed' | 'failed' | 'skipped', failureReason?: string): Promise<void>;
  markDirtyBoundary(userId: string, startedAt: Date): Promise<void>;
  getDirtyBoundary(userId: string): Promise<Date | null>;
  clearDirtyBoundary(userId: string, expected?: Date, expectedRevision?: number): Promise<boolean>;
  listDirtyUsers(limit?: number): Promise<Array<{ userId: string; dirtyStartedAt: Date; revision: number }>>;
  listReplayableBulkImports(limit?: number): Promise<Array<{ id: string; userId: string; phase: 'replaying' | 'failed'; replayCursor: number }>>;
  hasUnfinishedBulkMembers(importId: string, userId: string): Promise<boolean>;
  beginBulkReplay(importId: string, userId: string): Promise<boolean>;
  setBulkPhase(importId: string, userId: string, phase: 'processing' | 'replaying' | 'completed' | 'failed', lastError?: string): Promise<void>;
  listProcessingMembers(limit?: number): Promise<RecoverableWorkflowMember[]>;
  resetOrphanedProcessingMember(input: {
    kind: 'regular' | 'bulk';
    memberId: string;
    flightId: string;
    processingToken: string;
  }): Promise<boolean>;
  cancelBulkImport(
    importId: string,
    userId: string,
  ): Promise<{ cancelled: boolean; jobs: ExpiredWorkflowJob[] }>;
  expireAbandonedWorkflows(cutoff: Date): Promise<ExpiredWorkflowJob[]>;
}

export function createFlightUploadWorkflowService(database: Database): FlightUploadWorkflowService {
  return {
    async createRegularBatch(userId) {
      const [row] = await database.insert(regularUploadBatches).values({ userId }).returning({ id: regularUploadBatches.id });
      if (!row) throw new Error('Unable to create regular upload batch');
      return { id: row.id, status: 'open' };
    },
    async sealRegularBatch(batchId, userId) {
      const updated = await database
        .update(regularUploadBatches)
        .set({ status: 'sealed', updatedAt: new Date() })
        .where(and(
          eq(regularUploadBatches.id, batchId),
          eq(regularUploadBatches.userId, userId),
          eq(regularUploadBatches.status, 'open'),
        ))
        .returning({ id: regularUploadBatches.id });
      return updated.length > 0;
    },
    async addRegularMembers(batchId, userId, members) {
      if (!members.length) return 0;
      return database.transaction(async (tx) => {
        const [batch] = await tx
          .select({ id: regularUploadBatches.id })
          .from(regularUploadBatches)
          .where(and(
            eq(regularUploadBatches.id, batchId),
            eq(regularUploadBatches.userId, userId),
            eq(regularUploadBatches.status, 'open'),
          ))
          .for('update');
        if (!batch) throw new Error('Regular upload batch is not accepting flights.');
        const inserted = await tx
          .insert(regularUploadMembers)
          .values(members.map((member) => ({ ...member, batchId, userId })))
          .onConflictDoNothing()
          .returning({ id: regularUploadMembers.id });
        return inserted.length;
      });
    },
    async createBulkImport(userId) {
      try {
        const [row] = await database.insert(bulkImports).values({ userId }).returning({ id: bulkImports.id });
        if (!row) throw new Error('Unable to create bulk import');
        return { id: row.id, phase: 'preparing' };
      } catch (error) {
        if (String(error).includes('bulk_imports_one_active_per_user_idx')) throw new Error('An active bulk import already exists');
        throw error;
      }
    },
    async sealBulkImport(importId, userId) {
      const updated = await database
        .update(bulkImports)
        .set({ phase: 'processing', updatedAt: new Date() })
        .where(and(
          eq(bulkImports.id, importId),
          eq(bulkImports.userId, userId),
          eq(bulkImports.phase, 'preparing'),
        ))
        .returning({ id: bulkImports.id });
      return updated.length > 0;
    },
    async addBulkMembers(importId, userId, members) {
      if (!members.length) return 0;
      return database.transaction(async (tx) => {
        const [bulk] = await tx
          .select({ id: bulkImports.id })
          .from(bulkImports)
          .where(and(
            eq(bulkImports.id, importId),
            eq(bulkImports.userId, userId),
            eq(bulkImports.phase, 'preparing'),
          ))
          .for('update');
        if (!bulk) throw new Error('Bulk import is not accepting flights.');
        const inserted = await tx
          .insert(bulkImportMembers)
          .values(members.map((member) => ({ ...member, importId, userId })))
          .onConflictDoNothing()
          .returning({ id: bulkImportMembers.id });
        return inserted.length;
      });
    },
    async getActiveBulkImport(userId) {
      const [row] = await database.select().from(bulkImports).where(and(eq(bulkImports.userId, userId), sql`${bulkImports.phase} IN ('preparing','processing','replaying','failed')`)).limit(1);
      return row ?? null;
    },
    async claimNextRegular(userId) {
      return database.transaction(async (tx) => {
        const result = await tx.execute(sql`UPDATE regular_upload_members SET status = 'processing', claimed_at = now(), updated_at = now() WHERE id = (SELECT m.id FROM regular_upload_members m JOIN regular_upload_batches b ON b.id = m.batch_id WHERE m.user_id = ${userId} AND m.status = 'pending' AND b.status = 'sealed' AND NOT EXISTS (SELECT 1 FROM regular_upload_members p WHERE p.user_id = m.user_id AND p.status = 'processing') ORDER BY m.started_at ASC, m.flight_id ASC FOR UPDATE OF m SKIP LOCKED LIMIT 1) RETURNING id, flight_id AS "flightId", started_at AS "startedAt", upload_job_id AS "uploadJobId", batch_id AS "batchId"`);
        return (result.rows[0] as ClaimedMember | undefined) ?? null;
      });
    },
    async claimNextBulk(importId, userId) {
      return database.transaction(async (tx) => {
        const result = await tx.execute(sql`UPDATE bulk_import_members SET status = 'processing', claimed_at = now(), updated_at = now() WHERE id = (SELECT m.id FROM bulk_import_members m JOIN bulk_imports b ON b.id = m.import_id WHERE m.import_id = ${importId} AND m.user_id = ${userId} AND m.status = 'pending' AND b.phase = 'processing' AND NOT EXISTS (SELECT 1 FROM bulk_import_members p WHERE p.import_id = m.import_id AND p.status = 'processing') ORDER BY m.started_at ASC, m.flight_id ASC FOR UPDATE OF m SKIP LOCKED LIMIT 1) RETURNING id, flight_id AS "flightId", started_at AS "startedAt", upload_job_id AS "uploadJobId", import_id AS "importId"`);
        return (result.rows[0] as ClaimedMember | undefined) ?? null;
      });
    },
    async releaseRegularClaim(memberId) {
      await database.update(regularUploadMembers)
        .set({ status: 'pending', claimedAt: null, updatedAt: new Date() })
        .where(and(eq(regularUploadMembers.id, memberId), eq(regularUploadMembers.status, 'processing')));
    },
    async releaseBulkClaim(memberId) {
      await database.update(bulkImportMembers)
        .set({ status: 'pending', claimedAt: null, updatedAt: new Date() })
        .where(and(eq(bulkImportMembers.id, memberId), eq(bulkImportMembers.status, 'processing')));
    },
    async recordRegularOutcome(memberId, status, failureReason) {
      await database.update(regularUploadMembers).set({ status, failureReason, updatedAt: new Date() }).where(and(
        eq(regularUploadMembers.id, memberId),
        sql`${regularUploadMembers.status} IN ('pending', 'processing')`,
      ));
    },
    async recordBulkOutcome(memberId, status, failureReason) {
      await database.update(bulkImportMembers).set({ status, failureReason, updatedAt: new Date() }).where(and(
        eq(bulkImportMembers.id, memberId),
        sql`${bulkImportMembers.status} IN ('pending', 'processing')`,
      ));
    },
    async markDirtyBoundary(userId, startedAt) {
      await database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
        await tx.insert(userWorkflowState).values({ userId, dirtyAchievementBoundary: startedAt, dirtyRevision: 1 }).onConflictDoUpdate({ target: userWorkflowState.userId, set: { dirtyAchievementBoundary: sql`LEAST(COALESCE(${userWorkflowState.dirtyAchievementBoundary}, ${startedAt}), ${startedAt})`, dirtyRevision: sql`${userWorkflowState.dirtyRevision} + 1`, updatedAt: new Date() } });
      });
    },
    async getDirtyBoundary(userId) {
      const [row] = await database.select({ value: userWorkflowState.dirtyAchievementBoundary }).from(userWorkflowState).where(eq(userWorkflowState.userId, userId));
      return row?.value ?? null;
    },
    async clearDirtyBoundary(userId, expected, expectedRevision) {
      const rows = await database
        .update(userWorkflowState)
        .set({ dirtyAchievementBoundary: null, updatedAt: new Date() })
        .where(and(
          eq(userWorkflowState.userId, userId),
          ...(expected ? [eq(userWorkflowState.dirtyAchievementBoundary, expected)] : []),
          ...(expectedRevision !== undefined ? [eq(userWorkflowState.dirtyRevision, expectedRevision)] : []),
        ))
        .returning({ userId: userWorkflowState.userId });
      return rows.length > 0;
    },
    async listDirtyUsers(limit = 25) {
      const result = await database.execute(sql`
        SELECT user_id AS "userId", dirty_achievement_boundary AS "dirtyStartedAt", dirty_revision AS revision
        FROM user_workflow_state
        WHERE dirty_achievement_boundary IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM bulk_imports b
            WHERE b.user_id = user_workflow_state.user_id
              AND b.phase IN ('preparing', 'processing', 'replaying', 'failed')
          )
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `);
      return result.rows as Array<{ userId: string; dirtyStartedAt: Date; revision: number }>;
    },
    async listReplayableBulkImports(limit = 25) {
      const result = await database.execute(sql`
        SELECT id, user_id AS "userId", phase, replay_cursor AS "replayCursor"
        FROM bulk_imports
        WHERE phase IN ('replaying', 'failed')
        ORDER BY updated_at ASC
        LIMIT ${limit}
      `);
      return result.rows as Array<{ id: string; userId: string; phase: 'replaying' | 'failed'; replayCursor: number }>;
    },
    async hasUnfinishedBulkMembers(importId, userId) {
      const result = await database.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM bulk_import_members
          WHERE import_id = ${importId}
            AND user_id = ${userId}
            AND status IN ('pending', 'processing')
        ) AS value
      `);
      return Boolean(result.rows[0]?.value);
    },
    async beginBulkReplay(importId, userId) {
      const updated = await database
        .update(bulkImports)
        .set({ phase: 'replaying', lastError: null, updatedAt: new Date() })
        .where(and(
          eq(bulkImports.id, importId),
          eq(bulkImports.userId, userId),
          sql`${bulkImports.phase} IN ('processing', 'failed')`,
        ))
        .returning({ id: bulkImports.id });
      return updated.length > 0;
    },
    async setBulkPhase(importId, userId, phase, lastError) {
      await database.update(bulkImports).set({ phase, lastError, updatedAt: new Date() }).where(and(eq(bulkImports.id, importId), eq(bulkImports.userId, userId)));
    },
    async listProcessingMembers(limit = 100) {
      const result = await database.execute(sql`
        SELECT m.id, m.flight_id AS "flightId", m.started_at AS "startedAt",
          m.upload_job_id AS "uploadJobId", m.user_id AS "userId",
          m.batch_id AS "batchId", NULL::uuid AS "importId", 'regular' AS kind,
          f.processing_status AS "flightStatus", f.processing_token AS "processingToken",
          m.claimed_at AS "claimedAt", f.processing_error AS "failureReason"
        FROM regular_upload_members m
        JOIN flights f ON f.flight_id = m.flight_id
        WHERE m.status = 'processing'
        UNION ALL
        SELECT m.id, m.flight_id AS "flightId", m.started_at AS "startedAt",
          m.upload_job_id AS "uploadJobId", m.user_id AS "userId",
          NULL::uuid AS "batchId", m.import_id AS "importId", 'bulk' AS kind,
          f.processing_status AS "flightStatus", f.processing_token AS "processingToken",
          m.claimed_at AS "claimedAt", f.processing_error AS "failureReason"
        FROM bulk_import_members m
        JOIN flights f ON f.flight_id = m.flight_id
        WHERE m.status = 'processing'
        ORDER BY "startedAt", id
        LIMIT ${limit}
      `);
      return result.rows as RecoverableWorkflowMember[];
    },
    async resetOrphanedProcessingMember(input) {
      return database.transaction(async (tx) => {
        const resetFlight = await tx
          .update(flights)
          .set({
            processingStatus: 'pending',
            processingToken: null,
            processingError: null,
          })
          .where(and(
            eq(flights.id, input.flightId),
            eq(flights.processingStatus, 'processing'),
            eq(flights.processingToken, input.processingToken),
          ))
          .returning({ id: flights.id });
        if (!resetFlight.length) return false;
        const resetMember = input.kind === 'regular'
          ? await tx
            .update(regularUploadMembers)
            .set({ status: 'pending', claimedAt: null, updatedAt: new Date() })
            .where(and(
              eq(regularUploadMembers.id, input.memberId),
              eq(regularUploadMembers.status, 'processing'),
            ))
            .returning({ id: regularUploadMembers.id })
          : await tx
            .update(bulkImportMembers)
            .set({ status: 'pending', claimedAt: null, updatedAt: new Date() })
            .where(and(
              eq(bulkImportMembers.id, input.memberId),
              eq(bulkImportMembers.status, 'processing'),
            ))
            .returning({ id: bulkImportMembers.id });
        if (!resetMember.length) throw new Error('Orphaned flight reset lost its workflow member claim.');
        return true;
      });
    },
    async cancelBulkImport(importId, userId) {
      return database.transaction(async (tx) => {
        const updated = await tx.update(bulkImports).set({ phase: 'cancelled', updatedAt: new Date() })
          .where(and(eq(bulkImports.id, importId), eq(bulkImports.userId, userId), eq(bulkImports.phase, 'preparing')))
          .returning({ id: bulkImports.id });
        if (!updated.length) return { cancelled: false, jobs: [] };
        const jobs = await tx.execute(sql`
          SELECT upload_job_id AS "uploadJobId", user_id AS "userId",
            'Historical upload was cancelled.' AS reason
          FROM bulk_import_members
          WHERE import_id = ${importId} AND user_id = ${userId}
            AND status = 'pending' AND upload_job_id IS NOT NULL
        `);
        await tx.update(bulkImportMembers).set({ status: 'failed', failureReason: 'Historical upload was cancelled.', updatedAt: new Date() })
          .where(and(eq(bulkImportMembers.importId, importId), eq(bulkImportMembers.userId, userId), eq(bulkImportMembers.status, 'pending')));
        await tx.update(flights).set({ processingStatus: 'failed', processingError: 'Historical upload was cancelled.' })
          .where(and(
            eq(flights.userId, userId),
            eq(flights.processingStatus, 'pending'),
            sql`${flights.id} IN (
              SELECT flight_id FROM bulk_import_members
              WHERE import_id = ${importId} AND user_id = ${userId}
            )`,
          ));
        return { cancelled: true, jobs: jobs.rows as ExpiredWorkflowJob[] };
      });
    },
    async expireAbandonedWorkflows(cutoff) {
      return database.transaction(async (tx) => {
        const jobs = await tx.execute(sql`
          SELECT m.upload_job_id AS "uploadJobId", m.user_id AS "userId",
            'Upload preparation expired.' AS reason
          FROM regular_upload_members m
          JOIN regular_upload_batches b ON b.id = m.batch_id
          WHERE b.status = 'open' AND b.updated_at < ${cutoff}
            AND m.status = 'pending' AND m.upload_job_id IS NOT NULL
          UNION ALL
          SELECT m.upload_job_id AS "uploadJobId", m.user_id AS "userId",
            'Historical upload preparation expired.' AS reason
          FROM bulk_import_members m
          JOIN bulk_imports b ON b.id = m.import_id
          WHERE b.phase = 'preparing' AND b.updated_at < ${cutoff}
            AND m.status = 'pending' AND m.upload_job_id IS NOT NULL
        `);
        await tx.execute(sql`UPDATE regular_upload_batches SET status = 'cancelled', updated_at = now() WHERE status = 'open' AND updated_at < ${cutoff}`);
        await tx.execute(sql`UPDATE bulk_imports SET phase = 'cancelled', updated_at = now() WHERE phase = 'preparing' AND updated_at < ${cutoff}`);
        await tx.execute(sql`
          UPDATE regular_upload_members m SET status = 'failed', failure_reason = 'Upload preparation expired.', updated_at = now()
          FROM regular_upload_batches b WHERE b.id = m.batch_id AND b.status = 'cancelled' AND m.status = 'pending'
        `);
        await tx.execute(sql`
          UPDATE bulk_import_members m SET status = 'failed', failure_reason = 'Historical upload preparation expired.', updated_at = now()
          FROM bulk_imports b WHERE b.id = m.import_id AND b.phase = 'cancelled' AND m.status = 'pending'
        `);
        await tx.execute(sql`
          UPDATE flights f SET processing_status = 'failed', processing_error = 'Upload preparation expired.'
          WHERE f.processing_status = 'pending' AND (
            EXISTS (
              SELECT 1 FROM regular_upload_members m
              JOIN regular_upload_batches b ON b.id=m.batch_id
              WHERE m.flight_id=f.flight_id AND m.user_id=f.user_id AND b.user_id=f.user_id
                AND b.status='cancelled'
            )
            OR EXISTS (
              SELECT 1 FROM bulk_import_members m
              JOIN bulk_imports b ON b.id=m.import_id
              WHERE m.flight_id=f.flight_id AND m.user_id=f.user_id AND b.user_id=f.user_id
                AND b.phase='cancelled'
            )
          )
        `);
        return jobs.rows as ExpiredWorkflowJob[];
      });
    },
  };
}
