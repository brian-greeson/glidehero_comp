import { S3 } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config.js';

export function createBucketClient(config: AppConfig) {
  return new S3({
    forcePathStyle: false,
    endpoint: config.bucket.bucketURL,
    region: 'us-east-1',
    credentials: {
      accessKeyId: config.bucket.bucketId,
      secretAccessKey: config.bucket.bucketSecret,
    },
  });
}
