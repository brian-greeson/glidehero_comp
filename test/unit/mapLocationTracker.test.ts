import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapLocationTracker } from '../../public/scripts/mapLocationTracker.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapPositionLayers, MAP_POSITION_SOURCE_ID } from '../../public/scripts/mapPositionLayer.js';

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
  const sources = new Map<string, any>();
  const documentRef = {
    hidden: false,
    createElement: () => element(),
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
  initializeMapPositionLayers(map);
  const status = vi.fn();
  const tracker = initializeMapLocationTracker({ map, documentRef, geolocation, status });
  return {
    map, documentRef, geolocation, status, tracker,
    success: (position: any) => success(position),
    failure: (error: any) => failure(error),
    drag: () => mapHandlers.get('dragstart')?.(),
  };
}

describe('map location tracker', () => {
  it('initializes only the current-position source and layers', () => {
    const test = harness();

    expect(test.map.addSource).toHaveBeenCalledOnce();
    expect(test.map.addSource).toHaveBeenCalledWith(MAP_POSITION_SOURCE_ID, expect.any(Object));
    expect(test.map.addLayer).toHaveBeenCalledTimes(2);
  });

  it('filters poor fixes and updates position after manual pan', () => {
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
    expect(test.map.easeTo).toHaveBeenCalledOnce();

    test.success({ coords: { longitude: 0, latitude: 0, accuracy: 101 }, timestamp: 3_000 });
    expect(test.map.getSource(MAP_POSITION_SOURCE_ID).setData).toHaveBeenCalledTimes(2);

    test.tracker.toggleLocation();
    expect(test.map.easeTo).toHaveBeenCalledTimes(2);
    test.tracker.toggleLocation();
    expect(test.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });

  it('stops and reports permission denial', () => {
    const test = harness();
    test.tracker.toggleLocation();
    test.failure({ code: 1 });
    expect(test.status).toHaveBeenLastCalledWith('Location permission was denied.');
    expect(test.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });
});
