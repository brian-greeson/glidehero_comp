import { DeleteObjectCommand, PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, igcFiles } from '../db/schema.js';
import {
  duplicateFlightMessage,
  type FlightProcessingOutcome,
  type FlightProcessingService,
} from './flightProcessingService.js';

export type IgcFileUpload = {
  ownerUserId: string;
  originalFilename: string;
  contentType: string;
  bytes: Buffer;
};

export interface IgcFileService {
  upload(input: IgcFileUpload): Promise<FlightProcessingOutcome>;
}

export function createIgcFileService(
  database: Database,
  options: { s3Client: Pick<S3, 'send'>; bucketName: string; keyFactory?: () => string },
  processor: FlightProcessingService,
): IgcFileService {
  const keyFactory = options.keyFactory ?? (() => `glidehero/${randomUUID()}.igc`);

  return {
    async upload(input) {
      const contentHash = createHash('sha256').update(input.bytes).digest('hex');
      const [existingFlight] = await database
        .select({ id: flights.id })
        .from(flights)
        .where(eq(flights.contentHash, contentHash))
        .limit(1);
      if (existingFlight) return { status: 'duplicate', message: duplicateFlightMessage };

      const bucketKey = keyFactory();
      await options.s3Client.send(
        new PutObjectCommand({
          Bucket: options.bucketName,
          Key: bucketKey,
          Body: input.bytes,
          ContentType: input.contentType,
        }),
      );

      let stored: { id: string; bucketKey: string } | undefined;
      try {
        [stored] = await database
          .insert(igcFiles)
          .values({
            userId: input.ownerUserId,
            originalFilename: input.originalFilename,
            contentType: input.contentType,
            byteSize: input.bytes.byteLength,
            bucketKey,
          })
          .returning({ id: igcFiles.id, bucketKey: igcFiles.bucketKey });
        if (!stored) throw new Error('IGC file insert returned no row.');
      } catch (error) {
        try {
          await options.s3Client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: bucketKey }));
        } catch (cleanupError) {
          console.error('Unable to delete orphaned IGC file', cleanupError);
        }
        throw error;
      }

      const outcome = await processor.process({
        ownerUserId: input.ownerUserId,
        igcFileId: stored.id,
        bucketKey: stored.bucketKey,
        contentHash,
        processingToken: randomUUID(),
      });
      if (outcome.status !== 'duplicate') return outcome;

      try {
        await database.delete(igcFiles).where(eq(igcFiles.id, stored.id));
      } catch (cleanupError) {
        console.error('Unable to delete duplicate IGC file metadata', cleanupError);
      }
      try {
        await options.s3Client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: stored.bucketKey }));
      } catch (cleanupError) {
        console.error('Unable to delete duplicate IGC file', cleanupError);
      }
      return outcome;
    },
  };
}
