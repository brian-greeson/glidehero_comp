import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, igcFiles, users } from '../db/schema.js';
import type { GridClaimService } from './gridClaimService.js';
import type { FlightUploadQueueService } from './flightUploadQueueService.js';

export type AdminFlight = {
  id: string;
  flightDate: string | null;
  pilotEmail: string;
  originalFilename: string;
  processingStatus: 'processing' | 'completed' | 'failed';
};

export type AdminUserFlight = Omit<AdminFlight, 'pilotEmail'>;

export interface AdminFlightService {
  listRecentFlights(): Promise<AdminFlight[]>;
  listUserFlights(userId: string): Promise<AdminUserFlight[]>;
  reprocessFlight(input: { flightId: string; userId?: string }): ReturnType<GridClaimService['reprocess']>;
  deleteFlight(input: { flightId: string; userId: string }): Promise<'deleted' | 'already_deleted' | 'processing'>;
  createDownloadUrl(input: { flightId: string; userId: string }): Promise<{ url: string; filename: string } | null>;
}

type StorageOptions = {
  s3Client: S3;
  bucketName: string;
  uploadQueue: Pick<FlightUploadQueueService, 'removeTerminalJobsForFlight'>;
  presign?: (command: GetObjectCommand) => Promise<string>;
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
): AdminFlightService {
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
      return gridClaim.reprocess({ flightId: input.flightId });
    },

    async deleteFlight(input) {
      const flight = await storedFlight(input);
      if (!flight) return 'already_deleted';
      if (flight.processingStatus === 'processing') return 'processing';
      if (!storage) throw new Error('Admin flight storage is not configured.');

      await storage.s3Client.send(new DeleteObjectCommand({ Bucket: storage.bucketName, Key: flight.bucketKey }));
      await storage.uploadQueue.removeTerminalJobsForFlight({
        userId: input.userId,
        flightId: input.flightId,
        igcFileId: flight.igcFileId,
        bucketKey: flight.bucketKey,
      });
      await database.delete(igcFiles).where(and(eq(igcFiles.id, flight.igcFileId), eq(igcFiles.userId, input.userId)));
      return 'deleted';
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
