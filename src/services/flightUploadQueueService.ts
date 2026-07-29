import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Batch, InfBoundary, Script, type GlideClient } from '@valkey/valkey-glide';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppError } from '../domain/errors.js';
import { createHash } from 'node:crypto';
import { parseIgcFlight } from '../domain/igc/parseIgcFlight.js';
import { regularFlightUploadWindow } from '../domain/igc/flightUploadWindow.js';
import { resolveLaunchTimeZone } from '../domain/competition/launchTimeZone.js';
import {
  bulkImportMembers,
  bulkImports,
  flights,
  igcFiles,
  regularUploadBatches,
  regularUploadMembers,
} from '../db/schema.js';
import type { Database } from '../db/client.js';
import type { FlightUploadWorkflowService } from './flightUploadWorkflowService.js';

export const FLIGHT_JOB_STREAM = 'glidehero:flight-jobs';
export const FLIGHT_JOB_GROUP = 'flight-workers';
export const MAX_ACTIVE_UPLOADS = 1_000;
export const MAX_IGC_FILE_BYTES = 10 * 1024 * 1024;
export const ABANDONED_UPLOAD_MS = 24 * 60 * 60 * 1_000;
export const JOB_DISPOSITION_TTL_SECONDS = 24 * 60 * 60;
export const MAINTENANCE_BATCH_SIZE = 100;
const QUEUE_SUMMARY_BATCH_SIZE = 500;

export type UploadJobStatus = 'uploading' | 'queued' | 'processing' | 'completed' | 'duplicate' | 'failed';
const uploadJobStatuses: UploadJobStatus[] = ['uploading', 'queued', 'processing', 'completed', 'duplicate', 'failed'];

export type UploadJob = {
  id: string;
  userId: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  bucketKey: string;
  status: UploadJobStatus;
  createdAt: number;
  updatedAt: number;
  streamId?: string;
  igcFileId?: string;
  flightId?: string;
  error?: string;
  heartbeatAt?: number;
  processingToken?: string;
  batchId?: string;
  historyImportId?: string;
  workflowMemberId?: string;
  contentHash?: string;
  activatedAt?: number;
};

export type UploadProgress = {
  total: number;
  finished: number;
  completed: number;
  completedIds: string[];
  queued: number;
  processing: number;
  failed: number;
};

export type UploadJobPage = {
  total: number;
  page: number;
  pageSize: number;
  jobs: Array<Pick<UploadJob, 'id' | 'originalFilename' | 'status' | 'error'>>;
};

export function flightUploadPrefix(bucketFolder: string, userId: string): string {
  return `${bucketFolder}/uploads/${userId}/`;
}

const jobKey = (id: string) => `glidehero:upload:${id}`;
const userJobsKey = (userId: string) => `glidehero:user:${userId}:uploads`;
const userJobsByStatusKey = (userId: string, status: UploadJobStatus) => `glidehero:user:${userId}:uploads:${status}`;
const uploadExpiryKey = 'glidehero:upload-expiry';
const removalPendingKey = 'glidehero:upload-removals';
const removalKey = (id: string) => `glidehero:upload-removal:${id}`;
const dispositionKey = (id: string) => `glidehero:upload-disposition:${id}`;
const failedCleanupKey = (id: string) => `glidehero:failed-upload-cleanup:${id}`;
const failedCleanupPendingKey = 'glidehero:failed-upload-cleanups';
const clearedJobEvidenceKey = 'glidehero:cleared-upload-evidence';
const allJobsKey = 'glidehero:uploads';
const admitUploadScript = new Script(`
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return 0 end
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
redis.call('SET', KEYS[1], ARGV[4])
redis.call('ZADD', KEYS[2], tonumber(ARGV[2]), ARGV[1])
redis.call('ZADD', KEYS[3], tonumber(ARGV[2]), ARGV[1])
redis.call('ZADD', KEYS[4], tonumber(ARGV[2]), ARGV[1])
redis.call('ZADD', KEYS[5], tonumber(ARGV[3]), ARGV[1])
return 1
`);
const completeUploadScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local ok, job = pcall(cjson.decode, raw)
if not ok then return 'invalid' end
if job.userId ~= ARGV[2] then return 'forbidden' end
if job.status ~= 'uploading' then return 'unchanged' end
job.status = 'queued'
job.updatedAt = tonumber(ARGV[3])
if ARGV[5] ~= '' then job.flightId = ARGV[5] end
if ARGV[6] ~= '' then job.contentHash = ARGV[6] end
if ARGV[7] ~= '' then job.workflowMemberId = ARGV[7] end
redis.call('SET', KEYS[1], cjson.encode(job))
for index = 5, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
redis.call('ZADD', KEYS[4], job.createdAt, ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
if ARGV[4] ~= 'staged' then redis.call('XADD', KEYS[2], '*', 'jobId', ARGV[1]) end
return 'queued'
`);
const activateUploadScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local ok, job = pcall(cjson.decode, raw)
if not ok or job.status ~= 'queued' or job.activatedAt then return 'unchanged' end
job.activatedAt = tonumber(ARGV[2]); job.workflowMemberId = ARGV[3]; job.updatedAt = tonumber(ARGV[2])
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('XADD', KEYS[2], '*', 'jobId', ARGV[1]); return 'activated'
`);
const claimQueuedJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local ok, job = pcall(cjson.decode, raw)
if not ok or job.status ~= 'queued' then return false end
job.status = 'processing'
job.heartbeatAt = tonumber(ARGV[2])
job.updatedAt = tonumber(ARGV[2])
job.processingToken = ARGV[3]
local updated = cjson.encode(job)
redis.call('SET', KEYS[1], updated)
for index = 3, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
redis.call('ZADD', KEYS[2], job.createdAt, ARGV[1])
return updated
`);
const saveClaimedJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local currentOk, current = pcall(cjson.decode, raw)
local updatedOk, updated = pcall(cjson.decode, ARGV[3])
if not currentOk or not updatedOk then return 0 end
if current.status ~= 'processing' or current.processingToken ~= ARGV[2] then return 0 end
if updated.id ~= current.id or updated.userId ~= current.userId or updated.processingToken ~= ARGV[2] then return 0 end
if updated.status ~= 'processing' and updated.status ~= 'completed' and updated.status ~= 'duplicate' and updated.status ~= 'failed' then return 0 end
redis.call('SET', KEYS[1], ARGV[3])
for index = 3, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
redis.call('ZADD', KEYS[2], updated.createdAt, ARGV[1])
return 1
`);
const failStaleJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local currentOk, current = pcall(cjson.decode, raw)
local updatedOk, updated = pcall(cjson.decode, ARGV[4])
if not currentOk or not updatedOk then return 0 end
if current.status ~= 'processing' or current.processingToken ~= ARGV[2] then return 0 end
if current.heartbeatAt and current.heartbeatAt > tonumber(ARGV[3]) then return 0 end
if updated.status ~= 'failed' or updated.id ~= current.id or updated.userId ~= current.userId or updated.processingToken ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[4])
for index = 3, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
redis.call('ZADD', KEYS[2], updated.createdAt, ARGV[1])
return 1
`);
const reconcileTerminalJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local currentOk, current = pcall(cjson.decode, raw)
local updatedOk, updated = pcall(cjson.decode, ARGV[3])
if not currentOk or not updatedOk then return 0 end
if current.processingToken ~= ARGV[2] or updated.processingToken ~= ARGV[2] then return 0 end
if current.status ~= 'processing' and current.status ~= 'failed' and current.status ~= 'completed' then return 0 end
if updated.status ~= 'failed' and updated.status ~= 'completed' then return 0 end
redis.call('SET', KEYS[1], ARGV[3])
for index = 3, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
redis.call('ZADD', KEYS[2], updated.createdAt, ARGV[1])
return 1
`);
const removeUploadingJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local ok, job = pcall(cjson.decode, raw)
if not ok or job.userId ~= ARGV[2] or job.status ~= 'uploading' then return false end
redis.call('DEL', KEYS[1])
for index = 2, 4 do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
for index = 7, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
redis.call('SET', KEYS[5], raw)
redis.call('ZADD', KEYS[6], tonumber(ARGV[3]), ARGV[1])
return raw
`);
const retireSuccessfulJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, job = pcall(cjson.decode, raw)
if not ok or job.status ~= ARGV[2] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], 'retired', 'EX', tonumber(ARGV[3]))
for index = 3, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
return 1
`);
const clearFailedJobScript = new Script(`
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local ok, job = pcall(cjson.decode, raw)
if not ok or job.userId ~= ARGV[2] or job.status ~= 'failed' then return false end
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[2], 'cleared', 'EX', tonumber(ARGV[3]))
redis.call('SET', KEYS[3], raw)
redis.call('ZADD', KEYS[4], tonumber(ARGV[4]), ARGV[1])
redis.call('ZADD', KEYS[5], tonumber(ARGV[4]) + (tonumber(ARGV[3]) * 1000), ARGV[1])
for index = 6, #KEYS do
  redis.call('ZREM', KEYS[index], ARGV[1])
end
return raw
`);

function decode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return Buffer.isBuffer(value) ? value.toString() : String(value);
}

export function isIgcFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.igc');
}

export interface FlightUploadQueueService {
  createIntent(input: { userId: string; originalFilename: string; contentType: string; byteSize: number; batchId?: string; historyImportId?: string }): Promise<{ id: string; uploadUrl: string }>;
  complete(input: { userId: string; id: string }): Promise<void>;
  activateJob(id: string, workflowMemberId: string): Promise<boolean>;
  cancel(input: { userId: string; id: string }): Promise<boolean>;
  getJob(id: string): Promise<UploadJob | null>;
  claimJob(id: string): Promise<UploadJob | null>;
  saveClaimedJob(job: UploadJob): Promise<boolean>;
  failStaleJob(job: UploadJob, cutoff: number): Promise<boolean>;
  reconcileTerminalJob(job: UploadJob): Promise<boolean>;
  saveJob(job: UploadJob): Promise<void>;
  progress(userId: string): Promise<UploadProgress>;
  listJobs(userId: string, options: { page: number; pageSize: number; status?: UploadJobStatus }): Promise<UploadJobPage>;
  clearJobs(userId: string, ids: string[]): Promise<string[]>;
  getDisposition(id: string): Promise<'retired' | 'cleared' | null>;
  getClearedJob(id: string): Promise<UploadJob | null>;
  ownsClaim(job: UploadJob): Promise<boolean>;
  pendingFailedCleanups(): Promise<UploadJob[]>;
  retainedClearedJobs(): Promise<UploadJob[]>;
  finalizeFailedCleanup(id: string): Promise<void>;
  allJobIds(): Promise<string[]>;
  queueSummary(): Promise<{ queued: number; processing: number; failed: number; oldestQueuedAgeSeconds: number | null }>;
  expiredIntentIds(now?: number): Promise<string[]>;
  pruneExpiredIntent(id: string): Promise<void>;
  removeIntent(job: UploadJob): Promise<boolean>;
  pendingRemovals(): Promise<UploadJob[]>;
  finalizeRemoval(id: string): Promise<void>;
  activeJobCountForUser(userId: string): Promise<number>;
  removeTerminalJobsForUser(userId: string): Promise<void>;
  removeTerminalJobsForFlight(input: { userId: string; flightId: string; igcFileId: string; bucketKey: string }): Promise<void>;
}

export function createFlightUploadQueueService(
  valkey: GlideClient,
  options: {
    s3Client: S3;
    bucketName: string;
    bucketFolder: string;
    keyFactory?: (userId: string) => string;
    presign?: (command: PutObjectCommand) => Promise<string>;
    database?: Database;
    workflowService?: FlightUploadWorkflowService;
    now?: () => Date;
  },
): FlightUploadQueueService {
  const keyFactory = options.keyFactory
    ?? ((userId) => `${flightUploadPrefix(options.bucketFolder, userId)}${randomUUID()}.igc`);

  async function markQueuedFailure(job: UploadJob, error: string): Promise<void> {
    job.status = 'failed'; job.error = error; job.updatedAt = Date.now();
    await saveJob(job);
  }
  async function markQueuedDuplicate(job: UploadJob): Promise<void> {
    job.status = 'duplicate'; job.error = 'Duplicate flight.'; job.updatedAt = Date.now();
    const raw = JSON.stringify(job);
    const transaction = new Batch(true)
      .set(jobKey(job.id), raw)
      .zadd(userJobsKey(job.userId), { [job.id]: job.createdAt })
      .zadd(allJobsKey, { [job.id]: job.createdAt })
      .set(removalKey(job.id), raw)
      .zadd(removalPendingKey, { [job.id]: Date.now() });
    removeAllStatusIndexes(transaction, job.userId, [job.id]);
    transaction.zadd(userJobsByStatusKey(job.userId, 'duplicate'), { [job.id]: job.createdAt });
    await execAtomic(transaction, 'Unable to atomically record duplicate flight cleanup.');
    try {
      await options.s3Client.send(new DeleteObjectCommand({
        Bucket: options.bucketName,
        Key: job.bucketKey,
      }));
      await finalizeRemoval(job.id);
    } catch (error) {
      console.error('Unable to delete duplicate IGC object', error);
    }
  }

  async function getJob(id: string): Promise<UploadJob | null> {
    const raw = decode(await valkey.get(jobKey(id)));
    return raw ? JSON.parse(raw) as UploadJob : null;
  }

  function parseIndexedJob(raw: unknown): UploadJob | null {
    const value = decode(raw);
    if (!value) return null;
    try {
      const job = JSON.parse(value) as Partial<UploadJob>;
      return job && typeof job === 'object'
        && typeof job.id === 'string'
        && typeof job.userId === 'string'
        && typeof job.bucketKey === 'string'
        && uploadJobStatuses.includes(job.status as UploadJobStatus)
        ? job as UploadJob
        : null;
    } catch {
      return null;
    }
  }

  async function readMaintenanceJobs(indexKey: string, recordKey: (id: string) => string): Promise<UploadJob[]> {
    const ids = (await valkey.zrange(indexKey, { start: 0, end: MAINTENANCE_BATCH_SIZE - 1 })).map(String);
    const jobs = (await Promise.all(ids.map((id) => valkey.get(recordKey(id))))).map(parseIndexedJob);
    const invalidIds = ids.filter((_, index) => !jobs[index]);
    if (invalidIds.length) await valkey.zrem(indexKey, invalidIds);
    const validIds = ids.filter((_, index) => Boolean(jobs[index]));
    // Move attempted work behind untouched entries. A persistent DB/S3 failure
    // can therefore never occupy the first page forever.
    if (validIds.length) {
      await valkey.zadd(indexKey, Object.fromEntries(validIds.map((id) => [id, Date.now() + 60_000])));
    }
    return jobs.filter((job): job is UploadJob => Boolean(job));
  }

  async function execAtomic(transaction: Batch, failureMessage: string): Promise<void> {
    if (await valkey.exec(transaction, true) === null) throw new Error(failureMessage);
  }

  function removeAllStatusIndexes(transaction: Batch, userId: string, ids: string[]): Batch {
    for (const status of uploadJobStatuses) transaction.zrem(userJobsByStatusKey(userId, status), ids);
    return transaction;
  }

  async function saveJob(job: UploadJob): Promise<void> {
    const transaction = new Batch(true)
      .set(jobKey(job.id), JSON.stringify(job))
      .zadd(userJobsKey(job.userId), { [job.id]: job.createdAt })
      .zadd(allJobsKey, { [job.id]: job.createdAt });
    removeAllStatusIndexes(transaction, job.userId, [job.id]);
    transaction.zadd(userJobsByStatusKey(job.userId, job.status), { [job.id]: job.createdAt });
    await execAtomic(transaction, 'Unable to atomically save flight upload status.');
  }

  async function reconstructWorkflowJob(id: string, workflowMemberId: string): Promise<UploadJob | null> {
    if (!options.database) return null;
    const result = await options.database.execute(sql`
      SELECT m.user_id AS "userId", m.batch_id AS "batchId", NULL::uuid AS "historyImportId",
        f.flight_id AS "flightId", f.content_hash AS "contentHash",
        i.original_filename AS "originalFilename", i.content_type AS "contentType",
        i.byte_size AS "byteSize", i.bucket_key AS "bucketKey",
        extract(epoch FROM m.created_at) * 1000 AS "createdAt"
      FROM regular_upload_members m
      JOIN flights f ON f.flight_id = m.flight_id
      JOIN igc_files i ON i.igc_file_id = f.igc_file_id
      WHERE m.id = ${workflowMemberId} AND m.upload_job_id = ${id}
      UNION ALL
      SELECT m.user_id AS "userId", NULL::uuid AS "batchId", m.import_id AS "historyImportId",
        f.flight_id AS "flightId", f.content_hash AS "contentHash",
        i.original_filename AS "originalFilename", i.content_type AS "contentType",
        i.byte_size AS "byteSize", i.bucket_key AS "bucketKey",
        extract(epoch FROM m.created_at) * 1000 AS "createdAt"
      FROM bulk_import_members m
      JOIN flights f ON f.flight_id = m.flight_id
      JOIN igc_files i ON i.igc_file_id = f.igc_file_id
      WHERE m.id = ${workflowMemberId} AND m.upload_job_id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as {
      userId: string; batchId: string | null; historyImportId: string | null;
      flightId: string; contentHash: string; originalFilename: string;
      contentType: string; byteSize: number; bucketKey: string; createdAt: number | string;
    } | undefined;
    if (!row) return null;
    const now = Date.now();
    return {
      id,
      userId: row.userId,
      originalFilename: row.originalFilename,
      contentType: row.contentType,
      byteSize: Number(row.byteSize),
      bucketKey: row.bucketKey,
      status: 'queued',
      createdAt: Number(row.createdAt),
      updatedAt: now,
      flightId: row.flightId,
      contentHash: row.contentHash,
      workflowMemberId,
      ...(row.batchId ? { batchId: row.batchId } : {}),
      ...(row.historyImportId ? { historyImportId: row.historyImportId } : {}),
    };
  }

  async function readProgress(userId: string): Promise<UploadProgress> {
    const [total, queued, processing, completed, completedIds, duplicate, failed] = await Promise.all([
      valkey.zcard(userJobsKey(userId)),
      valkey.zcard(userJobsByStatusKey(userId, 'queued')),
      valkey.zcard(userJobsByStatusKey(userId, 'processing')),
      valkey.zcard(userJobsByStatusKey(userId, 'completed')),
      valkey.zrange(userJobsByStatusKey(userId, 'completed'), { start: 0, end: -1 }),
      valkey.zcard(userJobsByStatusKey(userId, 'duplicate')),
      valkey.zcard(userJobsByStatusKey(userId, 'failed')),
    ]);
    return {
      total,
      finished: completed + duplicate + failed,
      completed,
      completedIds: completedIds.map(String),
      queued,
      processing,
      failed,
    };
  }

  async function retireSuccessfulJob(userId: string, id: string, expectedStatus: 'completed' | 'duplicate'): Promise<boolean> {
    const result = await valkey.invokeScript(retireSuccessfulJobScript, {
      keys: [
        jobKey(id), dispositionKey(id), userJobsKey(userId), allJobsKey, uploadExpiryKey,
        ...uploadJobStatuses.map((status) => userJobsByStatusKey(userId, status)),
      ],
      args: [id, expectedStatus, String(JOB_DISPOSITION_TTL_SECONDS)],
    });
    return Number(decode(result) ?? result) === 1;
  }

  async function removeUploadingJob(job: UploadJob): Promise<boolean> {
    const result = decode(await valkey.invokeScript(removeUploadingJobScript, {
      keys: [
        jobKey(job.id), userJobsKey(job.userId), allJobsKey, uploadExpiryKey, removalKey(job.id), removalPendingKey,
        ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
      ],
      args: [job.id, job.userId, String(Date.now())],
    }));
    return Boolean(result);
  }

  async function finalizeRemoval(id: string): Promise<void> {
    await execAtomic(new Batch(true).del([removalKey(id)]).zrem(removalPendingKey, [id]), 'Unable to finalize upload object removal.');
  }

  async function jobsForUser(userId: string): Promise<UploadJob[]> {
    const userIndexKeys = [userJobsKey(userId), ...uploadJobStatuses.map((status) => userJobsByStatusKey(userId, status))];
    const indexedIds = await Promise.all(
      [allJobsKey, ...userIndexKeys].map((key) => valkey.zrange(key, { start: 0, end: -1 })),
    );
    const ids = [...new Set(indexedIds.flat().map(String))];
    const jobs: UploadJob[] = [];
    for (const id of ids) {
      let job: UploadJob | null = null;
      try {
        job = await getJob(id);
      } catch {
        // A malformed record cannot be attributed safely; prune its indexes so it
        // does not prevent repair-oriented admin cleanup.
      }
      if (job?.userId === userId) jobs.push(job);
      if (!job) {
        await valkey.zrem(allJobsKey, [id]);
        for (const key of userIndexKeys) await valkey.zrem(key, [id]);
      } else if (job.userId !== userId) {
        for (const key of userIndexKeys) await valkey.zrem(key, [id]);
      }
    }
    return jobs;
  }

  async function removeTerminalJobs(jobs: UploadJob[]): Promise<void> {
    for (const job of jobs) {
      if (job.status === 'completed' || job.status === 'duplicate') {
        await retireSuccessfulJob(job.userId, job.id, job.status);
        continue;
      }
      if (job.status !== 'failed') continue;
      await valkey.invokeScript(clearFailedJobScript, {
        keys: [
          jobKey(job.id), dispositionKey(job.id), failedCleanupKey(job.id), failedCleanupPendingKey,
          clearedJobEvidenceKey, userJobsKey(job.userId), allJobsKey, uploadExpiryKey,
          ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
        ],
        args: [job.id, job.userId, String(JOB_DISPOSITION_TTL_SECONDS), String(Date.now())],
      });
    }
  }

  return {
    async createIntent(input) {
      if (!isIgcFilename(input.originalFilename)) throw new AppError(422, 'invalid_request', 'Choose an IGC file with a .igc filename.');
      if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_IGC_FILE_BYTES) {
        throw new AppError(422, 'invalid_request', 'IGC files must be 10 MB or smaller.');
      }
      if (input.batchId && input.historyImportId) throw new AppError(422, 'invalid_request', 'Upload workflow metadata is mutually exclusive.');
      const now = Date.now();
      const job: UploadJob = {
        id: randomUUID(), userId: input.userId, originalFilename: input.originalFilename,
        contentType: input.contentType || 'application/octet-stream', byteSize: input.byteSize,
        bucketKey: keyFactory(input.userId), status: 'uploading', createdAt: now, updatedAt: now,
        batchId: input.batchId, historyImportId: input.historyImportId,
      };
      const uploadUrl = await (options.presign ?? ((command) => getSignedUrl(options.s3Client, command, { expiresIn: 15 * 60 })))(new PutObjectCommand({
        Bucket: options.bucketName, Key: job.bucketKey, ContentType: job.contentType, ContentLength: job.byteSize,
      }));
      const admitted = Number(decode(await valkey.invokeScript(admitUploadScript, {
        keys: [jobKey(job.id), userJobsKey(input.userId), userJobsByStatusKey(input.userId, job.status), allJobsKey, uploadExpiryKey],
        args: [job.id, String(now), String(now + ABANDONED_UPLOAD_MS), JSON.stringify(job), String(MAX_ACTIVE_UPLOADS)],
      })));
      if (admitted === 0) throw new AppError(409, 'conflict', 'You already have 1,000 active flight uploads.');
      if (admitted !== 1) throw new Error('Unable to atomically create flight upload.');

      return { id: job.id, uploadUrl };
    },

    async complete(input) {
      const job = await getJob(input.id);
      if (!job || job.userId !== input.userId) throw new AppError(404, 'invalid_request', 'Upload not found.');
      if (job.status !== 'uploading') return;
      const object = await options.s3Client.send(new HeadObjectCommand({ Bucket: options.bucketName, Key: job.bucketKey }));
      if (object.ContentLength !== job.byteSize || job.byteSize > MAX_IGC_FILE_BYTES) {
        throw new AppError(422, 'invalid_request', 'Uploaded file size did not match the selected file.');
      }
      const workflow = options.workflowService && options.database && (job.batchId || job.historyImportId);
      const database = options.database;
      const workflowService = options.workflowService;
      let prepared: { flightId: string; memberId: string; contentHash: string } | undefined;
      if (workflow) {
        const response = await options.s3Client.send(new GetObjectCommand({ Bucket: options.bucketName, Key: job.bucketKey }));
        const bytes = response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
        const source = Buffer.from(bytes).toString('utf8');
        try {
          const parsed = parseIgcFlight(source);
          const contentHash = createHash('sha256').update(bytes).digest('hex');
          const launchTimezone = resolveLaunchTimeZone({ latitude: parsed.launchLatitude, longitude: parsed.launchLongitude });
          if (job.batchId) {
            const window = regularFlightUploadWindow(parsed.startedAt, launchTimezone, options.now?.() ?? new Date());
            if (!window.accepted) {
              await markQueuedFailure(job, window.reason === 'too_old' ? 'Flight is older than 30 days.' : 'Flight starts in the future.');
              return;
            }
          }
          const [previousPreparation] = await database!
            .select({ flightId: flights.id, contentHash: flights.contentHash })
            .from(igcFiles)
            .innerJoin(flights, eq(flights.igcFileId, igcFiles.id))
            .where(eq(igcFiles.bucketKey, job.bucketKey))
            .limit(1);
          if (previousPreparation) {
            const [member] = job.batchId
              ? await database!.select({ id: regularUploadMembers.id })
                .from(regularUploadMembers)
                .where(eq(regularUploadMembers.uploadJobId, job.id))
                .limit(1)
              : await database!.select({ id: bulkImportMembers.id })
                .from(bulkImportMembers)
                .where(eq(bulkImportMembers.uploadJobId, job.id))
                .limit(1);
            if (!member) throw new Error('Prepared flight is missing its upload workflow member.');
            prepared = { flightId: previousPreparation.flightId, memberId: member.id, contentHash: previousPreparation.contentHash };
            job.flightId = previousPreparation.flightId;
            job.contentHash = previousPreparation.contentHash;
            job.workflowMemberId = member.id;
          } else {
            const existing = await database!
              .select({ id: flights.id })
              .from(flights)
              .where(eq(flights.contentHash, contentHash))
              .limit(1);
            if (existing[0]) {
              // A content hash is globally unique, but the existing flight can
              // belong to another pilot. A duplicate is terminal upload state;
              // it must never reference the existing flight or join this
              // pilot's workflow.
              job.contentHash = contentHash;
              await markQueuedDuplicate(job);
              return;
            }
            const row = await database!.transaction(async (tx) => {
            if (job.batchId) {
              const [batch] = await tx.select({ id: regularUploadBatches.id })
                .from(regularUploadBatches)
                .where(and(
                  eq(regularUploadBatches.id, job.batchId),
                  eq(regularUploadBatches.userId, job.userId),
                  eq(regularUploadBatches.status, 'open'),
                ))
                .for('update');
              if (!batch) throw new Error('Regular upload batch is not open.');
            } else if (job.historyImportId) {
              const [historyImport] = await tx.select({ id: bulkImports.id })
                .from(bulkImports)
                .where(and(
                  eq(bulkImports.id, job.historyImportId),
                  eq(bulkImports.userId, job.userId),
                  eq(bulkImports.phase, 'preparing'),
                ))
                .for('update');
              if (!historyImport) throw new Error('Bulk import is not accepting files.');
            }
            const [file] = await tx.insert(igcFiles).values({ userId: job.userId, originalFilename: job.originalFilename, contentType: job.contentType, byteSize: job.byteSize, bucketKey: job.bucketKey }).returning({ id: igcFiles.id });
            if (!file) throw new Error('Unable to create IGC file');
            const [flight] = await tx.insert(flights).values({ userId: job.userId, igcFileId: file.id, contentHash, processingStatus: 'pending', startedAt: parsed.startedAt, endedAt: parsed.endedAt, durationSeconds: Math.round(parsed.durationSeconds), distanceMeters: parsed.distanceMeters, launchLatitude: parsed.launchLatitude, launchLongitude: parsed.launchLongitude, launchTimezone }).returning({ id: flights.id });
            if (!flight) throw new Error('Unable to create flight');
            const [member] = job.batchId
              ? await tx.insert(regularUploadMembers).values({
                  batchId: job.batchId,
                  userId: job.userId,
                  flightId: flight.id,
                  uploadJobId: job.id,
                  startedAt: parsed.startedAt,
                }).returning({ id: regularUploadMembers.id })
              : await tx.insert(bulkImportMembers).values({
                  importId: job.historyImportId!,
                  userId: job.userId,
                  flightId: flight.id,
                  uploadJobId: job.id,
                  startedAt: parsed.startedAt,
                }).returning({ id: bulkImportMembers.id });
            if (!member) throw new Error('Unable to add flight to upload workflow.');
            return { flightId: flight.id, memberId: member.id };
            });
            prepared = { flightId: row.flightId, memberId: row.memberId, contentHash };
            job.flightId = row.flightId; job.contentHash = contentHash; job.workflowMemberId = row.memberId;
          }
        } catch (error) {
          await markQueuedFailure(job, error instanceof Error ? error.message : 'Invalid IGC file.'); return;
        }
      }
      const result = decode(await valkey.invokeScript(completeUploadScript, {
        keys: [
          jobKey(job.id), FLIGHT_JOB_STREAM, uploadExpiryKey, userJobsByStatusKey(job.userId, 'queued'),
          ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
        ],
        args: [
          job.id,
          input.userId,
          String(Date.now()),
          workflow ? 'staged' : 'stream',
          prepared?.flightId ?? '',
          prepared?.contentHash ?? '',
          prepared?.memberId ?? '',
        ],
      }));
      if (result === 'missing' || result === 'forbidden') throw new AppError(404, 'invalid_request', 'Upload not found.');
      if (result === 'invalid') throw new Error('Unable to decode flight upload state.');
    },

    async activateJob(id, workflowMemberId) {
      let job = await getJob(id);
      if (!job || job.status === 'uploading') {
        const restored = await reconstructWorkflowJob(id, workflowMemberId);
        if (!restored) return false;
        job = restored;
        await saveJob(job);
      }
      const result = decode(await valkey.invokeScript(activateUploadScript, { keys: [jobKey(id), FLIGHT_JOB_STREAM], args: [id, String(Date.now()), workflowMemberId] }));
      if (result === 'activated') return true;
      const current = await getJob(id);
      return Boolean(current?.activatedAt);
    },

    async cancel(input) {
      const job = await getJob(input.id);
      if (!job || job.userId !== input.userId || job.status !== 'uploading') return false;
      if (options.database) {
        const prepared = await options.database.execute(sql`
          SELECT EXISTS (
            SELECT 1 FROM regular_upload_members WHERE upload_job_id = ${job.id}
            UNION ALL
            SELECT 1 FROM bulk_import_members WHERE upload_job_id = ${job.id}
          ) AS value
        `);
        if (prepared.rows[0]?.value) return false;
      }
      if (!await removeUploadingJob(job)) return false;
      try {
        await options.s3Client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: job.bucketKey }));
        await finalizeRemoval(job.id);
      } catch (error) {
        console.error('Unable to delete cancelled IGC object', error);
      }
      return true;
    },

    getJob,
    async claimJob(id) {
      const job = await getJob(id);
      if (!job) return null;
      const now = Date.now();
      const result = decode(await valkey.invokeScript(claimQueuedJobScript, {
        keys: [
          jobKey(id), userJobsByStatusKey(job.userId, 'processing'),
          ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
        ],
        args: [id, String(now), randomUUID()],
      }));
      return result ? JSON.parse(result) as UploadJob : null;
    },
    async saveClaimedJob(job) {
      if (!job.processingToken) return false;
      const result = await valkey.invokeScript(saveClaimedJobScript, {
        keys: [
          jobKey(job.id), userJobsByStatusKey(job.userId, job.status),
          ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
        ],
        args: [job.id, job.processingToken, JSON.stringify(job)],
      });
      return Number(decode(result) ?? result) === 1;
    },
    async failStaleJob(job, cutoff) {
      if (!job.processingToken || job.status !== 'failed') return false;
      const result = await valkey.invokeScript(failStaleJobScript, {
        keys: [
          jobKey(job.id), userJobsByStatusKey(job.userId, 'failed'),
          ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
        ],
        args: [job.id, job.processingToken, String(cutoff), JSON.stringify(job)],
      });
      return Number(decode(result) ?? result) === 1;
    },
    async reconcileTerminalJob(job) {
      if (!job.processingToken || (job.status !== 'completed' && job.status !== 'failed')) return false;
      const result = await valkey.invokeScript(reconcileTerminalJobScript, {
        keys: [
          jobKey(job.id), userJobsByStatusKey(job.userId, job.status),
          ...uploadJobStatuses.map((status) => userJobsByStatusKey(job.userId, status)),
        ],
        args: [job.id, job.processingToken, JSON.stringify(job)],
      });
      return Number(decode(result) ?? result) === 1;
    },
    saveJob,

    async progress(userId) {
      const progress = await readProgress(userId);
      if (progress.total > 0 && progress.finished === progress.total && progress.failed === 0) {
        const [completedIds, duplicateIds] = await Promise.all([
          valkey.zrange(userJobsByStatusKey(userId, 'completed'), { start: 0, end: -1 }),
          valkey.zrange(userJobsByStatusKey(userId, 'duplicate'), { start: 0, end: -1 }),
        ]);
        if (completedIds.length + duplicateIds.length !== progress.total) return progress;
        const retired = await Promise.all([
          ...completedIds.map((id) => retireSuccessfulJob(userId, String(id), 'completed')),
          ...duplicateIds.map((id) => retireSuccessfulJob(userId, String(id), 'duplicate')),
        ]);
        if (retired.every(Boolean)) {
          return {
            total: 0,
            finished: 0,
            completed: completedIds.length,
            completedIds: completedIds.map(String),
            queued: 0,
            processing: 0,
            failed: 0,
          };
        }
        return readProgress(userId);
      }
      return progress;
    },

    async listJobs(userId, options) {
      const key = options.status ? userJobsByStatusKey(userId, options.status) : userJobsKey(userId);
      const total = await valkey.zcard(key);
      const pageCount = Math.max(1, Math.ceil(total / options.pageSize));
      const page = Math.min(options.page, pageCount);
      const start = (page - 1) * options.pageSize;
      const ids = (await valkey.zrange(key, { start, end: start + options.pageSize - 1 })).map(String);
      const jobs = (await Promise.all(ids.map(getJob)))
        .filter((job): job is UploadJob => Boolean(job))
        .filter((job) => job.userId === userId);
      return {
        total,
        page,
        pageSize: options.pageSize,
        jobs: jobs.map(({ id, originalFilename, status, error }) => ({ id, originalFilename, status, error })),
      };
    },

    async clearJobs(userId, ids) {
      if (!ids.length) return [];
      const cleared = [];
      for (const id of ids) {
        try {
          const result = await valkey.invokeScript(clearFailedJobScript, {
            keys: [
              jobKey(id), dispositionKey(id), failedCleanupKey(id), failedCleanupPendingKey,
              clearedJobEvidenceKey, userJobsKey(userId), allJobsKey, uploadExpiryKey,
              ...uploadJobStatuses.map((status) => userJobsByStatusKey(userId, status)),
            ],
            args: [id, userId, String(JOB_DISPOSITION_TTL_SECONDS), String(Date.now())],
          });
          const decoded = decode(result);
          if (decoded && decoded !== '0') cleared.push(id);
        } catch (error) {
          console.error('Unable to clear failed flight upload', error);
        }
      }
      return cleared;
    },

    async getDisposition(id) {
      const value = decode(await valkey.get(dispositionKey(id)));
      return value === 'retired' || value === 'cleared' ? value : null;
    },

    async getClearedJob(id) {
      if (decode(await valkey.get(dispositionKey(id))) !== 'cleared') return null;
      const raw = decode(await valkey.get(failedCleanupKey(id)));
      return raw ? JSON.parse(raw) as UploadJob : null;
    },

    async ownsClaim(job) {
      if (!job.processingToken) return false;
      const current = await getJob(job.id);
      return current?.status === 'processing' && current.processingToken === job.processingToken;
    },

    async pendingFailedCleanups() {
      return readMaintenanceJobs(failedCleanupPendingKey, failedCleanupKey);
    },

    async retainedClearedJobs() {
      const ids = (await valkey.zrange(clearedJobEvidenceKey, { start: 0, end: MAINTENANCE_BATCH_SIZE - 1 })).map(String);
      const jobs = (await Promise.all(ids.map((id) => valkey.get(failedCleanupKey(id))))).map(parseIndexedJob);
      const invalidIds = ids.filter((_, index) => !jobs[index]);
      if (invalidIds.length) await valkey.zrem(clearedJobEvidenceKey, invalidIds);
      const retainedIds = ids.filter((_, index) => Boolean(jobs[index]));
      if (retainedIds.length) {
        const rotateAt = Date.now() + JOB_DISPOSITION_TTL_SECONDS * 1000;
        await valkey.zadd(clearedJobEvidenceKey, Object.fromEntries(retainedIds.map((id) => [id, rotateAt])));
      }
      return jobs.filter((job): job is UploadJob => Boolean(job));
    },

    async finalizeFailedCleanup(id) {
      await execAtomic(
        new Batch(true).expire(failedCleanupKey(id), JOB_DISPOSITION_TTL_SECONDS).zrem(failedCleanupPendingKey, [id]),
        'Unable to finalize failed flight cleanup.',
      );
    },

    async allJobIds() {
      return (await valkey.zrange(allJobsKey, { start: 0, end: -1 })).map(String);
    },

    async queueSummary() {
      const ids = (await valkey.zrange(allJobsKey, { start: 0, end: -1 })).map(String);
      const jobs: UploadJob[] = [];
      for (let start = 0; start < ids.length; start += QUEUE_SUMMARY_BATCH_SIZE) {
        const batch = await Promise.all(ids.slice(start, start + QUEUE_SUMMARY_BATCH_SIZE).map(getJob));
        jobs.push(...batch.filter((job): job is UploadJob => Boolean(job)));
      }
      const queued = jobs.filter((job) => job.status === 'queued');
      return {
        queued: queued.length,
        processing: jobs.filter((job) => job.status === 'processing').length,
        failed: jobs.filter((job) => job.status === 'failed').length,
        oldestQueuedAgeSeconds: queued.length ? Math.max(0, Math.floor((Date.now() - Math.min(...queued.map((job) => job.updatedAt))) / 1_000)) : null,
      };
    },

    async expiredIntentIds(now = Date.now()) {
      const ids = (await valkey.zrange(uploadExpiryKey, {
        start: InfBoundary.NegativeInfinity,
        end: { value: now, isInclusive: true },
        type: 'byScore',
        limit: { offset: 0, count: MAINTENANCE_BATCH_SIZE },
      })).map(String);
      const jobs = (await Promise.all(ids.map((id) => valkey.get(jobKey(id))))).map(parseIndexedJob);
      const poisonIds = ids.filter((_, index) => jobs[index]?.status !== 'uploading');
      if (poisonIds.length) await valkey.zrem(uploadExpiryKey, poisonIds);
      return ids.filter((_, index) => jobs[index]?.status === 'uploading');
    },

    async pruneExpiredIntent(id) {
      await valkey.zrem(uploadExpiryKey, [id]);
    },

    async removeIntent(job) {
      return removeUploadingJob(job);
    },

    async pendingRemovals() {
      return readMaintenanceJobs(removalPendingKey, removalKey);
    },

    finalizeRemoval,

    async activeJobCountForUser(userId) {
      return (await jobsForUser(userId))
        .filter((job) => job.status === 'uploading' || job.status === 'queued' || job.status === 'processing')
        .length;
    },

    async removeTerminalJobsForUser(userId) {
      await removeTerminalJobs(await jobsForUser(userId));
    },

    async removeTerminalJobsForFlight(input) {
      const jobs = (await jobsForUser(input.userId)).filter((job) =>
        job.flightId === input.flightId
        || job.igcFileId === input.igcFileId
        || job.bucketKey === input.bucketKey,
      );
      await removeTerminalJobs(jobs);
    },
  };
}
