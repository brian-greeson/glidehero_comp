import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Browser asset is JavaScript.
import { installMapReplayLayer, replayGeoJson } from '../../public/scripts/mapReplayLayer.js';

function mapMock() {
  const sources = new Map<string, any>(); const layers = new Map<string, any>(); const paints = new Map<string, any>();
  return {
    sources, layers, paints,
    addSource: vi.fn((id, source) => sources.set(id, { ...source, setData: vi.fn((data) => { sources.get(id).data = data; }) })),
    getSource: vi.fn((id) => sources.get(id)), addLayer: vi.fn((layer) => layers.set(layer.id, layer)), getLayer: vi.fn((id) => layers.get(id)),
    removeLayer: vi.fn((id) => layers.delete(id)), removeSource: vi.fn((id) => sources.delete(id)),
    getPaintProperty: vi.fn((id, prop) => paints.get(`${id}:${prop}`)), setPaintProperty: vi.fn((id, prop, value) => paints.set(`${id}:${prop}`, value)),
  };
}

describe('map replay layer', () => {
  it('renders tracks and markers with pilot metadata and skips short tracks', () => {
    const data = replayGeoJson({ flights: [{ flightId: 'f1', pilotUserId: 'p1', track: [[1, 2]], marker: [1, 2] }] }, () => '#abc');
    expect(data.tracks.features).toHaveLength(0); expect(data.markers.features[0].properties).toMatchObject({ trackColor: '#abc', flightId: 'f1' });
  });
  it('updates sources and restores dimmed paint on destroy', () => {
    const map = mapMock(); map.layers.set('selected-cell-fill', {}); map.paints.set('selected-cell-fill:fill-opacity', 0.8);
    const layer = installMapReplayLayer(map as any, { dimLayerIds: ['selected-cell-fill'] });
    expect(map.paints.get('selected-cell-fill:fill-opacity')).toBe(0.3);
    layer.update({ flights: [{ flightId: 'f', pilotUserId: 'p', track: [[0, 0], [1, 1]], marker: [1, 1] }] });
    expect(map.sources.get('map-replay-tracks').data.features).toHaveLength(1); layer.destroy();
    expect(map.paints.get('selected-cell-fill:fill-opacity')).toBe(0.8); expect(map.sources.size).toBe(0);
  });
  it('dims default line targets even when opacity was unset and restores default', () => {
    const map = mapMock(); map.layers.set('arena-focus-boundary', {});
    const layer = installMapReplayLayer(map as any);
    expect(map.setPaintProperty).toHaveBeenCalledWith('arena-focus-boundary', 'line-opacity', 0.3);
    layer.destroy(); expect(map.setPaintProperty).toHaveBeenCalledWith('arena-focus-boundary', 'line-opacity', null);
  });
});
