import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapLocationTracker } from '../../public/scripts/mapLocationTracker.js';
// @ts-expect-error Browser assets remain JavaScript.
import { createMapTrailStore } from '../../public/scripts/mapTrailStore.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeTrailLayers, MAP_POSITION_SOURCE_ID, trailGeoJson } from '../../public/scripts/mapTrailLayer.js';

function element(): any {
  const listeners = new Map<string, () => void>();
  return {
    hidden: false, className: '', type: '', title: '', textContent: '',
    setAttribute() {}, append() {},
    addEventListener(name: string, listener: () => void) { listeners.set(name, listener); },
    click() { listeners.get('click')?.(); },
  };
}

function harness() {
  const mapHandlers = new Map<string, () => void>();
  const documentHandlers = new Map<string, () => void>();
  const sources = new Map<string, any>();
  const documentRef = {
    hidden: false,
    createElement: () => element(),
    addEventListener: (name: string, handler: () => void) => documentHandlers.set(name, handler),
    removeEventListener: vi.fn(),
  } as any;
  const map = {
    addSource: vi.fn((id: string, source: any) => sources.set(id, { ...source, setData: vi.fn() })),
    addLayer: vi.fn(),
    getSource: vi.fn((id: string) => sources.get(id)),
    easeTo: vi.fn(),
    on: vi.fn((name: string, handler: () => void) => mapHandlers.set(name, handler)),
    off: vi.fn(),
  };
  let success: any;
  let failure: any;
  const geolocation = {
    watchPosition: vi.fn((next: any, error: any) => { success = next; failure = error; return 7; }),
    clearWatch: vi.fn(),
  };
  const storage = {
    getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(),
  };
  const store = createMapTrailStore({ storage });
  initializeTrailLayers(map, store.snapshot());
  const status = vi.fn();
  const tracker = initializeMapLocationTracker({ map, documentRef, geolocation, store, status });
  return {
    map, documentRef, geolocation, store, status, tracker,
    success: (position: any) => success(position),
    failure: (error: any) => failure(error),
    drag: () => mapHandlers.get('dragstart')?.(),
    hide: () => { documentRef.hidden = true; documentHandlers.get('visibilitychange')?.(); },
    show: () => { documentRef.hidden = false; documentHandlers.get('visibilitychange')?.(); },
  };
}

describe('map location tracker', () => {
  it('renders separate LineStrings and omits one-point segments', () => {
    const geojson = trailGeoJson({ segments: [
      [{ longitude: -106, latitude: 39, timestamp: 1 }, { longitude: -105.9, latitude: 39.1, timestamp: 2 }],
      [{ longitude: -105, latitude: 40, timestamp: 3 }],
    ] });
    expect(geojson.features).toHaveLength(1);
  });

  it('filters poor fixes and keeps collecting after manual pan', () => {
    const test = harness();
    test.tracker.toggleLocation();
    expect(test.geolocation.watchPosition).toHaveBeenCalledWith(
      expect.any(Function), expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    test.success({ coords: { longitude: -106, latitude: 39, accuracy: 25 }, timestamp: 1_000 });
    expect(test.map.easeTo).toHaveBeenCalledOnce();
    expect(test.map.getSource(MAP_POSITION_SOURCE_ID).setData).toHaveBeenCalled();

    test.drag();
    test.success({ coords: { longitude: -105.9, latitude: 39.1, accuracy: 25 }, timestamp: 2_000 });
    expect(test.store.snapshot().segments[0]).toHaveLength(2);
    expect(test.map.easeTo).toHaveBeenCalledOnce();

    test.success({ coords: { longitude: 0, latitude: 0, accuracy: 101 }, timestamp: 3_000 });
    expect(test.store.snapshot().segments[0]).toHaveLength(2);

    test.tracker.toggleLocation();
    expect(test.map.easeTo).toHaveBeenCalledTimes(2);
    test.tracker.toggleLocation();
    expect(test.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });

  it('starts a new segment after being hidden', () => {
    const test = harness();
    test.tracker.toggleLocation();
    test.success({ coords: { longitude: -106, latitude: 39, accuracy: 25 }, timestamp: 1_000 });
    test.hide();
    test.show();
    test.success({ coords: { longitude: -105.9, latitude: 39.1, accuracy: 25 }, timestamp: 2_000 });
    expect(test.store.snapshot().segments).toHaveLength(2);
  });

  it('clears the trail without stopping an active watch', () => {
    const test = harness();
    test.tracker.toggleLocation();
    test.success({ coords: { longitude: -106, latitude: 39, accuracy: 25 }, timestamp: 1_000 });

    test.tracker.clearTrail();

    expect(test.store.hasPoints()).toBe(false);
    expect(test.geolocation.clearWatch).not.toHaveBeenCalled();
    test.success({ coords: { longitude: -105.9, latitude: 39.1, accuracy: 25 }, timestamp: 2_000 });
    expect(test.store.snapshot().segments).toHaveLength(1);
  });

  it('stops and reports permission denial', () => {
    const test = harness();
    test.tracker.toggleLocation();
    test.failure({ code: 1 });
    expect(test.status).toHaveBeenLastCalledWith('Location permission was denied.');
    expect(test.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });
});
