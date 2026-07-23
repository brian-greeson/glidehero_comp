import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, igcFiles, users } from '../db/schema.js';
import type { GridClaimService } from './gridClaimService.js';
import type { FlightUploadQueueService } from './flightUploadQueueService.js';
import {
  type ArenaLeadershipReconciliationService,
} from './arenaLeadershipReconciliationService.js';
import { findEligibleArenaIdsForCompetitionFlight } from './arenaClaimImpact.js';
import type { FlightThumbnailLifecycleService } from './flightThumbnailLifecycleService.js';
import { flightThumbnailErrorDetails } from './flightThumbnailService.js';
import { lockUserProgression } from './gridClaimService.js';
import type { UserAchievementProgressService } from './userAchievementProgressService.js';

export type AdminFlight = {
  id: string;
  flightDate: string | null;
  pilotEmail: string;
  originalFilename: string;
  processingStatus: 'processing' | 'completed' | 'failed';
};

export type AdminUserFlight = Omit<AdminFlight, 'pilotEmail'>;

export type AdminBulkFlightDeleteResult = {
  deleted: number;
  skipped: number;
  failed: number;
};

export interface AdminFlightService {
  listRecentFlights(): Promise<AdminFlight[]>;
  listUserFlights(userId: string): Promise<AdminUserFlight[]>;
  reprocessFlight(input: { flightId: string; userId?: string }): ReturnType<GridClaimService['reprocess']>;
  deleteFlight(input: { flightId: string; userId: string }): Promise<'deleted' | 'already_deleted' | 'processing'>;
  deleteAllUserFlights(userId: string): Promise<AdminBulkFlightDeleteResult>;
  createDownloadUrl(input: { flightId: string; userId: string }): Promise<{ url: string; filename: string } | null>;
}

type StorageOptions = {
  s3Client: S3;
  bucketName: string;
  uploadQueue: Pick<FlightUploadQueueService, 'removeTerminalJobsForFlight'>;
  presign?: (command: GetObjectCommand) => Promise<string>;
  thumbnailLifecycle?: Pick<FlightThumbnailLifecycleService, 'generateForFlight' | 'deleteForFlight'>;
};

type ArenaLeadershipOptions = {
  arenaLeadership: ArenaLeadershipReconciliationService;
  cellSize: number;
  userAchievementProgress?: Pick<UserAchievementProgressService, 'rebuildInTransaction'>;
};

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === 'NotFound'
    || value.name === 'NoSuchKey'
    || value.Code === 'NoSuchKey'
    || value.$metadata?.httpStatusCode === 404;
}

function attachmentName(filename: string): string {
  const safeAscii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\\r\n]/g, '_') || 'flight.igc';
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createAdminFlightService(
  database: Database,
  gridClaim: Pick<GridClaimService, 'reprocess'>,
  storage?: StorageOptions,
  arenaLeadershipOptions?: ArenaLeadershipOptions,
): AdminFlightService {
  const configuredCellSize = arenaLeadershipOptions?.cellSize;
  async function storedFlight(input: { flightId: string; userId: string }) {
    const [row] = await database
      .select({
        id: flights.id,
        userId: flights.userId,
        igcFileId: igcFiles.id,
        bucketKey: igcFiles.bucketKey,
        originalFilename: igcFiles.originalFilename,
        processingStatus: flights.processingStatus,
      })
      .from(flights)
      .innerJoin(igcFiles, eq(flights.igcFileId, igcFiles.id))
      .where(and(eq(flights.id, input.flightId), eq(flights.userId, input.userId)))
      .limit(1);
    return row ?? null;
  }

  async function deleteFlight(input: { flightId: string; userId: string }) {
    const flight = await storedFlight(input);
    if (!flight) return 'already_deleted' as const;
    if (flight.processingStatus === 'processing') return 'processing' as const;
    if (!storage) throw new Error('Admin flight storage is not configured.');

    await database.transaction(async (tx) => {
      if (flight.processingStatus === 'completed' && arenaLeadershipOptions?.userAchievementProgress) {
        await lockUserProgression(tx, input.userId);
      }
      const arenaIds = await findEligibleArenaIdsForCompetitionFlight(tx, {
        flightId: input.flightId,
        cellSize: configuredCellSize,
      });
      await tx.delete(igcFiles).where(and(eq(igcFiles.id, flight.igcFileId), eq(igcFiles.userId, input.userId)));
      if (flight.processingStatus === 'completed' && arenaLeadershipOptions?.userAchievementProgress) {
        await arenaLeadershipOptions.userAchievementProgress.rebuildInTransaction(tx, input.userId);
      }
      if (arenaIds.length > 0) {
        const arenaLeadership = arenaLeadershipOptions?.arenaLeadership;
        if (!arenaLeadership) throw new Error('Arena leadership dependencies are not configured.');
        await arenaLeadership.reconcileInTransaction(tx, { arenaIds });
      }
      // Keep the object intact until every database mutation that can fail has
      // succeeded. External cleanup runs before commit so an object-store
      // failure still rolls the database deletion back for a safe retry.
      await storage.uploadQueue.removeTerminalJobsForFlight({
        userId: input.userId,
        flightId: input.flightId,
        igcFileId: flight.igcFileId,
        bucketKey: flight.bucketKey,
      });
      await storage.s3Client.send(new DeleteObjectCommand({ Bucket: storage.bucketName, Key: flight.bucketKey }));
      if (storage.thumbnailLifecycle) {
        await storage.thumbnailLifecycle.deleteForFlight({ userId: input.userId, flightId: input.flightId });
      }
    });
    return 'deleted' as const;
  }

  return {
    async listRecentFlights() {
      const rows = await database
        .select({
          id: flights.id,
          startedAt: flights.startedAt,
          pilotEmail: users.email,
          originalFilename: igcFiles.originalFilename,
          processingStatus: flights.processingStatus,
        })
        .from(flights)
        .innerJoin(users, eq(flights.userId, users.id))
        .innerJoin(igcFiles, eq(flights.igcFileId, igcFiles.id))
        .orderBy(desc(flights.createdAt), desc(flights.id))
        .limit(100);

      return rows.map((flight) => ({
        id: flight.id,
        flightDate: flight.startedAt?.toISOString().slice(0, 10) ?? null,
        pilotEmail: flight.pilotEmail,
        originalFilename: flight.originalFilename,
        processingStatus: flight.processingStatus,
      }));
    },

    async listUserFlights(userId) {
      const rows = await database
        .select({
          id: flights.id,
          startedAt: flights.startedAt,
          originalFilename: igcFiles.originalFilename,
          processingStatus: flights.processingStatus,
        })
        .from(flights)
        .innerJoin(igcFiles, eq(flights.igcFileId, igcFiles.id))
        .where(eq(flights.userId, userId))
        .orderBy(desc(flights.createdAt), desc(flights.id));
      return rows.map((flight) => ({
        id: flight.id,
        flightDate: flight.startedAt?.toISOString().slice(0, 10) ?? null,
        originalFilename: flight.originalFilename,
        processingStatus: flight.processingStatus,
      }));
    },

    async reprocessFlight(input) {
      if (input.userId && !(await storedFlight({ flightId: input.flightId, userId: input.userId }))) {
        return { status: 'not_found' };
      }
      const result = await gridClaim.reprocess({ flightId: input.flightId });
      if (result.status === 'completed' && storage?.thumbnailLifecycle) {
        try {
          await storage.thumbnailLifecycle.generateForFlight(input.flightId);
        } catch (error) {
          console.error('Unable to regenerate flight thumbnail', {
            flightId: input.flightId,
            ...flightThumbnailErrorDetails(error),
          });
        }
      }
      return result;
    },

    deleteFlight,

    async deleteAllUserFlights(userId) {
      const userFlights = await database
        .select({ id: flights.id, processingStatus: flights.processingStatus })
        .from(flights)
        .where(eq(flights.userId, userId))
        .orderBy(desc(flights.createdAt), desc(flights.id));
      const result: AdminBulkFlightDeleteResult = { deleted: 0, skipped: 0, failed: 0 };

      for (const flight of userFlights) {
        if (flight.processingStatus === 'processing') {
          result.skipped += 1;
          continue;
        }
        try {
          const status = await deleteFlight({ userId, flightId: flight.id });
          if (status === 'deleted') result.deleted += 1;
          else result.skipped += 1;
        } catch {
          result.failed += 1;
        }
      }
      return result;
    },

    async createDownloadUrl(input) {
      const flight = await storedFlight(input);
      if (!flight || flight.processingStatus === 'processing') return null;
      if (!storage) throw new Error('Admin flight storage is not configured.');
      try {
        await storage.s3Client.send(new HeadObjectCommand({ Bucket: storage.bucketName, Key: flight.bucketKey }));
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
      const command = new GetObjectCommand({
        Bucket: storage.bucketName,
        Key: flight.bucketKey,
        ResponseContentDisposition: attachmentName(flight.originalFilename),
      });
      const url = await (storage.presign ?? ((value) => getSignedUrl(storage.s3Client, value, { expiresIn: 5 * 60 })))(command);
      return { url, filename: flight.originalFilename };
    },
  };
}
