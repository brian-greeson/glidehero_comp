import { DeleteObjectCommand, PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { Database } from '../db/client.js';
import { igcFiles } from '../db/schema.js';

export type IgcFileUpload = {
  ownerUserId: string;
  originalFilename: string;
  contentType: string;
  bytes: Buffer;
};

export type StoredIgcFile = { id: string; bucketKey: string };

export interface IgcFileService {
  upload(input: IgcFileUpload): Promise<StoredIgcFile>;
}

export function createIgcFileService(
  database: Database,
  options: { s3Client: Pick<S3, 'send'>; bucketName: string; keyFactory?: () => string },
): IgcFileService {
  const keyFactory = options.keyFactory ?? (() => `glidehero/${randomUUID()}.igc`);

  return {
    async upload(input) {
      const bucketKey = keyFactory();
      await options.s3Client.send(
        new PutObjectCommand({
          Bucket: options.bucketName,
          Key: bucketKey,
          Body: input.bytes,
          ContentType: input.contentType,
        }),
      );

      try {
        const [stored] = await database
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
        return stored;
      } catch (error) {
        try {
          await options.s3Client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: bucketKey }));
        } catch (cleanupError) {
          console.error('Unable to delete orphaned IGC file', cleanupError);
        }
        throw error;
      }
    },
  };
}
