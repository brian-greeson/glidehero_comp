import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { createViewportTerritoryLoader } from '../../public/scripts/viewportTerritoryLoader.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function harness(fetchTerritory = vi.fn(async (bounds) => ({ bounds }))) {
  let bounds = { west: -107, south: 39, east: -105, north: 41 };
  const applyTerritory = vi.fn();
  const onVisibleError = vi.fn();
  const loader = createViewportTerritoryLoader({
    map: { getBounds: () => ({
      getWest: () => bounds.west, getSouth: () => bounds.south,
      getEast: () => bounds.east, getNorth: () => bounds.north,
    }) },
    fetchTerritory, applyTerritory, onVisibleError,
  });
  return { loader, fetchTerritory, applyTerritory, onVisibleError, move(next: typeof bounds) { bounds = next; } };
}

describe('viewport territory loader', () => {
  it('loads visible data first, buffers it, and skips movements inside the buffer', async () => {
    const test = harness();
    await test.loader.refresh();
    await vi.waitFor(() => expect(test.fetchTerritory).toHaveBeenCalledTimes(2));
    expect(test.fetchTerritory.mock.calls[0]?.[0]).toEqual({ west: -107, south: 39, east: -105, north: 41 });
    expect(test.fetchTerritory.mock.calls[1]?.[0]).toEqual({ west: -108, south: 38, east: -104, north: 42 });
    test.move({ west: -106, south: 39, east: -104, north: 41 });
    await test.loader.refresh();
    expect(test.fetchTerritory).toHaveBeenCalledTimes(2);
    test.move({ west: -103, south: 39, east: -101, north: 41 });
    await test.loader.refresh();
    await vi.waitFor(() => expect(test.fetchTerritory).toHaveBeenCalledTimes(4));
  });

  it('keeps visible data when the background request fails', async () => {
    const fetchTerritory = vi.fn()
      .mockResolvedValueOnce({ type: 'FeatureCollection', features: [{ id: 'visible' }] })
      .mockRejectedValueOnce(new Error('buffer failed'));
    const test = harness(fetchTerritory);
    await test.loader.refresh();
    await vi.waitFor(() => expect(fetchTerritory).toHaveBeenCalledTimes(2));
    expect(test.applyTerritory).toHaveBeenCalledTimes(1);
    expect(test.onVisibleError).not.toHaveBeenCalled();
  });

  it('does not let an old buffered response replace a newer viewport', async () => {
    const oldBuffer = deferred<{ id: string }>();
    const fetchTerritory = vi.fn()
      .mockResolvedValueOnce({ id: 'first-visible' })
      .mockReturnValueOnce(oldBuffer.promise)
      .mockResolvedValueOnce({ id: 'second-visible' })
      .mockResolvedValueOnce({ id: 'second-buffer' });
    const test = harness(fetchTerritory);

    await test.loader.refresh();
    await vi.waitFor(() => expect(fetchTerritory).toHaveBeenCalledTimes(2));
    test.move({ west: -103, south: 39, east: -101, north: 41 });
    await test.loader.refresh();
    await vi.waitFor(() => expect(fetchTerritory).toHaveBeenCalledTimes(4));
    oldBuffer.resolve({ id: 'stale-buffer' });
    await Promise.resolve();

    expect(test.applyTerritory.mock.calls.map(([territory]) => territory.id)).toEqual([
      'first-visible', 'second-visible', 'second-buffer',
    ]);
  });
});
