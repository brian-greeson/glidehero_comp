import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { createMapTrailStore, MAP_TRAIL_STORAGE_KEY } from '../../public/scripts/mapTrailStore.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
}

describe('map trail store', () => {
  it('restores one shared trail and preserves separate segments', () => {
    const storage = memoryStorage();
    const first = createMapTrailStore({ storage });
    first.startSegment();
    first.append({ longitude: -106, latitude: 39, timestamp: 1_000 });
    first.closeSegment();
    first.startSegment();
    first.append({ longitude: -105.9, latitude: 39.1, timestamp: 2_000 });

    const restored = createMapTrailStore({ storage });
    expect(restored.snapshot().segments).toHaveLength(2);
    expect(restored.snapshot().segments[1]?.[0]?.longitude).toBe(-105.9);
  });

  it('starts a new segment after a timestamp gap', () => {
    const store = createMapTrailStore({ storage: memoryStorage(), gapMilliseconds: 60_000 });
    store.append({ longitude: -106, latitude: 39, timestamp: 1_000 });
    store.append({ longitude: -105, latitude: 40, timestamp: 62_000 });
    expect(store.snapshot().segments).toHaveLength(2);
  });

  it('discards corrupt stored data', () => {
    const storage = memoryStorage();
    storage.setItem(MAP_TRAIL_STORAGE_KEY, '{bad json');
    const store = createMapTrailStore({ storage });
    expect(store.hasPoints()).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith(MAP_TRAIL_STORAGE_KEY);
  });

  it('keeps new points in memory when persistence fails', () => {
    const storage = memoryStorage();
    storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    const onPersistenceError = vi.fn();
    const store = createMapTrailStore({ storage, onPersistenceError });
    store.append({ longitude: -106, latitude: 39, timestamp: 1_000 });
    expect(store.hasPoints()).toBe(true);
    expect(onPersistenceError).toHaveBeenCalledOnce();
  });

  it('clears the trail and reports removal failures', () => {
    const storage = memoryStorage();
    const store = createMapTrailStore({ storage });
    store.append({ longitude: -106, latitude: 39, timestamp: 1_000 });
    expect(store.clear()).toBe(true);
    expect(store.hasPoints()).toBe(false);

    storage.removeItem.mockImplementation(() => { throw new Error('blocked'); });
    expect(store.clear()).toBe(false);
  });
});
