import { hostname } from 'node:os';
import { Logger } from '@valkey/valkey-glide';
import { parseConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createBucketClient } from './resources/bucketClient.js';
import { createValkeyClient } from './resources/valkeyClient.js';
import { createFlightProcessingService } from './services/flightProcessingService.js';
import { createFlightUploadQueueService } from './services/flightUploadQueueService.js';
import { createFlightWorkerService } from './services/flightWorkerService.js';
import { runFlightWorkerRuntime } from './services/flightWorkerRuntime.js';
import { createFlightThumbnailService } from './services/flightThumbnailService.js';
import { createFlightThumbnailLifecycleService } from './services/flightThumbnailLifecycleService.js';
import { createUserAchievementProgressService } from './services/userAchievementProgressService.js';
import { createWorkerControlService } from './services/workerControlService.js';
import { createFlightProcessingControlService } from './services/flightProcessingControlService.js';
import { createFlightUploadWorkflowService } from './services/flightUploadWorkflowService.js';
import { createUserHistoryRebuildService } from './services/userHistoryRebuildService.js';

// Blocking stream reads legitimately take several seconds. Keep GLIDE's native
// slow-response diagnostics from reporting those successful reads as warnings;
// command failures are still logged by the worker's error handling.
Logger.init('error');

const config = parseConfig(process.env);
const { db, pool } = createDatabase(config.databaseUrl);
const s3Client = createBucketClient(config);
const thumbnails = createFlightThumbnailService({
  mapTilerCredentials: config.mapTilerCredentials,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
  cellSize: config.gridClaimCellSize,
  s3Client,
});
const thumbnailLifecycle = createFlightThumbnailLifecycleService(db, thumbnails, {
  cellSize: config.gridClaimCellSize,
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
});
const valkey = await createValkeyClient(config.valkeyUrl);
const streamReader = await createValkeyClient(config.valkeyUrl, { requestTimeout: 10_000 });
const workerControl = createWorkerControlService(valkey);
const flightProcessingControl = createFlightProcessingControlService(valkey);
const uploadWorkflow = createFlightUploadWorkflowService(db);
const queue = createFlightUploadQueueService(valkey, {
  s3Client,
  bucketName: config.bucket.bucketName,
  bucketFolder: config.bucket.bucketFolder,
  database: db,
  workflowService: uploadWorkflow,
});
const userAchievementProgress = createUserAchievementProgressService(db, { cellSize: config.gridClaimCellSize });
const processor = createFlightProcessingService(db, {
  s3Client,
  bucketName: config.bucket.bucketName,
  gridClaimCellSize: config.gridClaimCellSize,
  userAchievementProgress,
  isNPointSolverEnabled: () => flightProcessingControl.isNPointSolverEnabled(),
});
const historyRebuild = createUserHistoryRebuildService(db, {
  cellSize: config.gridClaimCellSize,
});
const worker = createFlightWorkerService(db, valkey, queue, processor, {
  s3Client,
  bucketName: config.bucket.bucketName,
  consumerName: `${hostname()}-${process.pid}`,
  streamReader,
  thumbnailLifecycle,
  workerControl,
  uploadWorkflow,
  historyRebuild,
});
console.log('GlideHero flight worker started.');
const outcome = await runFlightWorkerRuntime({ worker, valkey, streamReader, pool });
if (outcome === 'deadline-exceeded') {
  console.error('Flight worker shutdown deadline exceeded; leaving the pending claim for stale-job recovery.');
  process.exit(1);
}
