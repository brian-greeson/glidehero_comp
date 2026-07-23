import { TimeUnit, type GlideClient } from '@valkey/valkey-glide';

export const WORKER_CONTROL_KEY = 'glidehero:worker-control';
export const WORKER_STATUS_INDEX_KEY = 'glidehero:worker-statuses';
export const WORKER_STATUS_TTL_SECONDS = 30;

export type WorkerControlState = 'running' | 'paused';
export type WorkerLiveState = 'starting' | 'idle' | 'processing' | 'paused' | 'stopping';

export type WorkerLiveStatus = {
  workerId: string;
  state: WorkerLiveState;
  currentJobId?: string;
  heartbeatAt: number;
  processedCount: number;
  failedCount: number;
  lastError?: string;
};

export interface WorkerControlService {
  getState(): Promise<WorkerControlState>;
  setState(state: WorkerControlState): Promise<void>;
  initialize(): Promise<void>;
  publishStatus(status: WorkerLiveStatus): Promise<void>;
  getStatus(workerId: string): Promise<WorkerLiveStatus | null>;
  listStatuses(): Promise<WorkerLiveStatus[]>;
  clearStatus(workerId: string): Promise<void>;
}

const statusKey = (workerId: string) => `glidehero:worker-status:${workerId}`;

function decode(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string'
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value).toString()
      : String(value);
}

function parseStatus(raw: unknown): WorkerLiveStatus | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decode(raw)!);
    if (
      !parsed
      || typeof parsed.workerId !== 'string'
      || typeof parsed.state !== 'string'
      || typeof parsed.heartbeatAt !== 'number'
      || !Number.isInteger(parsed.processedCount)
      || parsed.processedCount < 0
      || !Number.isInteger(parsed.failedCount)
      || parsed.failedCount < 0
      || (parsed.lastError !== undefined && typeof parsed.lastError !== 'string')
    ) return null;
    return parsed as WorkerLiveStatus;
  } catch {
    return null;
  }
}

export function createWorkerControlService(
  valkey: Pick<GlideClient, 'get' | 'set' | 'del' | 'zadd' | 'zrange' | 'zrem'>,
): WorkerControlService {
  return {
    async getState() {
      return decode(await valkey.get(WORKER_CONTROL_KEY)) === 'paused' ? 'paused' : 'running';
    },

    async setState(state) {
      await valkey.set(WORKER_CONTROL_KEY, state);
    },

    // Worker startup owns the current-only control state. An admin pause must
    // be reapplied after all workers have been restarted.
    async initialize() {
      await valkey.set(WORKER_CONTROL_KEY, 'running');
    },

    async publishStatus(status) {
      await valkey.set(statusKey(status.workerId), JSON.stringify(status), {
        expiry: { type: TimeUnit.Seconds, count: WORKER_STATUS_TTL_SECONDS },
      });
      await valkey.zadd(WORKER_STATUS_INDEX_KEY, { [status.workerId]: status.heartbeatAt });
    },

    async getStatus(workerId) {
      return parseStatus(await valkey.get(statusKey(workerId)));
    },

    async listStatuses() {
      const workerIds = (await valkey.zrange(WORKER_STATUS_INDEX_KEY, { start: 0, end: -1 })).map(String);
      const statuses = await Promise.all(workerIds.map(async (workerId) => ({
        workerId,
        status: parseStatus(await valkey.get(statusKey(workerId))),
      })));
      const staleWorkerIds = statuses.filter(({ status }) => !status).map(({ workerId }) => workerId);
      if (staleWorkerIds.length > 0) await valkey.zrem(WORKER_STATUS_INDEX_KEY, staleWorkerIds);
      return statuses.flatMap(({ status }) => status ? [status] : []);
    },

    async clearStatus(workerId) {
      await valkey.del([statusKey(workerId)]);
      await valkey.zrem(WORKER_STATUS_INDEX_KEY, [workerId]);
    },
  };
}
