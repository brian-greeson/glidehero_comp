import { describe, expect, it, vi } from 'vitest';
import { createFlightWorkerService } from '../../src/services/flightWorkerService.js';
import type { UploadJob } from '../../src/services/flightUploadQueueService.js';

const job: UploadJob = {
  id: '00000000-0000-4000-8000-000000000010',
  userId: '00000000-0000-4000-8000-000000000001',
  originalFilename: 'flight.igc',
  contentType: 'application/octet-stream',
  byteSize: 3,
  bucketKey: 'glidehero/uploads/user/flight.igc',
  status: 'queued',
  createdAt: 1,
  updatedAt: 1,
};

describe('FlightWorkerService', () => {
  it('claims one queued object, creates metadata, processes it, and acknowledges it', async () => {
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: '00000000-0000-4000-8000-000000000020' }]) })) })),
    };
    const xack = vi.fn(async () => 1);
    const xdel = vi.fn(async () => 1);
    const valkey = { xack, xdel };
    const saved: UploadJob[] = [];
    const events: string[] = [];
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now(), updatedAt: Date.now() })),
      saveClaimedJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
      reconcileTerminalJob: vi.fn(async (value: UploadJob) => { saved.push(value); events.push('reconcile'); return true; }),
    };
    const processor = {
      process: vi.fn(async () => ({ status: 'completed' as const, flightId: '00000000-0000-4000-8000-000000000030' })),
    };
    const workerControl = {
      publishStatus: vi.fn(async () => undefined),
    };
    const generateForFlight = vi.fn(async () => { events.push('thumbnail'); });
    const send = vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } }));
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, processor, {
      s3Client: { send } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
      thumbnailLifecycle: { generateForFlight },
      workerControl: workerControl as never,
    });

    await worker.processJob('1-0', job.id);

    expect(processor.process).toHaveBeenCalledWith({
      ownerUserId: job.userId,
      igcFileId: '00000000-0000-4000-8000-000000000020',
      bucketKey: job.bucketKey,
      contentHash: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      processingToken: 'token-1',
      source: '\u0001\u0002\u0003',
    });
    expect(saved.map((value) => value.status)).toEqual(['completed']);
    expect(generateForFlight).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000030');
    expect(events).toEqual(['reconcile', 'thumbnail']);
    expect(xack).toHaveBeenCalledWith('glidehero:flight-jobs', 'flight-workers', ['1-0']);
    expect(xdel).toHaveBeenCalledWith('glidehero:flight-jobs', ['1-0']);
    expect(workerControl.publishStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'idle', processedCount: 1, failedCount: 0,
    }));
  });

  it('publishes a failed count and the current processing error', async () => {
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
    };
    const workerControl = {
      publishStatus: vi.fn(async () => undefined),
    };
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1' })),
      saveClaimedJob: vi.fn(async () => true),
    };
    const worker = createFlightWorkerService(database as never, {
      xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1),
    } as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn(async () => { throw new Error('object storage unavailable'); }) } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
      workerControl: workerControl as never,
    });

    await worker.processJob('1-0', job.id);

    expect(workerControl.publishStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'idle', processedCount: 0, failedCount: 1, lastError: 'object storage unavailable',
    }));
  });

  it('keeps a completed queue item when best-effort thumbnail generation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
    };
    const saved: UploadJob[] = [];
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now() })),
      saveClaimedJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
      reconcileTerminalJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
    };
    const worker = createFlightWorkerService(database as never, { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) } as never, queue as never, {
      process: vi.fn(async () => ({ status: 'completed' as const, flightId: 'flight-1' })),
    }, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
      thumbnailLifecycle: {
        generateForFlight: vi.fn(async () => {
          throw new Error('MapTiler thumbnail generation failed.', { cause: new Error('MapTiler returned HTTP 401.') });
        }),
      },
    });

    await worker.processJob('1-0', job.id);

    expect(saved.map((value) => value.status)).toEqual(['completed']);
    expect(consoleError).toHaveBeenCalledWith('Unable to generate flight thumbnail', {
      flightId: 'flight-1',
      errorName: 'Error',
      errorMessage: 'MapTiler thumbnail generation failed.',
      causeName: 'Error',
      causeMessage: 'MapTiler returned HTTP 401.',
      httpStatusCode: 401,
    });
    consoleError.mockRestore();
  });

  it('acknowledges a terminal duplicate delivery without touching PostgreSQL', async () => {
    const database = { select: vi.fn() };
    const xack = vi.fn(async () => 1);
    const xdel = vi.fn(async () => 1);
    const queue = { claimJob: vi.fn(async () => null), getJob: vi.fn(async () => ({ ...job, status: 'completed' as const })) };
    const worker = createFlightWorkerService(database as never, { xack, xdel } as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
    });

    await worker.processJob('2-0', job.id);
    expect(database.select).not.toHaveBeenCalled();
    expect(xack).toHaveBeenCalledOnce();
  });

  it('runs the processor only once when two workers compete for the same job', async () => {
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: '00000000-0000-4000-8000-000000000020' }]) })) })),
    };
    let claimed = false;
    const saved: UploadJob[] = [];
    const queue = {
      claimJob: vi.fn(async () => {
        if (claimed) return null;
        claimed = true;
        return { ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now(), updatedAt: Date.now() };
      }),
      getJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1' })),
      saveClaimedJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
      reconcileTerminalJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
    };
    const processor = {
      process: vi.fn(async () => ({ status: 'completed' as const, flightId: '00000000-0000-4000-8000-000000000030' })),
    };
    const send = vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } }));
    const valkey = { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) };
    const first = createFlightWorkerService(database as never, valkey as never, queue as never, processor, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    const second = createFlightWorkerService(database as never, valkey as never, queue as never, processor, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-2',
    });

    await Promise.all([
      first.processJob('1-0', job.id),
      second.processJob('2-0', job.id),
    ]);

    expect(queue.claimJob).toHaveBeenCalledTimes(2);
    expect(processor.process).toHaveBeenCalledOnce();
    expect(database.insert).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(saved.map((value) => value.status)).toEqual(['completed']);
    expect(valkey.xack).toHaveBeenCalledTimes(2);
    expect(valkey.xdel).toHaveBeenCalledTimes(2);
  });

  it('leaves a successful terminal message pending when XACK fails without recasting it as failed', async () => {
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
    };
    const saved: UploadJob[] = [];
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now() })),
      saveClaimedJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
      reconcileTerminalJob: vi.fn(async (value: UploadJob) => { saved.push(value); return true; }),
    };
    const xack = vi.fn(async () => { throw new Error('Valkey unavailable'); });
    const xdel = vi.fn(async () => 1);
    const worker = createFlightWorkerService(database as never, { xack, xdel } as never, queue as never, {
      process: vi.fn(async () => ({ status: 'completed' as const, flightId: 'flight-1' })),
    }, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights', consumerName: 'worker-1',
    });

    await expect(worker.processJob('1-0', job.id)).resolves.toBeUndefined();

    expect(saved.map((value) => value.status)).toEqual(['completed']);
    expect(xdel).not.toHaveBeenCalled();
  });

  it('removes database work when a user clears the job before late completion', async () => {
    const limit = vi.fn(async () => []);
    const deleteWhere = vi.fn(async () => undefined);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now() })),
      saveClaimedJob: vi.fn(async () => false),
      reconcileTerminalJob: vi.fn(async () => false),
      getJob: vi.fn(async () => null),
      getDisposition: vi.fn(async () => 'cleared' as const),
    };
    const worker = createFlightWorkerService(database as never, { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) } as never, queue as never, {
      process: vi.fn(async () => ({ status: 'completed' as const, flightId: 'flight-1' })),
    }, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.processJob('1-0', job.id);

    expect(queue.reconcileTerminalJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', processingToken: 'token-1' }));
    expect(deleteWhere).toHaveBeenCalledOnce();
  });

  it('removes an insert made after failed cleanup finalized before a delayed worker resumes', async () => {
    const igcRows = new Set<string>();
    const contentHashes = new Set<string>();
    let ownershipChecks = 0;
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => {
        // The user cleanup has already finalized. This is the delayed INSERT.
        igcRows.add('late-file');
        return [{ id: 'late-file' }];
      }) })) })),
      delete: vi.fn(() => ({ where: vi.fn(async () => {
        igcRows.clear();
        contentHashes.clear();
      }) })),
    };
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now() })),
      ownsClaim: vi.fn(async () => ++ownershipChecks === 1),
      getDisposition: vi.fn(async () => 'cleared' as const),
    };
    const processor = { process: vi.fn(async () => {
      contentHashes.add('should-never-be-written');
      return { status: 'completed' as const, flightId: 'flight-1' };
    }) };
    const worker = createFlightWorkerService(database as never, {
      xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1),
    } as never, queue as never, processor, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.processJob('late-1', job.id);

    expect(queue.ownsClaim).toHaveBeenCalledTimes(2);
    expect(processor.process).not.toHaveBeenCalled();
    expect(igcRows.size).toBe(0);
    expect(contentHashes.size).toBe(0);
  });

  it('uses retained cleared evidence to remove rows left by a crash immediately after insert', async () => {
    const igcRows = new Set([job.bucketKey]);
    const contentHashes = new Set(['orphaned-content-hash']);
    const deleteWhere = vi.fn(async () => {
      igcRows.delete(job.bucketKey);
      contentHashes.clear(); // PostgreSQL cascade from igc_files to flights.
    });
    const queue = {
      pendingFailedCleanups: vi.fn(async () => []),
      retainedClearedJobs: vi.fn(async () => [{ ...job, status: 'failed' as const, processingToken: 'token-1' }]),
      pendingRemovals: vi.fn(async () => []),
      expiredIntentIds: vi.fn(async () => []),
    };
    const worker = createFlightWorkerService({ delete: vi.fn(() => ({ where: deleteWhere })) } as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.cleanupAbandoned();

    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(igcRows.size).toBe(0);
    expect(contentHashes.size).toBe(0);
  });

  it('uses retained evidence during missing-job stream recovery', async () => {
    const deleteWhere = vi.fn(async () => undefined);
    const queue = {
      getJob: vi.fn(async () => null),
      getClearedJob: vi.fn(async () => ({ ...job, status: 'failed' as const })),
    };
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', { 'missing-1': [['jobId', job.id]] }]),
      xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService({ delete: vi.fn(() => ({ where: deleteWhere })) } as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.recoverStale();

    expect(queue.getClearedJob).toHaveBeenCalledWith(job.id);
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(valkey.xack).toHaveBeenCalledOnce();
  });

  it('durably retries XDEL after atomic XACK succeeds and returns retention to zero', async () => {
    const pendingDeletes = new Set<string>();
    let deleteAttempts = 0;
    const valkey = {
      exec: vi.fn(async () => { pendingDeletes.add('stream-1'); return [1, 1]; }),
      xdel: vi.fn(async (_stream: string, ids: string[]) => {
        deleteAttempts += 1;
        if (deleteAttempts === 1) throw new Error('temporary XDEL failure');
        expect(ids).toEqual(['stream-1']);
        return 1;
      }),
      zrange: vi.fn(async () => [...pendingDeletes]),
      zrem: vi.fn(async (_key: string, ids: string[]) => {
        ids.forEach((id) => pendingDeletes.delete(id));
        return ids.length;
      }),
    };
    const queue = {
      claimJob: vi.fn(async () => null),
      getJob: vi.fn(async () => ({ ...job, status: 'completed' as const })),
    };
    const worker = createFlightWorkerService({ select: vi.fn() } as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.processJob('stream-1', job.id);
    expect(pendingDeletes.size).toBe(1);

    await worker.retryAcknowledgedDeletions();
    expect(deleteAttempts).toBe(2);
    expect(pendingDeletes.size).toBe(0);
  });

  it('preserves completion when recovery reconciles and navbar retires before delayed original settlement', async () => {
    let reads = 0;
    const limit = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return [];
      return [{ igcFileId: 'file-1', flightId: 'flight-1', status: 'completed', processingToken: null, processingError: null, hasProgress: true }];
    });
    const deleteWhere = vi.fn(async () => undefined);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now() })),
      saveClaimedJob: vi.fn(async () => true),
      reconcileTerminalJob: vi.fn(async () => false),
      getJob: vi.fn(async () => null),
      getDisposition: vi.fn(async () => 'retired' as const),
    };
    const worker = createFlightWorkerService(database as never, { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) } as never, queue as never, {
      process: vi.fn(async () => ({ status: 'completed' as const, flightId: 'flight-1' })),
    }, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.processJob('1-0', job.id);

    expect(queue.getDisposition).toHaveBeenCalledWith(job.id);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('preserves the fenced failed database row when stale failure wins', async () => {
    const limit = vi.fn(async () => []);
    const deleteWhere = vi.fn(async () => undefined);
    let queueStatus = 'processing';
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    };
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: 1 })),
      saveClaimedJob: vi.fn(async (terminal: UploadJob) => {
        if (terminal.status === 'completed') return false;
        return queueStatus === 'processing';
      }),
      reconcileTerminalJob: vi.fn(async () => false),
      getJob: vi.fn(async () => ({ ...job, status: 'failed' as const, processingToken: 'token-1' })),
    };
    const processor = vi.fn(async () => {
      queueStatus = 'failed';
      return { status: 'completed' as const, flightId: 'flight-1' };
    });
    const worker = createFlightWorkerService(database as never, { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) } as never, queue as never, { process: processor }, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.processJob('1-0', job.id);

    expect(queueStatus).toBe('failed');
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('reconciles database completion when the processor throws before its terminal queue write', async () => {
    let reads = 0;
    const limit = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return [];
      return [{ igcFileId: 'file-1', flightId: 'flight-1', status: 'completed', processingToken: null, processingError: null, hasProgress: true }];
    });
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
    };
    const queue = {
      claimJob: vi.fn(async () => ({ ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: Date.now() })),
      saveClaimedJob: vi.fn(async () => true),
      reconcileTerminalJob: vi.fn(async () => true),
    };
    const worker = createFlightWorkerService(database as never, { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) } as never, queue as never, {
      process: vi.fn(async () => { throw new Error('crashed after commit'); }),
    }, {
      s3Client: { send: vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } })) } as never,
      bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.processJob('1-0', job.id);

    expect(queue.reconcileTerminalJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', flightId: 'flight-1' }));
    expect(queue.saveClaimedJob).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('treats XDEL failure after XACK as nonfatal cleanup', async () => {
    const queue = { claimJob: vi.fn(async () => null), getJob: vi.fn(async () => ({ ...job, status: 'completed' as const })) };
    const xack = vi.fn(async () => 1);
    const xdel = vi.fn(async () => { throw new Error('cleanup failed'); });
    const worker = createFlightWorkerService({} as never, { xack, xdel } as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await expect(worker.processJob('1-0', job.id)).resolves.toBeUndefined();
    expect(xack).toHaveBeenCalledOnce();
    expect(xdel).toHaveBeenCalledOnce();
  });

  it('reconciles a committed flight after the original worker crashes before its terminal queue write', async () => {
    const limit = vi.fn(async () => [{
      igcFileId: 'file-1', flightId: 'flight-1', status: 'completed', processingToken: null, processingError: null, hasProgress: true,
    }]);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
    };
    const stale = { ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: 1 };
    const queue = {
      getJob: vi.fn(async () => stale),
      failStaleJob: vi.fn(async () => true),
      reconcileTerminalJob: vi.fn(async () => true),
    };
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', { '1-0': [['jobId', job.id]] }]),
      xack: vi.fn(async (..._args: unknown[]) => 1),
      xdel: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-2',
    });

    await worker.recoverStale();

    expect(queue.reconcileTerminalJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', flightId: 'flight-1' }));
    expect(queue.failStaleJob).not.toHaveBeenCalled();
    expect(valkey.xack).toHaveBeenCalledOnce();
  });

  it('reports a completed flight without progression as an administrator reprocess failure', async () => {
    const limit = vi.fn(async () => [{
      igcFileId: 'file-1', flightId: 'flight-1', status: 'completed', processingToken: null, processingError: null,
      hasProgress: false,
    }]);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
    };
    const stale = { ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: 1 };
    const queue = {
      getJob: vi.fn(async () => stale),
      failStaleJob: vi.fn(async () => true),
      reconcileTerminalJob: vi.fn(async () => true),
    };
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', { '1-0': [['jobId', job.id]] }]),
      xack: vi.fn(async (..._args: unknown[]) => 1),
      xdel: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-2',
    });

    await worker.recoverStale();

    expect(queue.reconcileTerminalJob).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('administrator'),
    }));
    expect(queue.reconcileTerminalJob).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('reprocess'),
    }));
    expect(queue.failStaleJob).not.toHaveBeenCalled();
    expect(valkey.xack).toHaveBeenCalledOnce();
  });

  it('returns an autoclaimed queued entry to unread work without processing it', async () => {
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'file-1' }]) })) })),
    };
    let durable: UploadJob = { ...job };
    const queue = {
      getJob: vi.fn(async () => durable),
      claimJob: vi.fn(async () => {
        if (durable.status !== 'queued') return null;
        durable = { ...durable, status: 'processing', processingToken: 'token-1', heartbeatAt: Date.now() };
        return durable;
      }),
      reconcileTerminalJob: vi.fn(async (terminal: UploadJob) => {
        durable = terminal;
        return true;
      }),
      saveClaimedJob: vi.fn(async () => true),
    };
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', { 'queued-1': [['jobId', job.id]] }]),
      exec: vi.fn(async () => []),
      xack: vi.fn(async () => 1),
      xdel: vi.fn(async () => 1),
    };
    const processor = vi.fn(async () => ({ status: 'completed' as const, flightId: 'flight-1' }));
    const send = vi.fn(async () => ({ Body: { transformToByteArray: vi.fn(async () => Uint8Array.from([1, 2, 3])) } }));
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, { process: processor }, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-2',
    });

    await worker.recoverStale();

    expect(queue.claimJob).not.toHaveBeenCalled();
    expect(processor).not.toHaveBeenCalled();
    expect(durable.status).toBe('queued');
    expect(valkey.exec).toHaveBeenCalledOnce();
    expect(valkey.xack).not.toHaveBeenCalled();
  });

  it('reconciles completion when it wins PostgreSQL after stale recovery reserves queue failure', async () => {
    let databaseStatus: 'processing' | 'completed' | 'failed' = 'processing';
    let selects = 0;
    const limit = vi.fn(async () => {
      selects += 1;
      return [{
        igcFileId: 'file-1', flightId: 'flight-1', status: databaseStatus,
        processingToken: databaseStatus === 'processing' ? 'token-1' : null, processingError: null, hasProgress: true,
      }];
    });
    const whereUpdate = vi.fn(async () => {
      databaseStatus = 'completed';
    });
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: whereUpdate })) })),
    };
    const stale = { ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: 1 };
    const queue = {
      getJob: vi.fn(async () => stale),
      failStaleJob: vi.fn(async () => true),
      reconcileTerminalJob: vi.fn(async () => true),
    };
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', { '1-0': [['jobId', job.id]] }]),
      xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-2',
    });

    await worker.recoverStale();

    expect(selects).toBeGreaterThanOrEqual(3);
    expect(queue.failStaleJob).toHaveBeenCalledOnce();
    expect(queue.reconcileTerminalJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(databaseStatus).toBe('completed');
    expect(valkey.xack).toHaveBeenCalledOnce();
  });

  it('leaves the pending entry recoverable when a fresh heartbeat defeats stale recovery', async () => {
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
    };
    const stale = { ...job, status: 'processing' as const, processingToken: 'token-1', heartbeatAt: 1 };
    const queue = {
      getJob: vi.fn(async () => stale),
      failStaleJob: vi.fn(async () => false),
    };
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', { '1-0': [['jobId', job.id]] }]),
      xack: vi.fn(async () => 1),
      xdel: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-2',
    });

    await worker.recoverStale();

    expect(queue.failStaleJob).toHaveBeenCalledOnce();
    expect(valkey.xack).not.toHaveBeenCalled();
    expect(valkey.xdel).not.toHaveBeenCalled();
  });

  it('retries PostgreSQL failed-state reconciliation before acknowledging redelivery', async () => {
    const limit = vi.fn(async () => [{ igcFileId: 'file-1', flightId: 'flight-1', status: 'processing' }]);
    let attempts = 0;
    const whereUpdate = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('database unavailable');
    });
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ leftJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })) })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: whereUpdate })) })),
    };
    const failed = { ...job, status: 'failed' as const, processingToken: 'token-1', error: 'worker stopped' };
    const queue = { claimJob: vi.fn(async () => null), getJob: vi.fn(async () => failed) };
    const valkey = { xack: vi.fn(async () => 1), xdel: vi.fn(async () => 1) };
    const worker = createFlightWorkerService(database as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await expect(worker.processJob('1-0', job.id)).rejects.toThrow('database unavailable');
    expect(valkey.xack).not.toHaveBeenCalled();
    await expect(worker.processJob('1-0', job.id)).resolves.toBeUndefined();
    expect(whereUpdate).toHaveBeenCalledTimes(2);
    expect(valkey.xack).toHaveBeenCalledOnce();
  });

  it('atomically removes an abandoned intent before deleting its object', async () => {
    const order: string[] = [];
    const queue = {
      pendingFailedCleanups: vi.fn(async () => []),
      pendingRemovals: vi.fn(async () => []),
      expiredIntentIds: vi.fn(async () => [job.id]),
      getJob: vi.fn(async () => ({ ...job, status: 'uploading' as const })),
      removeIntent: vi.fn(async () => { order.push('remove'); return true; }),
      finalizeRemoval: vi.fn(async () => { order.push('finalize'); }),
    };
    const send = vi.fn(async () => { order.push('delete'); return {}; });
    const worker = createFlightWorkerService({} as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.cleanupAbandoned();

    expect(order).toEqual(['remove', 'delete', 'finalize']);
  });

  it('retries a failed-clear tombstone when PostgreSQL cascade deletion initially fails', async () => {
    const failed = { ...job, status: 'failed' as const, processingToken: 'token-1' };
    let databaseAttempts = 0;
    const where = vi.fn(async () => {
      databaseAttempts += 1;
      if (databaseAttempts === 1) throw new Error('database unavailable');
    });
    const database = { delete: vi.fn(() => ({ where })) };
    const queue = {
      pendingFailedCleanups: vi.fn(async () => [failed]),
      finalizeFailedCleanup: vi.fn(async () => undefined),
      pendingRemovals: vi.fn(async () => []),
      expiredIntentIds: vi.fn(async () => []),
    };
    const worker = createFlightWorkerService(database as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn(async () => ({})) } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.cleanupAbandoned();
    expect(queue.finalizeFailedCleanup).not.toHaveBeenCalled();
    await worker.cleanupAbandoned();
    expect(where).toHaveBeenCalledTimes(2);
    expect(queue.finalizeFailedCleanup).toHaveBeenCalledWith(failed.id);
  });

  it('retries a failed-clear tombstone when object deletion initially fails', async () => {
    const failed = { ...job, status: 'failed' as const, processingToken: 'token-1' };
    const database = { delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })) };
    const queue = {
      pendingFailedCleanups: vi.fn(async () => [failed]),
      finalizeFailedCleanup: vi.fn(async () => undefined),
      pendingRemovals: vi.fn(async () => []),
      expiredIntentIds: vi.fn(async () => []),
    };
    let objectAttempts = 0;
    const send = vi.fn(async () => {
      objectAttempts += 1;
      if (objectAttempts === 1) throw new Error('S3 unavailable');
      return {};
    });
    const worker = createFlightWorkerService(database as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.cleanupAbandoned();
    expect(queue.finalizeFailedCleanup).not.toHaveBeenCalled();
    await worker.cleanupAbandoned();
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.finalizeFailedCleanup).toHaveBeenCalledWith(failed.id);
  });

  it('retries durable object-removal tombstones during maintenance', async () => {
    const removal = { ...job, status: 'uploading' as const };
    const queue = {
      pendingFailedCleanups: vi.fn(async () => []),
      pendingRemovals: vi.fn(async () => [removal]),
      finalizeRemoval: vi.fn(async () => undefined),
      expiredIntentIds: vi.fn(async () => []),
    };
    const send = vi.fn(async () => ({}));
    const worker = createFlightWorkerService({} as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.cleanupAbandoned();

    expect(send).toHaveBeenCalledOnce();
    expect(queue.finalizeRemoval).toHaveBeenCalledWith(removal.id);
  });

  it('keeps a removal tombstone discoverable until object deletion succeeds', async () => {
    const removal = { ...job, status: 'uploading' as const };
    const queue = {
      pendingFailedCleanups: vi.fn(async () => []),
      pendingRemovals: vi.fn(async () => [removal]),
      finalizeRemoval: vi.fn(async () => undefined),
      expiredIntentIds: vi.fn(async () => []),
    };
    let attempts = 0;
    const send = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('S3 unavailable');
      return {};
    });
    const worker = createFlightWorkerService({} as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.cleanupAbandoned();
    expect(queue.finalizeRemoval).not.toHaveBeenCalled();
    await worker.cleanupAbandoned();
    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.finalizeRemoval).toHaveBeenCalledWith(removal.id);
  });

  it('keeps the worker loop alive across message and maintenance errors', async () => {
    const controller = new AbortController();
    let reads = 0;
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => {
        reads += 1;
        if (reads === 1) return [{ key: 'glidehero:flight-jobs', value: { '1-0': [['jobId', job.id]] } }];
        controller.abort();
        return null;
      }),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.processJob = vi.fn(async () => { throw new Error('message failed'); });
    worker.recoverStale = vi.fn(async () => { throw new Error('maintenance failed'); });
    worker.cleanupAbandoned = vi.fn(async () => { throw new Error('cleanup failed'); });

    await expect(worker.run(controller.signal)).resolves.toBeUndefined();
    expect(worker.processJob).toHaveBeenCalledOnce();
    expect(worker.recoverStale).toHaveBeenCalledOnce();
    expect(worker.cleanupAbandoned).toHaveBeenCalledOnce();
  });

  it('continues after transient stream-read errors with bounded backoff', async () => {
    const controller = new AbortController();
    let reads = 0;
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => {
        reads += 1;
        if (reads === 1) throw new Error('Valkey unavailable');
        controller.abort();
        return null;
      }),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1', readRetryDelayMs: 0,
    });
    worker.recoverStale = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);

    await expect(worker.run(controller.signal)).resolves.toBeUndefined();
    expect(valkey.xreadgroup).toHaveBeenCalledTimes(2);
  });

  it('uses a dedicated client for blocking stream reads', async () => {
    const controller = new AbortController();
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(),
    };
    const streamReader = {
      xreadgroup: vi.fn(async () => {
        controller.abort();
        return null;
      }),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
      streamReader: streamReader as never,
    });
    worker.recoverStale = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);

    await expect(worker.run(controller.signal)).resolves.toBeUndefined();
    expect(streamReader.xreadgroup).toHaveBeenCalledOnce();
    expect(valkey.xreadgroup).not.toHaveBeenCalled();
  });

  it('waits for a running global control state before reading new jobs', async () => {
    const controller = new AbortController();
    let state: 'running' | 'paused' = 'paused';
    const workerControl = {
      initialize: vi.fn(async () => undefined),
      getState: vi.fn(async () => state),
      publishStatus: vi.fn(async () => undefined),
    };
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => { controller.abort(); return null; }),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
      workerControl: workerControl as never,
      readRetryDelayMs: 0,
    });
    worker.recoverStale = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);

    const running = worker.run(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(valkey.xreadgroup).not.toHaveBeenCalled();
    expect(workerControl.publishStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'paused' }));
    state = 'running';
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(running).resolves.toBeUndefined();
    expect(valkey.xreadgroup).toHaveBeenCalledOnce();
  });

  it('allows an active job to finish when the global state becomes paused', async () => {
    const controller = new AbortController();
    const active = Promise.withResolvers<void>();
    let controlReads = 0;
    const workerControl = {
      initialize: vi.fn(async () => undefined),
      getState: vi.fn(async () => {
        controlReads += 1;
        if (controlReads >= 3) {
          controller.abort();
          return 'paused' as const;
        }
        return 'running' as const;
      }),
      publishStatus: vi.fn(async () => undefined),
    };
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => [{ key: 'glidehero:flight-jobs', value: { '1-0': [['jobId', job.id]] } }]),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      consumerName: 'worker-1',
      workerControl: workerControl as never,
    });
    worker.recoverStale = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);
    const events: string[] = [];
    worker.processJob = vi.fn(async () => {
      events.push('started');
      await active.promise;
      events.push('finished');
    });

    const running = worker.run(controller.signal);
    await vi.waitFor(() => expect(worker.processJob).toHaveBeenCalledOnce());
    active.resolve();
    await expect(running).resolves.toBeUndefined();
    expect(events).toEqual(['started', 'finished']);
    expect(valkey.xreadgroup).toHaveBeenCalledOnce();
  });

  it('does not accept a job returned after shutdown interrupts a blocked stream read', async () => {
    const controller = new AbortController();
    const blockedRead = Promise.withResolvers<unknown>();
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => blockedRead.promise),
      exec: vi.fn(async () => []),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.processJob = vi.fn(async () => undefined);
    worker.retryAcknowledgedDeletions = vi.fn(async () => undefined);
    worker.recoverStale = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);

    const running = worker.run(controller.signal);
    await vi.waitFor(() => expect(valkey.xreadgroup).toHaveBeenCalledOnce());
    controller.abort();
    blockedRead.resolve([{ key: 'glidehero:flight-jobs', value: { '1-0': [['jobId', job.id]] } }]);

    await expect(running).resolves.toBeUndefined();
    expect(worker.processJob).not.toHaveBeenCalled();
    expect(valkey.exec).toHaveBeenCalledOnce();
    expect(worker.retryAcknowledgedDeletions).toHaveBeenCalledOnce();
    expect(worker.recoverStale).toHaveBeenCalledOnce();
    expect(worker.cleanupAbandoned).toHaveBeenCalledOnce();
  });

  it('leaves a failed shutdown release recoverable for eventual queued-job processing', async () => {
    const controller = new AbortController();
    const blockedRead = Promise.withResolvers<unknown>();
    let durableStatus: UploadJob['status'] = 'queued';
    let recoveryEnabled = false;
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => blockedRead.promise),
      exec: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce([]),
      xautoclaim: vi.fn(async () => ['0-0', recoveryEnabled ? { 'pending-1': [['jobId', job.id]] } : {}]),
      xack: vi.fn(async (..._args: unknown[]) => 1),
      xdel: vi.fn(async () => 1),
    };
    const queue = { getJob: vi.fn(async () => ({ ...job, status: durableStatus })) };
    const worker = createFlightWorkerService({} as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.retryAcknowledgedDeletions = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);
    worker.processJob = vi.fn(async (streamId: string) => {
      durableStatus = 'completed';
      await valkey.xack('glidehero:flight-jobs', 'flight-workers', [streamId]);
    });

    const running = worker.run(controller.signal);
    await vi.waitFor(() => expect(valkey.xreadgroup).toHaveBeenCalledOnce());
    controller.abort();
    blockedRead.resolve([{ key: 'glidehero:flight-jobs', value: { 'pending-1': [['jobId', job.id]] } }]);
    await expect(running).resolves.toBeUndefined();
    expect(durableStatus).toBe('queued');
    expect(valkey.xack).not.toHaveBeenCalled();

    recoveryEnabled = true;
    await worker.recoverStale();
    expect(worker.processJob).not.toHaveBeenCalled();
    expect(durableStatus).toBe('queued');
    expect(valkey.exec).toHaveBeenCalledTimes(2);
    expect(valkey.xack).not.toHaveBeenCalled();
  });

  it('allows only one concurrent worker to own a maintenance pass and permits takeover after lease expiry', async () => {
    let now = 1_000;
    const leases = new Map<string, { token: string; expiresAt: number }>();
    const set = vi.fn(async (key: string, token: string, options: { expiry: { count: number } }) => {
      const lease = leases.get(key);
      if (lease && lease.expiresAt > now) return null;
      leases.set(key, { token, expiresAt: now + options.expiry.count });
      return 'OK';
    });
    const invokeScript = vi.fn(async (_script: unknown, options: { keys: string[]; args: string[] }) => {
      const lease = leases.get(options.keys[0]!);
      if (!lease || lease.token !== options.args[0]) return 0;
      if (options.args.length === 2) {
        lease.expiresAt = now + Number(options.args[1]);
        return 1;
      }
      leases.delete(options.keys[0]!);
      return 1;
    });
    const valkey = { set, invokeScript };
    const first = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    const second = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-2',
    });
    first.retryAcknowledgedDeletions = vi.fn(async () => undefined);
    first.recoverStale = vi.fn(async () => undefined);
    const cleanupGate = Promise.withResolvers<void>();
    first.cleanupAbandoned = vi.fn(async () => cleanupGate.promise);
    second.retryAcknowledgedDeletions = vi.fn(async () => undefined);
    second.recoverStale = vi.fn(async () => undefined);
    second.cleanupAbandoned = vi.fn(async () => undefined);

    const firstPass = first.runCleanupMaintenance();
    await vi.waitFor(() => expect(first.cleanupAbandoned).toHaveBeenCalledOnce());
    expect(await second.runCleanupMaintenance()).toBe(false);
    cleanupGate.resolve();
    expect(await firstPass).toBe(true);
    expect(first.cleanupAbandoned).toHaveBeenCalledOnce();
    expect(second.cleanupAbandoned).not.toHaveBeenCalled();

    leases.set('glidehero:flight-upload-cleanup-lease', { token: 'crashed-worker', expiresAt: now + 15_000 });
    expect(await second.runCleanupMaintenance()).toBe(false);
    now += 15_000;
    expect(await second.runCleanupMaintenance()).toBe(true);
    expect(second.cleanupAbandoned).toHaveBeenCalledOnce();
  });

  it('continues later maintenance phases when an earlier phase fails', async () => {
    const valkey = { set: vi.fn(async () => 'OK') };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.retryAcknowledgedDeletions = vi.fn(async () => { throw new Error('stream cleanup unavailable'); });
    worker.cleanupAbandoned = vi.fn(async () => undefined);

    await expect(worker.runCleanupMaintenance()).resolves.toBe(true);
    expect(worker.cleanupAbandoned).toHaveBeenCalledOnce();
  });

  it('continues cleanup categories when one discovery query fails', async () => {
    const removal = { ...job, status: 'uploading' as const };
    const queue = {
      pendingFailedCleanups: vi.fn(async () => { throw new Error('cleanup index unavailable'); }),
      retainedClearedJobs: vi.fn(async () => []),
      pendingRemovals: vi.fn(async () => [removal]),
      finalizeRemoval: vi.fn(async () => undefined),
      expiredIntentIds: vi.fn(async () => []),
    };
    const send = vi.fn(async () => ({}));
    const worker = createFlightWorkerService({} as never, {} as never, queue as never, { process: vi.fn() }, {
      s3Client: { send } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await expect(worker.cleanupAbandoned()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(queue.finalizeRemoval).toHaveBeenCalledWith(removal.id);
    expect(queue.expiredIntentIds).toHaveBeenCalledOnce();
  });

  it('runs stale recovery while the single worker is blocked processing a flight', async () => {
    const controller = new AbortController();
    const processing = Promise.withResolvers<void>();
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => [{ key: 'glidehero:flight-jobs', value: { '1-0': [['jobId', job.id]] } }]),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.processJob = vi.fn(async () => processing.promise);
    worker.recoverStale = vi.fn(async () => undefined);
    worker.retryAcknowledgedDeletions = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => undefined);

    const running = worker.run(controller.signal);
    await vi.waitFor(() => expect(worker.processJob).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(worker.recoverStale).toHaveBeenCalledOnce());
    controller.abort();
    processing.resolve();
    await expect(running).resolves.toBeUndefined();
  });

  it('does not let slow cleanup delay the independent stale-recovery loop', async () => {
    const controller = new AbortController();
    const blockedRead = Promise.withResolvers<unknown>();
    const slowCleanup = Promise.withResolvers<void>();
    const valkey = {
      xgroupCreate: vi.fn(async () => 'OK'),
      xreadgroup: vi.fn(async () => blockedRead.promise),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.recoverStale = vi.fn(async () => undefined);
    worker.retryAcknowledgedDeletions = vi.fn(async () => undefined);
    worker.cleanupAbandoned = vi.fn(async () => slowCleanup.promise);

    const running = worker.run(controller.signal);
    await vi.waitFor(() => expect(worker.cleanupAbandoned).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(worker.recoverStale).toHaveBeenCalledOnce());
    expect(slowCleanup.promise).toBeInstanceOf(Promise);
    controller.abort();
    blockedRead.resolve(null);
    slowCleanup.resolve();
    await expect(running).resolves.toBeUndefined();
  });

  it('keeps monitoring while main processing is blocked and requeues queued PEL work without a second processor', async () => {
    const processing = Promise.withResolvers<void>();
    let recoveryPass = 0;
    const exec = vi.fn(async (batch: { commands: unknown[] }) => {
      expect(batch.commands).toHaveLength(3);
      return [];
    });
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', recoveryPass++ === 0 ? { 'queued-pel': [['jobId', 'queued-job']] } : {}]),
      exec,
    };
    const queue = { getJob: vi.fn(async () => ({ ...job, id: 'queued-job', status: 'queued' as const })) };
    const worker = createFlightWorkerService({} as never, valkey as never, queue as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    worker.processJob = vi.fn(async () => processing.promise);

    const activeJob = worker.processJob('active-stream', job.id);
    await worker.recoverStale();
    await worker.recoverStale();

    expect(worker.processJob).toHaveBeenCalledOnce();
    expect(valkey.xautoclaim).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledOnce();
    processing.resolve();
    await activeJob;
  });

  it('stops stale-recovery entries after ownership is lost mid-batch', async () => {
    const getJob = vi.fn(async () => ({ ...job, status: 'completed' as const }));
    const valkey = {
      xautoclaim: vi.fn(async () => ['0-0', {
        'stale-1': [['jobId', 'job-1']],
        'stale-2': [['jobId', 'job-2']],
      }]),
      xack: vi.fn(async () => 1),
      xdel: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, { getJob } as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });
    let ownershipChecks = 0;

    await worker.recoverStale(() => ++ownershipChecks <= 2);

    expect(getJob).toHaveBeenCalledOnce();
    expect(valkey.xack).toHaveBeenCalledOnce();
  });

  it('stops acknowledged-deletion retries after shutdown aborts mid-batch', async () => {
    const controller = new AbortController();
    const xdel = vi.fn(async () => { controller.abort(); return 1; });
    const valkey = {
      zrange: vi.fn(async () => ['stream-1', 'stream-2']),
      xdel,
      zrem: vi.fn(async () => 1),
      zadd: vi.fn(async () => 1),
    };
    const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
      s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
    });

    await worker.retryAcknowledgedDeletions(() => !controller.signal.aborted);

    expect(xdel).toHaveBeenCalledOnce();
    expect(valkey.zrem).toHaveBeenCalledOnce();
  });

  it('stops later cleanup phases after lease loss and cannot release a replacement owner lease', async () => {
    vi.useFakeTimers();
    try {
      let ownerToken = '';
      const acknowledged = Promise.withResolvers<void>();
      const set = vi.fn(async (_key: string, token: string, options: { conditionalSet: string }) => {
        expect(options.conditionalSet).toBe('onlyIfDoesNotExist');
        ownerToken = token;
        return 'OK';
      });
      const invokeScript = vi.fn(async (_script: unknown, options: { args: string[] }) => {
        if (options.args.length === 2) {
          ownerToken = 'replacement-owner';
          return 0;
        }
        if (ownerToken === options.args[0]) ownerToken = '';
        return 0;
      });
      const worker = createFlightWorkerService({} as never, { set, invokeScript } as never, {} as never, { process: vi.fn() }, {
        s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
      });
      worker.retryAcknowledgedDeletions = vi.fn(async () => acknowledged.promise);
      worker.cleanupAbandoned = vi.fn(async () => undefined);

      const pass = worker.runCleanupMaintenance();
      await vi.waitFor(() => expect(worker.retryAcknowledgedDeletions).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(5_000);
      acknowledged.resolve();
      await expect(pass).resolves.toBe(true);

      expect(worker.cleanupAbandoned).not.toHaveBeenCalled();
      expect(ownerToken).toBe('replacement-owner');
      expect(set).toHaveBeenCalledOnce();
      expect(invokeScript.mock.calls.some(([, options]) => (options as { args: string[] }).args.length === 2)).toBe(true);
      expect(invokeScript.mock.calls.at(-1)?.[1]).toMatchObject({ args: [expect.stringContaining('worker-1:')] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('serializes Lua lease renewals while cleanup remains active', async () => {
    vi.useFakeTimers();
    try {
      const cleanup = Promise.withResolvers<void>();
      const renewal = Promise.withResolvers<number>();
      let activeRenewals = 0;
      let maxActiveRenewals = 0;
      let renewalCalls = 0;
      const invokeScript = vi.fn(async (_script: unknown, options: { args: string[] }) => {
        if (options.args.length === 1) return 1;
        renewalCalls += 1;
        activeRenewals += 1;
        maxActiveRenewals = Math.max(maxActiveRenewals, activeRenewals);
        const result = await renewal.promise;
        activeRenewals -= 1;
        return result;
      });
      const valkey = { set: vi.fn(async () => 'OK'), invokeScript };
      const worker = createFlightWorkerService({} as never, valkey as never, {} as never, { process: vi.fn() }, {
        s3Client: { send: vi.fn() } as never, bucketName: 'flights', consumerName: 'worker-1',
      });
      worker.retryAcknowledgedDeletions = vi.fn(async () => undefined);
      worker.cleanupAbandoned = vi.fn(async () => cleanup.promise);

      const pass = worker.runCleanupMaintenance();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(renewalCalls).toBe(1);
      expect(maxActiveRenewals).toBe(1);
      renewal.resolve(1);
      cleanup.resolve();
      await expect(pass).resolves.toBe(true);
      expect(maxActiveRenewals).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
