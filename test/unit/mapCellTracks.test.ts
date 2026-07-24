import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { colorCellTracks, createMapCellTrackSelection, installMapCellTrackLayers } from '../../public/scripts/mapCellTracks.js';

function featureCollection(features: any[] = []) {
  return { type: 'FeatureCollection', features };
}

function cell(cellId: string, x: number, y: number) {
  return {
    type: 'Feature',
    properties: { cellId, x, y },
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
    },
  };
}

function track(flightId: string) {
  return {
    type: 'Feature',
    properties: { flightId, pilotUserId: 'pilot-one' },
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  };
}

function mapHarness() {
  const sources = new Map<string, any>();
  const layers = new Set<string>();
  const map = {
    addSource: vi.fn((id: string, source: any) => {
      sources.set(id, { ...source, setData: vi.fn() });
    }),
    addLayer: vi.fn((layer: any) => layers.add(layer.id)),
    getSource: vi.fn((id: string) => sources.get(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
  };
  installMapCellTrackLayers(map);
  return { map, sources };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('selected map cell tracks', () => {
  it('installs non-animated highlight and line layers', () => {
    const { map } = mapHarness();

    expect(map.addSource).toHaveBeenCalledWith('selected-cell', {
      type: 'geojson',
      data: featureCollection(),
    });
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'cell-tracks-lines',
      type: 'line',
      paint: expect.objectContaining({
        'line-color': ['get', 'trackColor'],
        'line-width': 3,
      }),
    }));
  });

  it('gives each flight a deterministic distinct color', () => {
    const first = colorCellTracks(featureCollection([
      track('flight-b'),
      track('flight-a'),
      track('flight-b'),
    ]));
    const second = colorCellTracks(featureCollection([
      track('flight-a'),
      track('flight-b'),
    ]));

    expect(first.features[0].properties.trackColor).toBe(
      first.features[2].properties.trackColor,
    );
    expect(first.features[0].properties.trackColor).not.toBe(
      first.features[1].properties.trackColor,
    );
    expect(first.features[1].properties.trackColor).toBe(
      second.features[0].properties.trackColor,
    );
    expect(first.features[0].properties.trackColor).toMatch(/^#[\da-f]{6}$/);
    expect(first.features[1].properties.trackColor).toMatch(/^#[\da-f]{6}$/);
  });

  it('selects, replaces, toggles, and clears cells without moving the map', async () => {
    const { map, sources } = mapHarness();
    class RenderedMapFeature {
      type = 'Feature';
      properties = { cellId: '500:1:2', x: 1, y: 2 };
      geometry = cell('500:1:2', 1, 2).geometry;
    }
    let renderedCell: any = new RenderedMapFeature();
    const loadCellTracks = vi.fn(async (selectedCell: any) => ({
      cell: cell(selectedCell.cellId, selectedCell.x, selectedCell.y),
      tracks: featureCollection([track(`flight-${selectedCell.x}`)]),
    }));
    const selection = createMapCellTrackSelection({
      map,
      cellFeatureAtPoint: () => renderedCell,
      loadCellTracks,
    });

    await selection.handleClick({ point: { x: 10, y: 20 } }, { month: '2026-07' });
    expect(loadCellTracks).toHaveBeenCalledWith(
      { cellId: '500:1:2', x: 1, y: 2 },
      { month: '2026-07' },
      expect.any(AbortSignal),
    );
    expect(sources.get('selected-cell').setData).toHaveBeenLastCalledWith(
      featureCollection([{
        type: 'Feature',
        properties: renderedCell.properties,
        geometry: renderedCell.geometry,
      }]),
    );
    expect(Object.getPrototypeOf(
      sources.get('selected-cell').setData.mock.calls[0][0].features[0],
    )).toBe(Object.prototype);

    renderedCell = cell('500:3:4', 3, 4);
    await selection.handleClick({ point: { x: 11, y: 21 } }, { month: null });
    expect(selection.selectedCell).toEqual({ cellId: '500:3:4', x: 3, y: 4 });

    await selection.handleClick({ point: { x: 11, y: 21 } }, { month: null });
    expect(selection.selectedCell).toBeNull();
    expect(sources.get('selected-cell').setData).toHaveBeenLastCalledWith(featureCollection());

    renderedCell = null;
    await selection.handleClick({ point: { x: 12, y: 22 } }, { month: null });
    expect(sources.get('cell-tracks').setData).toHaveBeenLastCalledWith(featureCollection());
  });

  it('preserves the selected highlight for zero tracks and ignores stale responses', async () => {
    const { map, sources } = mapHarness();
    const first = deferred<any>();
    const second = deferred<any>();
    let renderedCell: any = cell('500:1:2', 1, 2);
    const loadCellTracks = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const selection = createMapCellTrackSelection({
      map,
      cellFeatureAtPoint: () => renderedCell,
      loadCellTracks,
    });

    const firstClick = selection.handleClick({ point: {} }, { month: '2026-06' });
    renderedCell = cell('500:3:4', 3, 4);
    const secondClick = selection.handleClick({ point: {} }, { month: '2026-07' });
    first.resolve({ cell: cell('500:1:2', 1, 2), tracks: featureCollection([track('old')]) });
    second.resolve({ cell: renderedCell, tracks: featureCollection() });
    await Promise.all([firstClick, secondClick]);

    expect(sources.get('selected-cell').setData).toHaveBeenLastCalledWith(
      featureCollection([renderedCell]),
    );
    expect(sources.get('cell-tracks').setData).toHaveBeenLastCalledWith(featureCollection());
  });

  it('refetches the selected cell for a changed period', async () => {
    const { map } = mapHarness();
    const renderedCell = cell('500:-1:2', -1, 2);
    const loadCellTracks = vi.fn(async () => ({
      cell: renderedCell,
      tracks: featureCollection(),
    }));
    const selection = createMapCellTrackSelection({
      map,
      cellFeatureAtPoint: () => renderedCell,
      loadCellTracks,
    });
    await selection.handleClick({ point: {} }, { month: null });

    await selection.refresh({ month: '2026-07' });

    expect(loadCellTracks).toHaveBeenLastCalledWith(
      { cellId: '500:-1:2', x: -1, y: 2 },
      { month: '2026-07' },
      expect.any(AbortSignal),
    );
  });

  it('uses an injected track-color transform when rendering a selection', async () => {
    const { map, sources } = mapHarness();
    const renderedCell = cell('500:1:2', 1, 2);
    const colorTracks = vi.fn((tracks: any) => ({
      ...tracks,
      features: tracks.features.map((feature: any) => ({
        ...feature,
        properties: { ...feature.properties, trackColor: '#1769AA' },
      })),
    }));
    const selection = createMapCellTrackSelection({
      map,
      cellFeatureAtPoint: () => renderedCell,
      loadCellTracks: async () => ({
        cell: renderedCell,
        tracks: featureCollection([track('flight-one')]),
      }),
      colorTracks,
    });

    await selection.handleClick({ point: {} }, { month: null });

    expect(colorTracks).toHaveBeenCalledWith(featureCollection([track('flight-one')]));
    expect(sources.get('cell-tracks').setData).toHaveBeenLastCalledWith(
      featureCollection([{
        ...track('flight-one'),
        properties: {
          ...track('flight-one').properties,
          trackColor: '#1769AA',
        },
      }]),
    );
  });
});
