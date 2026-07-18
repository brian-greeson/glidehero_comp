import { DeleteObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { igcFiles } from '../db/schema.js';
import type { FlightUploadQueueService } from './flightUploadQueueService.js';

export interface FailedFlightCleanupService {
  clearForUser(userId: string): Promise<number>;
}

export function createFailedFlightCleanupService(
  database: Database,
  queue: FlightUploadQueueService,
  options: { s3Client: Pick<S3, 'send'>; bucketName: string },
): FailedFlightCleanupService {
  return {
    async clearForUser(userId) {
      const failed = [];
      let page = 1;
      while (true) {
        const result = await queue.listJobs(userId, { page, pageSize: 100, status: 'failed' });
        failed.push(...result.jobs);
        if (failed.length >= result.total) break;
        page += 1;
      }
      const jobs = [];
      for (const item of failed) {
        const job = await queue.getJob(item.id);
        if (!job || job.userId !== userId) continue;
        jobs.push(job);
      }
      const clearedIds = new Set(await queue.clearJobs(userId, jobs.map((job) => job.id)));
      for (const job of jobs) {
        if (!clearedIds.has(job.id)) continue;
        let databaseCleared = false;
        let objectCleared = false;
        try {
          await database.delete(igcFiles).where(
            job.igcFileId ? eq(igcFiles.id, job.igcFileId) : eq(igcFiles.bucketKey, job.bucketKey),
          );
          databaseCleared = true;
        } catch (error) {
          console.error('Unable to delete failed flight database records', error);
        }
        try {
          await options.s3Client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: job.bucketKey }));
          objectCleared = true;
        } catch (error) {
          console.error('Unable to delete failed IGC object', error);
        }
        if (databaseCleared && objectCleared) await queue.finalizeFailedCleanup(job.id);
      }
      return clearedIds.size;
    },
  };
}
