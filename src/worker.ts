import { hostname } from 'node:os';
import { parseConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createBucketClient } from './resources/bucketClient.js';
import { createValkeyClient } from './resources/valkeyClient.js';
import { createFlightProcessingService } from './services/flightProcessingService.js';
import { createFlightUploadQueueService } from './services/flightUploadQueueService.js';
import { createFlightWorkerService } from './services/flightWorkerService.js';
import { runFlightWorkerRuntime } from './services/flightWorkerRuntime.js';

const config = parseConfig(process.env);
const { db, pool } = createDatabase(config.databaseUrl);
const s3Client = createBucketClient(config);
const valkey = await createValkeyClient(config.valkeyUrl);
const queue = createFlightUploadQueueService(valkey, { s3Client, bucketName: config.bucket.bucketName });
const processor = createFlightProcessingService(db, {
  s3Client,
  bucketName: config.bucket.bucketName,
  gridClaimCellSize: config.gridClaimCellSize,
});
const worker = createFlightWorkerService(db, valkey, queue, processor, {
  s3Client,
  bucketName: config.bucket.bucketName,
  consumerName: `${hostname()}-${process.pid}`,
});
console.log('GlideHero flight worker started.');
const outcome = await runFlightWorkerRuntime({ worker, valkey, pool });
if (outcome === 'deadline-exceeded') {
  console.error('Flight worker shutdown deadline exceeded; leaving the pending claim for stale-job recovery.');
  process.exit(1);
}
