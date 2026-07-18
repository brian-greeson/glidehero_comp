import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFlightWorkerRuntime } from '../../src/services/flightWorkerRuntime.js';

describe('FlightWorkerRuntime', () => {
  afterEach(() => vi.useRealTimers());

  it('lets active processing settle before closing Valkey and PostgreSQL', async () => {
    const signals = new EventEmitter();
    const active = Promise.withResolvers<void>();
    const events: string[] = [];
    const worker = {
      run: vi.fn(async (signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        await active.promise;
        events.push('worker settled');
      }),
    };
    const valkey = { close: vi.fn(() => { events.push('valkey closed'); }) };
    const pool = { end: vi.fn(async () => { events.push('pool closed'); }) };

    const running = runFlightWorkerRuntime({ worker, valkey, pool, signalSource: signals });
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    signals.emit('SIGTERM');
    await Promise.resolve();
    expect(valkey.close).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();

    active.resolve();
    await expect(running).resolves.toBe('stopped');
    expect(events).toEqual(['worker settled', 'valkey closed', 'pool closed']);
  });

  it('treats repeated termination signals as one idempotent shutdown', async () => {
    const signals = new EventEmitter();
    const stopped = Promise.withResolvers<void>();
    let aborts = 0;
    const worker = {
      run: vi.fn(async (signal: AbortSignal) => {
        signal.addEventListener('abort', () => {
          aborts += 1;
          stopped.resolve();
        }, { once: true });
        await stopped.promise;
      }),
    };
    const valkey = { close: vi.fn() };
    const pool = { end: vi.fn(async () => undefined) };

    const running = runFlightWorkerRuntime({ worker, valkey, pool, signalSource: signals });
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    signals.emit('SIGINT');

    await expect(running).resolves.toBe('stopped');
    expect(aborts).toBe(1);
    expect(valkey.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });

  it('closes the dedicated stream reader during shutdown', async () => {
    const signals = new EventEmitter();
    const stopped = Promise.withResolvers<void>();
    const worker = {
      run: vi.fn(async (signal: AbortSignal) => {
        signal.addEventListener('abort', () => stopped.resolve(), { once: true });
        await stopped.promise;
      }),
    };
    const valkey = { close: vi.fn() };
    const streamReader = { close: vi.fn() };
    const pool = { end: vi.fn(async () => undefined) };

    const running = runFlightWorkerRuntime({ worker, valkey, streamReader, pool, signalSource: signals });
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    signals.emit('SIGTERM');

    await expect(running).resolves.toBe('stopped');
    expect(streamReader.close).toHaveBeenCalledOnce();
    expect(valkey.close).toHaveBeenCalledOnce();
  });

  it('returns predictably at the shutdown deadline without closing active dependencies', async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    const active = Promise.withResolvers<void>();
    const worker = { run: vi.fn(async () => active.promise) };
    const valkey = { close: vi.fn() };
    const pool = { end: vi.fn(async () => undefined) };

    const running = runFlightWorkerRuntime({
      worker,
      valkey,
      pool,
      signalSource: signals,
      shutdownDeadlineMs: 250,
    });
    signals.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(250);

    await expect(running).resolves.toBe('deadline-exceeded');
    expect(valkey.close).not.toHaveBeenCalled();
    expect(pool.end).not.toHaveBeenCalled();
    expect(signals.listenerCount('SIGTERM')).toBe(0);

    // The guarded run promise may settle after the runtime returns without
    // producing an unhandled rejection.
    active.reject(new Error('process terminated'));
    await Promise.resolve();
  });

  it('bounds dependency closing with the same graceful shutdown deadline', async () => {
    vi.useFakeTimers();
    const signals = new EventEmitter();
    const stopped = Promise.withResolvers<void>();
    const hangingClose = Promise.withResolvers<void>();
    const worker = {
      run: vi.fn(async (signal: AbortSignal) => {
        signal.addEventListener('abort', () => stopped.resolve(), { once: true });
        await stopped.promise;
      }),
    };
    const valkey = { close: vi.fn() };
    const pool = { end: vi.fn(async () => hangingClose.promise) };

    const running = runFlightWorkerRuntime({
      worker,
      valkey,
      pool,
      signalSource: signals,
      shutdownDeadlineMs: 250,
    });
    await vi.waitFor(() => expect(worker.run).toHaveBeenCalledOnce());
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    await vi.advanceTimersByTimeAsync(250);

    await expect(running).resolves.toBe('deadline-exceeded');
    expect(valkey.close).toHaveBeenCalledOnce();
    expect(pool.end).toHaveBeenCalledOnce();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
    hangingClose.resolve();
  });
});
