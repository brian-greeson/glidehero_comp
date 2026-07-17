import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { arenaGridUrl, viewportGridUrl } from '../../public/scripts/mapGridApi.js';
// @ts-expect-error Browser assets remain JavaScript.
import { createMapButtonControl } from '../../public/scripts/mapButtonControl.js';
// @ts-expect-error Browser assets remain JavaScript.
import { initializeMapGridOverlay, MAP_GRID_LAYER_ID } from '../../public/scripts/mapGridOverlay.js';

function element(): any {
  const listeners = new Map<string, () => void>();
  return {
    hidden: false,
    className: '',
    type: '',
    title: '',
    textContent: '',
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    addEventListener(name: string, listener: () => void) { listeners.set(name, listener); },
    append() {},
    click() { listeners.get('click')?.(); },
  };
}

function documentHarness() {
  const created: any[] = [];
  return {
    created,
    createElement() { const next = element(); created.push(next); return next; },
  } as any;
}

function mapHarness(zoom = 10) {
  const handlers = new Map<string, () => void>();
  const sources = new Map<string, any>();
  const layers = new Set<string>();
  let currentZoom = zoom;
  let west = -107;
  const map = {
    addSource: vi.fn((id: string, source: any) => sources.set(id, { ...source, setData: vi.fn() })),
    addLayer: vi.fn((layer: any) => layers.add(layer.id)),
    getSource: vi.fn((id: string) => sources.get(id)),
    getLayer: vi.fn((id: string) => layers.has(id) ? { id } : undefined),
    setLayoutProperty: vi.fn(),
    getZoom: () => currentZoom,
    getBounds: () => ({
      getWest: () => west, getSouth: () => 39, getEast: () => -105, getNorth: () => 41,
    }),
    on: vi.fn((name: string, handler: () => void) => handlers.set(name, handler)),
    off: vi.fn(),
  };
  return {
    map,
    setZoom(next: number) { currentZoom = next; },
    setWest(next: number) { west = next; },
    move() { handlers.get('moveend')?.(); },
  };
}

const emptyGrid = { type: 'FeatureCollection', features: [] };

describe('map grid overlay', () => {
  it('builds canonical viewport and Arena URLs', () => {
    const bounds = { getWest: () => -107, getSouth: () => 39, getEast: () => -105, getNorth: () => 41 };
    expect(viewportGridUrl(bounds)).toBe('/v1/grid?west=-107&south=39&east=-105&north=41');
    expect(arenaGridUrl('745')).toBe('/v1/arenas/745/grid');
  });

  it('creates an accessible toggle control', () => {
    const documentRef = documentHarness();
    const control = createMapButtonControl({ documentRef, label: 'Show grid', symbol: '▦', onClick: vi.fn() });
    expect(control.onAdd({})).toBe(documentRef.created[0]);
    expect(documentRef.created[1].attributes.get('aria-label')).toBe('Show grid');
    control.setPressed(true);
    expect(documentRef.created[1].attributes.get('aria-pressed')).toBe('true');
  });

  it('gates viewport grids by zoom and refreshes after movement', async () => {
    const harness = mapHarness(10);
    const status = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(emptyGrid), { status: 200 }));
    const overlay = initializeMapGridOverlay({
      map: harness.map, documentRef: documentHarness(), fetchImpl, status,
    });

    await overlay.toggle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith('Zoom in to view grid.');

    harness.setZoom(11);
    harness.move();
    await vi.waitFor(() => expect(harness.map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: MAP_GRID_LAYER_ID, type: 'line' }),
    ));

    await overlay.toggle();
    expect(harness.map.setLayoutProperty).toHaveBeenLastCalledWith(MAP_GRID_LAYER_ID, 'visibility', 'none');
  });

  it('caches a finite Arena grid across toggles', async () => {
    const harness = mapHarness(7);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(emptyGrid), { status: 200 }));
    const overlay = initializeMapGridOverlay({
      map: harness.map, documentRef: documentHarness(), fetchImpl, arenaSourceId: '745',
    });
    await overlay.toggle();
    await overlay.toggle();
    await overlay.toggle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/v1/arenas/745/grid', expect.any(Object));
  });

  it('ignores an older viewport response', async () => {
    const harness = mapHarness(11);
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const overlay = initializeMapGridOverlay({
      map: harness.map, documentRef: documentHarness(), fetchImpl,
    });

    const firstRun = overlay.toggle();
    harness.setWest(-106);
    const secondRun = overlay.refresh();
    second.resolve(new Response(JSON.stringify({ ...emptyGrid, marker: 'new' }), { status: 200 }));
    await secondRun;
    first.resolve(new Response(JSON.stringify({ ...emptyGrid, marker: 'old' }), { status: 200 }));
    await firstRun;

    expect(harness.map.addSource).toHaveBeenCalledTimes(1);
    expect(harness.map.addSource.mock.calls[0]?.[1].data.marker).toBe('new');
  });
});
