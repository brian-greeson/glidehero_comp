import type { FlightWorkerService } from './flightWorkerService.js';

export const DEFAULT_WORKER_SHUTDOWN_DEADLINE_MS = 8_000;

export type WorkerRuntimeOutcome = 'stopped' | 'deadline-exceeded';

interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

interface WorkerRuntimeOptions {
  worker: Pick<FlightWorkerService, 'run'>;
  valkey: { close(): void };
  streamReader?: { close(): void };
  pool: { end(): Promise<void> };
  signalSource?: SignalSource;
  shutdownDeadlineMs?: number;
}

type RunOutcome = { status: 'resolved' } | { status: 'rejected'; error: unknown };

/**
 * Owns the worker process lifecycle. A first termination signal stops the read
 * loop; repeated signals remain idempotent. Dependencies close only after the
 * current read, job, or maintenance operation has settled. The same deadline
 * also bounds dependency closing. If any lifecycle work exceeds it, the caller
 * is expected to terminate the process so stale-job recovery can fence and
 * settle any abandoned claim.
 */
export async function runFlightWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntimeOutcome> {
  const signalSource = options.signalSource ?? process;
  const controller = new AbortController();
  let shutdownRequested = false;
  let notifyShutdown!: () => void;
  const shutdown = new Promise<void>((resolve) => { notifyShutdown = resolve; });
  const requestShutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    controller.abort();
    notifyShutdown();
  };

  signalSource.on('SIGTERM', requestShutdown);
  signalSource.on('SIGINT', requestShutdown);

  // Convert rejection into data immediately so a signal/deadline race can
  // never leave the run loop with an unhandled rejection.
  const runOutcome: Promise<RunOutcome> = Promise.resolve().then(() => options.worker.run(controller.signal)).then(
    () => ({ status: 'resolved' }),
    (error: unknown) => ({ status: 'rejected', error }),
  );

  try {
    const lifecycle = (async () => {
      const outcome = await runOutcome;
      let closeError: unknown;
      try {
        options.streamReader?.close();
      } catch (error) {
        closeError = error;
      }
      try {
        options.valkey.close();
      } catch (error) {
        closeError ??= error;
      }
      try {
        await options.pool.end();
      } catch (error) {
        closeError ??= error;
      }
      if (outcome.status === 'rejected') throw outcome.error;
      if (closeError) throw closeError;
    })().then(
      () => ({ kind: 'stopped' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );

    let deadlineTimer: NodeJS.Timeout | undefined;
    const deadline = shutdown.then(() => new Promise<{ kind: 'deadline' }>((resolve) => {
      deadlineTimer = setTimeout(
        () => resolve({ kind: 'deadline' }),
        Math.max(0, options.shutdownDeadlineMs ?? DEFAULT_WORKER_SHUTDOWN_DEADLINE_MS),
      );
    }));
    const result = await Promise.race([lifecycle, deadline]);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (result.kind === 'deadline') return 'deadline-exceeded';
    if (result.kind === 'rejected') throw result.error;
    return 'stopped';
  } finally {
    signalSource.off('SIGTERM', requestShutdown);
    signalSource.off('SIGINT', requestShutdown);
  }
}
