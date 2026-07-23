import { describe, expect, it } from 'vitest';
import {
  createWorkerControlService,
  WORKER_CONTROL_KEY,
  WORKER_STATUS_TTL_SECONDS,
} from '../../src/services/workerControlService.js';

class FakeValkey {
  values = new Map<string, string>();
  statuses = new Map<string, number>();
  expiries: Array<{ key: string; seconds: number }> = [];
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, options?: { expiry?: { count: number } }) {
    this.values.set(key, value);
    if (options?.expiry) this.expiries.push({ key, seconds: options.expiry.count });
    return 'OK';
  }
  async del(keys: string[]) { for (const key of keys) this.values.delete(key); return keys.length; }
  async zadd(_key: string, values: Record<string, number>) {
    for (const [workerId, heartbeatAt] of Object.entries(values)) this.statuses.set(workerId, heartbeatAt);
    return Object.keys(values).length;
  }
  async zrange() { return [...this.statuses.keys()]; }
  async zrem(_key: string, workerIds: string[]) { for (const workerId of workerIds) this.statuses.delete(workerId); return workerIds.length; }
}

describe('WorkerControlService', () => {
  it('defaults to running and resets current-only state on startup', async () => {
    const valkey = new FakeValkey();
    const service = createWorkerControlService(valkey as never);
    await expect(service.getState()).resolves.toBe('running');
    await service.setState('paused');
    await service.initialize();
    await expect(service.getState()).resolves.toBe('running');
    expect(valkey.values.get(WORKER_CONTROL_KEY)).toBe('running');
  });

  it('publishes live status with a TTL and removes stale index entries', async () => {
    const valkey = new FakeValkey();
    const service = createWorkerControlService(valkey as never);
    const status = {
      workerId: 'worker-1', state: 'processing' as const, currentJobId: 'job-1', heartbeatAt: 1_000,
      processedCount: 3, failedCount: 1, lastError: 'temporary read failure',
    };
    await service.publishStatus(status);
    await expect(service.getStatus('worker-1')).resolves.toEqual(status);
    await expect(service.listStatuses()).resolves.toEqual([status]);
    expect(valkey.expiries).toEqual([{ key: 'glidehero:worker-status:worker-1', seconds: WORKER_STATUS_TTL_SECONDS }]);
    valkey.statuses.set('expired-worker', 1);
    await expect(service.listStatuses()).resolves.toEqual([status]);
    expect(valkey.statuses.has('expired-worker')).toBe(false);
  });
});
