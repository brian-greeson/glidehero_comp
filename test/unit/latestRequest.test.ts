import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { createLatestRequest } from '../../public/scripts/latestRequest.js';

describe('Latest request coordination', () => {
  it('aborts the previous request and marks only the newest request current', async () => {
    const pending: Array<() => void> = [];
    const observations: Array<{ value: string; current: boolean }> = [];
    const request = createLatestRequest(async ({ isCurrent }: any, value: string) => {
      await new Promise<void>((resolve) => pending.push(resolve));
      observations.push({ value, current: isCurrent() });
    });

    const first = request.run('first');
    const second = request.run('second');
    pending[1]!();
    await second;
    pending[0]!();
    await first;

    expect(observations).toEqual([
      { value: 'second', current: true },
      { value: 'first', current: false },
    ]);
  });

  it('invalidates the active request when cancelled', async () => {
    let release: (() => void) | undefined;
    let current = true;
    const request = createLatestRequest(async ({ isCurrent }: any) => {
      await new Promise<void>((resolve) => { release = resolve; });
      current = isCurrent();
    }, { AbortControllerImpl: vi.fn(function Controller(this: any) {
      this.signal = {};
      this.abort = vi.fn();
    }) });
    const running = request.run();
    request.cancel();
    release?.();
    await running;
    expect(current).toBe(false);
  });
});
