import { describe, expect, it, vi } from 'vitest';
import {
  createFlightUploadQueueService,
  FLIGHT_JOB_STREAM,
  MAINTENANCE_BATCH_SIZE,
} from '../../src/services/flightUploadQueueService.js';

class FakeValkey {
  values = new Map<string, string>();
  sorted = new Map<string, Map<string, number>>();
  stream: Array<{ id: string; values: [string, string][] }> = [];
  getCalls = 0;
  getKeys: string[] = [];
  execCalls = 0;
  failNextExec = false;
  beforeZrange?: (key: string) => Promise<void>;
  beforeInvokeScript?: () => Promise<void>;
  beforeRemoveScript?: () => Promise<void>;
  zrangeCalls: Array<{ key: string; range: unknown }> = [];

  async get(key: string) { this.getCalls += 1; this.getKeys.push(key); return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); return 'OK'; }
  async del(keys: string[]) { for (const key of keys) this.values.delete(key); return keys.length; }
  async zcard(key: string) { return this.sorted.get(key)?.size ?? 0; }
  async zadd(key: string, values: Record<string, number>) {
    const set = this.sorted.get(key) ?? new Map<string, number>();
    for (const [member, score] of Object.entries(values)) set.set(member, score);
    this.sorted.set(key, set);
    return Object.keys(values).length;
  }
  async zrem(key: string, members: string[]) {
    const set = this.sorted.get(key);
    for (const member of members) set?.delete(member);
    return members.length;
  }
  async zrange(key: string, range: {
    start: number | string | { value: number; isInclusive?: boolean };
    end: number | string | { value: number; isInclusive?: boolean };
    type?: 'byScore';
    limit?: { offset: number; count: number };
  }) {
    this.zrangeCalls.push({ key, range });
    await this.beforeZrange?.(key);
    const entries = [...(this.sorted.get(key)?.entries() ?? [])].sort((a, b) => a[1] - b[1]);
    if (range.type === 'byScore') {
      const boundary = (value: typeof range.start, fallback: number) => typeof value === 'object' ? value.value : typeof value === 'number' ? value : fallback;
      const start = boundary(range.start, Number.NEGATIVE_INFINITY);
      const end = boundary(range.end, Number.POSITIVE_INFINITY);
      const matching = entries.filter(([, score]) => score >= start && score <= end).map(([member]) => member);
      return matching.slice(range.limit?.offset ?? 0, range.limit ? range.limit.offset + range.limit.count : undefined);
    }
    const values = entries.map(([member]) => member);
    const start = Number(range.start);
    const end = Number(range.end);
    return values.slice(start, end === -1 ? undefined : end + 1);
  }
  async xadd(_key: string, values: [string, string][]) {
    const id = `${this.stream.length + 1}-0`;
    this.stream.push({ id, values });
    return id;
  }
  async exec(batch: { commands: Array<{ requestType: number; argsArray: { args: Buffer[] } }> }) {
    this.execCalls += 1;
    if (this.failNextExec) {
      this.failNextExec = false;
      return null;
    }
    const values = new Map(this.values);
    const sorted = new Map([...this.sorted].map(([key, members]) => [key, new Map(members)]));
    const stream = [...this.stream];
    for (const command of batch.commands) {
      const args = command.argsArray.args.map(String);
      if (command.requestType === 1517) values.set(args[0]!, args[1]!);
      else if (command.requestType === 405) { /* expiry is intentionally not time-driven in this fake */ }
      else if (command.requestType === 402) for (const key of args) values.delete(key);
      else if (command.requestType === 1324) {
        const members = sorted.get(args[0]!);
        for (const member of args.slice(1)) members?.delete(member);
      } else if (command.requestType === 1304) {
        const members = sorted.get(args[0]!) ?? new Map<string, number>();
        for (let index = 1; index < args.length; index += 2) members.set(args[index + 1]!, Number(args[index]));
        sorted.set(args[0]!, members);
      } else if (command.requestType === 1402) {
        const id = `${stream.length + 1}-0`;
        const fields = args.slice(2);
        const entries: [string, string][] = [];
        for (let index = 0; index < fields.length; index += 2) entries.push([fields[index]!, fields[index + 1]!]);
        stream.push({ id, values: entries });
      } else throw new Error(`Unsupported fake transaction command ${command.requestType}`);
    }
    this.values = values;
    this.sorted = sorted;
    this.stream = stream;
    return [];
  }
  async invokeScript(_script: unknown, options: { keys: string[]; args: string[] }) {
    if (options.keys.length === 5 && options.args.length === 5 && options.args[3]?.startsWith('{')) {
      const [recordKey, userKey, statusKey, allKey, expiryKey] = options.keys;
      const [id, createdAt, expiresAt, raw, limit] = options.args;
      if ((this.sorted.get(userKey!)?.size ?? 0) >= Number(limit)) return 0;
      if (this.values.has(recordKey!)) return -1;
      this.values.set(recordKey!, raw!);
      for (const [key, score] of [[userKey, createdAt], [statusKey, createdAt], [allKey, createdAt], [expiryKey, expiresAt]]) {
        const members = this.sorted.get(key!) ?? new Map<string, number>();
        members.set(id!, Number(score));
        this.sorted.set(key!, members);
      }
      return 1;
    }
    if (options.keys[1] === FLIGHT_JOB_STREAM) {
      const [recordKey, , expiryKey, queuedKey, ...statusKeys] = options.keys;
      const [id, userId, updatedAt] = options.args;
      const raw = this.values.get(recordKey!);
      if (!raw) return 'missing';
      const job = JSON.parse(raw);
      if (job.userId !== userId) return 'forbidden';
      if (job.status !== 'uploading') return 'unchanged';
      job.status = 'queued';
      job.updatedAt = Number(updatedAt);
      this.values.set(recordKey!, JSON.stringify(job));
      for (const key of statusKeys) this.sorted.get(key)?.delete(id!);
      await this.zadd(queuedKey!, { [id!]: job.createdAt });
      this.sorted.get(expiryKey!)?.delete(id!);
      await this.xadd(FLIGHT_JOB_STREAM, [['jobId', id!]]);
      return 'queued';
    }
    if (options.keys[1]?.endsWith(':processing') && options.args.length === 3 && !options.args[2]?.startsWith('{')) {
      const [recordKey, processingKey, ...statusKeys] = options.keys;
      const [id, updatedAt, processingToken] = options.args;
      const raw = this.values.get(recordKey!);
      if (!raw) return null;
      const job = JSON.parse(raw);
      if (job.status !== 'queued') return null;
      job.status = 'processing';
      job.heartbeatAt = Number(updatedAt);
      job.updatedAt = Number(updatedAt);
      job.processingToken = processingToken;
      this.values.set(recordKey!, JSON.stringify(job));
      for (const key of statusKeys) this.sorted.get(key)?.delete(id!);
      await this.zadd(processingKey!, { [id!]: job.createdAt });
      return JSON.stringify(job);
    }
    if (options.args.length === 3 && options.args[2]?.startsWith('{')) {
      const [recordKey, targetKey, ...statusKeys] = options.keys;
      const [id, processingToken, updatedRaw] = options.args;
      const raw = this.values.get(recordKey!);
      if (!raw) return 0;
      const current = JSON.parse(raw);
      const updated = JSON.parse(updatedRaw!);
      const isClaimedWrite = current.status === 'processing';
      const isTerminalReconciliation = ['processing', 'failed', 'completed'].includes(current.status)
        && ['failed', 'completed'].includes(updated.status);
      if ((!isClaimedWrite && !isTerminalReconciliation) || current.processingToken !== processingToken || updated.processingToken !== processingToken) return 0;
      this.values.set(recordKey!, updatedRaw!);
      for (const key of statusKeys) this.sorted.get(key)?.delete(id!);
      await this.zadd(targetKey!, { [id!]: updated.createdAt });
      return 1;
    }
    if (options.args.length === 4 && options.args[3]?.startsWith('{')) {
      const [recordKey, targetKey, ...statusKeys] = options.keys;
      const [id, processingToken, cutoff, updatedRaw] = options.args;
      const raw = this.values.get(recordKey!);
      if (!raw) return 0;
      const current = JSON.parse(raw);
      const updated = JSON.parse(updatedRaw!);
      if (current.status !== 'processing' || current.processingToken !== processingToken || (current.heartbeatAt && current.heartbeatAt > Number(cutoff))) return 0;
      this.values.set(recordKey!, updatedRaw!);
      for (const key of statusKeys) this.sorted.get(key)?.delete(id!);
      await this.zadd(targetKey!, { [id!]: updated.createdAt });
      return 1;
    }
    if (options.args.length === 3 && options.keys[4]?.startsWith('glidehero:upload-removal:')) {
      await this.beforeRemoveScript?.();
      const [recordKey, userKey, allKey, expiryKey, cleanupKey, cleanupIndex, ...statusKeys] = options.keys;
      const [id, userId, removedAt] = options.args;
      const raw = this.values.get(recordKey!);
      if (!raw) return null;
      const current = JSON.parse(raw);
      if (current.status !== 'uploading' || current.userId !== userId) return null;
      this.values.delete(recordKey!);
      for (const key of [userKey, allKey, expiryKey, ...statusKeys]) this.sorted.get(key!)?.delete(id!);
      this.values.set(cleanupKey!, raw);
      await this.zadd(cleanupIndex!, { [id!]: Number(removedAt) });
      return raw;
    }
    const [recordKey, dispositionKey, ...remainingKeys] = options.keys;
    const [id, expectedStatus] = options.args;
    if (['completed', 'duplicate'].includes(expectedStatus!)) await this.beforeInvokeScript?.();
    const raw = this.values.get(recordKey!);
    if (!raw) return 0;
    const current = JSON.parse(raw);
    const retiring = ['completed', 'duplicate'].includes(expectedStatus!);
    if (retiring ? current.status !== expectedStatus : current.status !== 'failed' || current.userId !== expectedStatus) return 0;
    this.values.delete(recordKey!);
    this.values.set(dispositionKey!, retiring ? 'retired' : 'cleared');
    const indexKeys = retiring ? remainingKeys : remainingKeys.slice(3);
    if (!retiring) {
      const [cleanupKey, cleanupIndex, evidenceIndex] = remainingKeys;
      this.values.set(cleanupKey!, raw);
      await this.zadd(cleanupIndex!, { [id!]: Number(options.args[3]) });
      await this.zadd(evidenceIndex!, { [id!]: Number(options.args[3]) + Number(options.args[2]) * 1000 });
    }
    for (const key of indexKeys) this.sorted.get(key)?.delete(id!);
    return retiring ? 1 : raw;
  }
}

describe('FlightUploadQueueService', () => {
  it('atomically admits at most 1,000 uploads across concurrent tabs', async () => {
    const valkey = new FakeValkey();
    const existing = Object.fromEntries(Array.from({ length: 998 }, (_, index) => [`existing-${index}`, index]));
    await valkey.zadd('glidehero:user:user-1:uploads', existing);
    const options = {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    };
    const firstTab = createFlightUploadQueueService(valkey as never, options);
    const secondTab = createFlightUploadQueueService(valkey as never, options);

    const results = await Promise.allSettled([
      firstTab.createIntent({ userId: 'user-1', originalFilename: 'one.igc', contentType: '', byteSize: 10 }),
      secondTab.createIntent({ userId: 'user-1', originalFilename: 'two.igc', contentType: '', byteSize: 10 }),
      firstTab.createIntent({ userId: 'user-1', originalFilename: 'three.igc', contentType: '', byteSize: 10 }),
      secondTab.createIntent({ userId: 'user-1', originalFilename: 'four.igc', contentType: '', byteSize: 10 }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(2);
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) }),
      expect.objectContaining({ reason: expect.objectContaining({ status: 409 }) }),
    ]);
    expect(await valkey.zcard('glidehero:user:user-1:uploads')).toBe(1_000);
    expect((await firstTab.listJobs('user-1', { page: 1, pageSize: 10, status: 'uploading' })).total).toBe(2);
  });

  it('creates a private upload intent and queues it only after object verification', async () => {
    const valkey = new FakeValkey();
    const send = vi.fn(async () => ({ ContentLength: 128 }));
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send } as never,
      bucketName: 'flights',
      keyFactory: () => 'glidehero/uploads/user/flight.igc',
      presign: vi.fn(async () => 'https://objects.example.test/signed'),
    });

    const intent = await service.createIntent({
      userId: 'user-1', originalFilename: 'flight.igc', contentType: 'application/octet-stream', byteSize: 128,
    });
    expect(intent.uploadUrl).toBe('https://objects.example.test/signed');
    expect(valkey.stream).toHaveLength(0);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 100 })).jobs[0]).toMatchObject({ status: 'uploading' });

    await service.complete({ userId: 'user-1', id: intent.id });
    expect(send).toHaveBeenCalledOnce();
    expect(valkey.stream).toEqual([{ id: '1-0', values: [['jobId', intent.id]] }]);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 100 })).jobs[0]).toMatchObject({ status: 'queued' });
    valkey.getCalls = 0;
    expect(await service.progress('user-1')).toMatchObject({ total: 1, queued: 1 });
    expect(valkey.getCalls).toBe(0);
  });

  it('atomically enqueues exactly once when completion requests race', async () => {
    const valkey = new FakeValkey();
    let headCalls = 0;
    let releaseHeads!: () => void;
    const bothHeads = new Promise<void>((resolve) => { releaseHeads = resolve; });
    const send = vi.fn(async () => {
      headCalls += 1;
      if (headCalls === 2) releaseHeads();
      await bothHeads;
      return { ContentLength: 128 };
    });
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send } as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({
      userId: 'user-1', originalFilename: 'flight.igc', contentType: 'application/octet-stream', byteSize: 128,
    });

    await Promise.all([
      service.complete({ userId: 'user-1', id: intent.id }),
      service.complete({ userId: 'user-1', id: intent.id }),
    ]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(valkey.stream).toEqual([{ id: '1-0', values: [['jobId', intent.id]] }]);
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'queued' });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, queued: 1, processing: 0, finished: 0 });
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'uploading' })).total).toBe(0);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'queued' })).total).toBe(1);
  });

  it('allows only one competing worker claim and keeps status indexes coherent', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send: vi.fn(async () => ({ ContentLength: 10 })) } as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'flight.igc', contentType: '', byteSize: 10 });
    await service.complete({ userId: 'user-1', id: intent.id });

    const claims = await Promise.all([service.claimJob(intent.id), service.claimJob(intent.id)]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ status: 'processing' });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, queued: 0, processing: 1, finished: 0 });
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'queued' })).total).toBe(0);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'processing' })).total).toBe(1);
  });

  it('rejects invalid file names and sizes before creating storage state', async () => {
    const service = createFlightUploadQueueService(new FakeValkey() as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    await expect(service.createIntent({ userId: 'user-1', originalFilename: 'track.txt', contentType: 'text/plain', byteSize: 10 })).rejects.toThrow('Choose an IGC file');
    await expect(service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: 'text/plain', byteSize: 10 * 1024 * 1024 + 1 })).rejects.toThrow('10 MB');
  });

  it('cancels an unfinished browser upload without queueing it', async () => {
    const valkey = new FakeValkey();
    const send = vi.fn(async () => ({}));
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send } as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: '', byteSize: 10 });

    expect(await service.cancel({ userId: 'user-1', id: intent.id })).toBe(true);

    expect(send).toHaveBeenCalledOnce();
    expect(valkey.stream).toHaveLength(0);
    expect(await service.progress('user-1')).toMatchObject({ total: 0 });
    expect(await service.pendingRemovals()).toEqual([]);
  });

  it('retains a durable removal tombstone when cancelled object deletion fails', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send: vi.fn(async () => { throw new Error('S3 unavailable'); }) } as never,
      bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: '', byteSize: 10 });

    expect(await service.cancel({ userId: 'user-1', id: intent.id })).toBe(true);

    expect(await service.getJob(intent.id)).toBeNull();
    expect(await service.progress('user-1')).toMatchObject({ total: 0 });
    expect(await service.pendingRemovals()).toEqual([expect.objectContaining({ id: intent.id, bucketKey: expect.any(String) })]);
    await service.finalizeRemoval(intent.id);
    expect(await service.pendingRemovals()).toEqual([]);
  });

  it('does not enqueue when cancellation atomically removes an upload during completion verification', async () => {
    const valkey = new FakeValkey();
    let releaseHead!: () => void;
    let headStarted!: () => void;
    const headGate = new Promise<void>((resolve) => { releaseHead = resolve; });
    const started = new Promise<void>((resolve) => { headStarted = resolve; });
    const send = vi.fn(async (command: object) => {
      if (command.constructor.name === 'HeadObjectCommand') {
        headStarted();
        await headGate;
        return { ContentLength: 10 };
      }
      return {};
    });
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send } as never, bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'flight.igc', contentType: '', byteSize: 10 });

    const completing = service.complete({ userId: 'user-1', id: intent.id });
    await started;
    await service.cancel({ userId: 'user-1', id: intent.id });
    releaseHead();

    await expect(completing).rejects.toThrow('Upload not found');
    expect(valkey.stream).toHaveLength(0);
    expect(await service.getJob(intent.id)).toBeNull();
    expect(send.mock.calls.filter(([command]) => command.constructor.name === 'DeleteObjectCommand')).toHaveLength(1);
  });

  it('does not delete the object when completion atomically wins against cancellation', async () => {
    const valkey = new FakeValkey();
    let releaseRemove!: () => void;
    let removeStarted!: () => void;
    const removeGate = new Promise<void>((resolve) => { releaseRemove = resolve; });
    const started = new Promise<void>((resolve) => { removeStarted = resolve; });
    valkey.beforeRemoveScript = async () => {
      removeStarted();
      await removeGate;
    };
    const send = vi.fn(async () => ({ ContentLength: 10 }));
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send } as never, bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'flight.igc', contentType: '', byteSize: 10 });

    const cancelling = service.cancel({ userId: 'user-1', id: intent.id });
    await started;
    await service.complete({ userId: 'user-1', id: intent.id });
    releaseRemove();
    expect(await cancelling).toBe(false);

    expect(valkey.stream).toHaveLength(1);
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'queued' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports a no-op cancellation after completion already queued the upload', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send: vi.fn(async () => ({ ContentLength: 10 })) } as never,
      bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'flight.igc', contentType: '', byteSize: 10 });
    await service.complete({ userId: 'user-1', id: intent.id });

    expect(await service.cancel({ userId: 'user-1', id: intent.id })).toBe(false);
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'queued' });
    expect(valkey.stream).toHaveLength(1);
  });

  it('rejects stale-token terminal writes and stale recovery after a fresh heartbeat', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send: vi.fn(async () => ({ ContentLength: 10 })) } as never,
      bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'flight.igc', contentType: '', byteSize: 10 });
    await service.complete({ userId: 'user-1', id: intent.id });
    const claimed = await service.claimJob(intent.id);
    const staleCopy = { ...claimed!, status: 'completed' as const, processingToken: 'old-token', updatedAt: Date.now() };
    expect(await service.saveClaimedJob(staleCopy)).toBe(false);

    const fresh = { ...claimed!, heartbeatAt: Date.now(), updatedAt: Date.now() };
    expect(await service.saveClaimedJob(fresh)).toBe(true);
    const failed = { ...fresh, status: 'failed' as const, error: 'stale', updatedAt: Date.now() + 1 };
    expect(await service.failStaleJob(failed, fresh.heartbeatAt! - 1)).toBe(false);
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'processing', processingToken: claimed!.processingToken });
  });

  it('reconciles a reserved queue failure back to the database completion winner', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: { send: vi.fn(async () => ({ ContentLength: 10 })) } as never,
      bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'flight.igc', contentType: '', byteSize: 10 });
    await service.complete({ userId: 'user-1', id: intent.id });
    const claimed = await service.claimJob(intent.id);
    const failed = { ...claimed!, status: 'failed' as const, error: 'stale', updatedAt: Date.now() };
    expect(await service.failStaleJob(failed, Date.now())).toBe(true);

    expect(await service.reconcileTerminalJob({
      ...failed, status: 'completed', flightId: 'flight-1', error: undefined, updatedAt: Date.now() + 1,
    })).toBe(true);

    expect(await service.getJob(intent.id)).toMatchObject({ status: 'completed', flightId: 'flight-1' });
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'failed' })).total).toBe(0);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'completed' })).total).toBe(1);
  });

  it('keeps failed progress but releases an all-success workload', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const first = await service.createIntent({ userId: 'user-1', originalFilename: 'one.igc', contentType: '', byteSize: 10 });
    const job = await service.getJob(first.id);
    await service.saveJob({ ...job!, status: 'completed', updatedAt: Date.now() });
    expect(await service.progress('user-1')).toMatchObject({ total: 0, failed: 0 });
    expect(await service.getDisposition(first.id)).toBe('retired');

    const second = await service.createIntent({ userId: 'user-1', originalFilename: 'two.igc', contentType: '', byteSize: 10 });
    const failed = await service.getJob(second.id);
    await service.saveJob({ ...failed!, status: 'failed', error: 'bad track', updatedAt: Date.now() });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, finished: 1, failed: 1 });
    expect((await service.listJobs('user-1', { page: 1, pageSize: 100, status: 'failed' })).jobs).toEqual([
      expect.objectContaining({ id: second.id, status: 'failed', error: 'bad track' }),
    ]);
    expect(await service.clearJobs('user-1', [second.id])).toEqual([second.id]);
    expect(await service.getDisposition(second.id)).toBe('cleared');
    expect(await service.getJob(second.id)).toBeNull();
    expect(await service.pendingFailedCleanups()).toEqual([expect.objectContaining({ id: second.id, bucketKey: failed!.bucketKey })]);
    await service.finalizeFailedCleanup(second.id);
    expect(await service.pendingFailedCleanups()).toEqual([]);
    expect(await service.getClearedJob(second.id)).toMatchObject({ id: second.id, bucketKey: failed!.bucketKey });
    expect(await service.retainedClearedJobs()).toEqual([expect.objectContaining({ id: second.id, bucketKey: failed!.bucketKey })]);
    await expect(service.createIntent({ userId: 'user-1', originalFilename: 'two.igc', contentType: '', byteSize: 10 })).resolves.toEqual({
      id: expect.any(String), uploadUrl: 'signed',
    });
  });

  it('clears eligible failed jobs individually without losing other results', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never, bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });
    const first = await service.createIntent({ userId: 'user-1', originalFilename: 'one.igc', contentType: '', byteSize: 10 });
    const second = await service.createIntent({ userId: 'user-1', originalFilename: 'two.igc', contentType: '', byteSize: 10 });
    const ineligible = await service.createIntent({ userId: 'user-1', originalFilename: 'three.igc', contentType: '', byteSize: 10 });
    await service.saveJob({ ...(await service.getJob(first.id))!, status: 'failed', error: 'one', updatedAt: Date.now() });
    await service.saveJob({ ...(await service.getJob(second.id))!, status: 'failed', error: 'two', updatedAt: Date.now() });

    expect(await service.clearJobs('user-1', [first.id, ineligible.id, second.id])).toEqual([first.id, second.id]);
    expect((await service.pendingFailedCleanups()).map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(await service.getJob(ineligible.id)).toMatchObject({ status: 'uploading' });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, failed: 0 });
  });

  it('paginates job details separately from aggregate progress', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    await service.createIntent({ userId: 'user-1', originalFilename: 'one.igc', contentType: '', byteSize: 10 });
    await service.createIntent({ userId: 'user-1', originalFilename: 'two.igc', contentType: '', byteSize: 10 });

    valkey.getCalls = 0;
    expect(await service.progress('user-1')).toMatchObject({ total: 2 });
    expect(valkey.getCalls).toBe(0);
    expect(await service.listJobs('user-1', { page: 2, pageSize: 1 })).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(valkey.getCalls).toBe(1);
    expect(await service.listJobs('user-1', { page: 99, pageSize: 1 })).toMatchObject({ total: 2, page: 2, pageSize: 1 });
  });

  it('does not delete an upload created while successful jobs are being cleared', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const completed = await service.createIntent({ userId: 'user-1', originalFilename: 'done.igc', contentType: '', byteSize: 10 });
    const completedJob = await service.getJob(completed.id);
    await service.saveJob({ ...completedJob!, status: 'completed', updatedAt: Date.now() });
    let concurrentId: string | undefined;
    valkey.beforeZrange = async (key) => {
      if (!key.endsWith(':completed') || concurrentId) return;
      concurrentId = (await service.createIntent({ userId: 'user-1', originalFilename: 'new.igc', contentType: '', byteSize: 10 })).id;
    };

    expect(await service.progress('user-1')).toMatchObject({ total: 0 });
    expect(await service.getJob(concurrentId!)).toMatchObject({ status: 'uploading' });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, finished: 0 });
  });

  it('does not drift the status index when an atomic status transition fails', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: '', byteSize: 10 });
    const job = await service.getJob(intent.id);
    valkey.failNextExec = true;

    await expect(service.saveJob({ ...job!, status: 'completed', updatedAt: Date.now() })).rejects.toThrow('atomically save');
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'uploading' });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, finished: 0 });
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'completed' })).total).toBe(0);
  });

  it('keeps a job in exactly one status index after competing transitions', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: '', byteSize: 10 });
    const job = await service.getJob(intent.id);

    await Promise.all([
      service.saveJob({ ...job!, status: 'completed', updatedAt: Date.now() }),
      service.saveJob({ ...job!, status: 'failed', error: 'competing failure', updatedAt: Date.now() + 1 }),
    ]);

    const indexedStatuses = [];
    for (const status of ['uploading', 'queued', 'processing', 'completed', 'duplicate', 'failed'] as const) {
      const page = await service.listJobs('user-1', { page: 1, pageSize: 10, status });
      if (page.jobs.some((item) => item.id === intent.id)) indexedStatuses.push(status);
    }
    const stored = await service.getJob(intent.id);
    const progress = await service.progress('user-1');
    expect(indexedStatuses).toEqual([stored!.status]);
    expect(progress.finished).toBeLessThanOrEqual(progress.total);
    expect(progress).toMatchObject({ total: 1, finished: 1 });
  });

  it('does not retire a job that changes to failed before conditional cleanup', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: '', byteSize: 10 });
    const job = await service.getJob(intent.id);
    const completed = { ...job!, status: 'completed' as const, updatedAt: Date.now() };
    await service.saveJob(completed);
    let transitioned = false;
    valkey.beforeInvokeScript = async () => {
      if (transitioned) return;
      transitioned = true;
      await service.saveJob({ ...completed, status: 'failed', error: 'late failure', updatedAt: Date.now() + 1 });
    };

    expect(await service.progress('user-1')).toMatchObject({ total: 1, finished: 1, failed: 1 });
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'failed' });
    expect((await service.allJobIds())).toContain(intent.id);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10, status: 'failed' })).jobs).toHaveLength(1);
  });

  it('restores all base and status indexes when a job is legitimately saved after retirement', async () => {
    const valkey = new FakeValkey();
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });
    const intent = await service.createIntent({ userId: 'user-1', originalFilename: 'track.igc', contentType: '', byteSize: 10 });
    const job = await service.getJob(intent.id);
    const completed = { ...job!, status: 'completed' as const, updatedAt: Date.now() };
    await service.saveJob(completed);
    expect(await service.progress('user-1')).toMatchObject({ total: 0 });
    expect(await service.getJob(intent.id)).toBeNull();

    await service.saveJob({ ...completed, status: 'failed', error: 'post-cleanup failure', updatedAt: Date.now() + 1 });
    expect(await service.progress('user-1')).toMatchObject({ total: 1, finished: 1, failed: 1 });
    expect(await service.getJob(intent.id)).toMatchObject({ status: 'failed' });
    expect(await service.allJobIds()).toContain(intent.id);
    expect((await service.listJobs('user-1', { page: 1, pageSize: 10 })).jobs).toHaveLength(1);
  });

  it('discovers only expired intents by score in a bounded pass without reading job records', async () => {
    const valkey = new FakeValkey();
    const now = 50_000;
    const expirations = Object.fromEntries([
      ...Array.from({ length: MAINTENANCE_BATCH_SIZE + 20 }, (_, index) => [`expired-${index}`, now - 1_000 + index]),
      ['not-expired', now + 1],
    ]);
    await valkey.zadd('glidehero:upload-expiry', expirations);
    for (let index = 0; index < MAINTENANCE_BATCH_SIZE + 20; index += 1) {
      valkey.values.set(`glidehero:upload:expired-${index}`, JSON.stringify({
        id: `expired-${index}`, userId: 'user-1', bucketKey: `uploads/${index}`, status: 'uploading',
      }));
    }
    valkey.values.set('glidehero:upload:not-expired', JSON.stringify({
      id: 'not-expired', userId: 'user-1', bucketKey: 'uploads/not-expired', status: 'uploading',
    }));
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });

    const ids = await service.expiredIntentIds(now);

    expect(ids).toHaveLength(MAINTENANCE_BATCH_SIZE);
    expect(ids).not.toContain('not-expired');
    expect(valkey.getCalls).toBe(MAINTENANCE_BATCH_SIZE);
    expect(valkey.getKeys).not.toContain('glidehero:upload:not-expired');
    expect(valkey.zrangeCalls.at(-1)).toEqual({
      key: 'glidehero:upload-expiry',
      range: expect.objectContaining({
        type: 'byScore',
        end: { value: now, isInclusive: true },
        limit: { offset: 0, count: MAINTENANCE_BATCH_SIZE },
      }),
    });
  });

  it('bounds tombstone and retained-evidence discovery passes', async () => {
    const valkey = new FakeValkey();
    for (let index = 0; index < MAINTENANCE_BATCH_SIZE + 5; index += 1) {
      const id = `cleanup-${index}`;
      const raw = JSON.stringify({
        id, userId: 'user-1', originalFilename: `${id}.igc`, contentType: '', byteSize: 1,
        bucketKey: `uploads/${id}`, status: 'failed', createdAt: index, updatedAt: index,
      });
      valkey.values.set(`glidehero:failed-upload-cleanup:${id}`, raw);
      await valkey.zadd('glidehero:failed-upload-cleanups', { [id]: index });
      await valkey.zadd('glidehero:cleared-upload-evidence', { [id]: index });
      valkey.values.set(`glidehero:upload-removal:${id}`, raw);
      await valkey.zadd('glidehero:upload-removals', { [id]: index });
    }
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never,
      bucketName: 'flights',
      presign: vi.fn(async () => 'signed'),
    });

    expect(await service.pendingFailedCleanups()).toHaveLength(MAINTENANCE_BATCH_SIZE);
    expect(await service.retainedClearedJobs()).toHaveLength(MAINTENANCE_BATCH_SIZE);
    expect(await service.pendingRemovals()).toHaveLength(MAINTENANCE_BATCH_SIZE);
    expect(valkey.zrangeCalls.slice(-3).map(({ range }) => range)).toEqual([
      { start: 0, end: MAINTENANCE_BATCH_SIZE - 1 },
      { start: 0, end: MAINTENANCE_BATCH_SIZE - 1 },
      { start: 0, end: MAINTENANCE_BATCH_SIZE - 1 },
    ]);
  });

  it('prunes a full poison expiry page so a later valid expired intent becomes discoverable', async () => {
    const valkey = new FakeValkey();
    for (let index = 0; index < MAINTENANCE_BATCH_SIZE; index += 1) {
      await valkey.zadd('glidehero:upload-expiry', { [`poison-${index}`]: index });
      if (index % 2 === 0) {
        valkey.values.set(`glidehero:upload:poison-${index}`, JSON.stringify({
          id: `poison-${index}`, userId: 'user-1', bucketKey: `uploads/poison-${index}`, status: 'queued',
        }));
      }
    }
    await valkey.zadd('glidehero:upload-expiry', { valid: MAINTENANCE_BATCH_SIZE });
    valkey.values.set('glidehero:upload:valid', JSON.stringify({
      id: 'valid', userId: 'user-1', bucketKey: 'uploads/valid', status: 'uploading',
    }));
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never, bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });

    expect(await service.expiredIntentIds(1_000)).toEqual([]);
    expect(await service.expiredIntentIds(1_000)).toEqual(['valid']);
    expect(await valkey.zcard('glidehero:upload-expiry')).toBe(1);
  });

  it('prunes malformed tombstones individually and returns the remaining valid records', async () => {
    const valkey = new FakeValkey();
    await valkey.zadd('glidehero:failed-upload-cleanups', { malformed: 1, valid: 2 });
    valkey.values.set('glidehero:failed-upload-cleanup:malformed', '{not-json');
    valkey.values.set('glidehero:failed-upload-cleanup:valid', JSON.stringify({
      id: 'valid', userId: 'user-1', bucketKey: 'uploads/valid', status: 'failed',
    }));
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never, bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });

    expect(await service.pendingFailedCleanups()).toEqual([expect.objectContaining({ id: 'valid' })]);
    expect(await valkey.zcard('glidehero:failed-upload-cleanups')).toBe(1);
  });

  it('rotates failed maintenance records so persistent failures cannot starve later work', async () => {
    const valkey = new FakeValkey();
    for (let index = 0; index <= MAINTENANCE_BATCH_SIZE; index += 1) {
      const id = `failure-${String(index).padStart(3, '0')}`;
      await valkey.zadd('glidehero:upload-removals', { [id]: index });
      valkey.values.set(`glidehero:upload-removal:${id}`, JSON.stringify({
        id, userId: 'user-1', bucketKey: `uploads/${id}`, status: 'uploading',
      }));
    }
    const service = createFlightUploadQueueService(valkey as never, {
      s3Client: {} as never, bucketName: 'flights', presign: vi.fn(async () => 'signed'),
    });

    expect(await service.pendingRemovals()).toHaveLength(MAINTENANCE_BATCH_SIZE);
    expect((await service.pendingRemovals()).map(({ id }) => id)).toContain('failure-100');
  });
});
