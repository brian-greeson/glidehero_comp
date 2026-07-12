import { S3 } from '@aws-sdk/client-s3';
import { config } from '../config.js';

const s3Client = new S3({
  forcePathStyle: false, // Configures to use subdomain/virtual calling format.
  endpoint: 'https://nyc3.digitaloceanspaces.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: config.bucket.bucketId,
    secretAccessKey: config.bucket.bucketSecret,
  },
});

export { s3Client };
