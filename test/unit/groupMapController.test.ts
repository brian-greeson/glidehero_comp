import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser asset remains JavaScript.
import { clearGroupTrack, initializeGroupMapController, installGroupMapLayers } from '../../public/scripts/groupMapController.js';

function mapHarness() {
  const sources = new Map<string, any>();
  const layers = new Set<string>();
  const map = {
    addSource: vi.fn((id: string, source: any) => sources.set(id, { ...source, setTiles: vi.fn(), setData: vi.fn() })),
    addLayer: vi.fn((layer: any) => layers.add(layer.id)),
    getSource: vi.fn((id: string) => sources.get(id)),
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    querySourceFeatures: vi.fn(() => [{ properties: { pilotUserId: 'pilot-2' } }]),
    setPaintProperty: vi.fn(),
    fitBounds: vi.fn(),
    on: vi.fn(),
  };
  return { map, sources };
}

describe('group map controller', () => {
  it('installs coverage and orange selected-flight layers', () => {
    const { map } = mapHarness();
    installGroupMapLayers(map, { tileUrl: '/tiles/{z}/{x}/{y}.mvt', minimumZoom: 4, maximumZoom: 12 });
    expect(map.addSource).toHaveBeenCalledWith('competition-coverage', expect.objectContaining({
      type: 'vector',
      tiles: ['/tiles/{z}/{x}/{y}.mvt'],
    }));
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
      id: 'group-selected-flight-track-line',
      paint: expect.objectContaining({ 'line-color': '#f97316' }),
    }));
  });

  it('filters pilots, replaces flights, and clears a selected track', async () => {
    const { map, sources } = mapHarness();
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/flights/')
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-105, 40], [-104, 41]] } }
        : { flights: ['flight-2'] }),
    }));
    const documentRef = {
      querySelectorAll: () => [],
    } as any;
    const controller = initializeGroupMapController({
      map,
      mapElement: {
        dataset: {
          groupId: 'group-1',
          groupMonth: '2026-08',
          groupFlightsUrl: '/v1/groups/group-1/flights',
        },
      } as any,
      documentRef,
      fetchImpl,
      pilotColors: { 'pilot-2': '#22c55e' },
    });
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'competition-territory-fill', 'fill-color', expect.arrayContaining([
        expect.arrayContaining(['match', expect.anything(), 'pilot-2', '#22c55e', '#94a3b8']),
      ]),
    );
    await controller.selectPilot('pilot-2');
    expect(sources.get('competition-coverage').setTiles).toHaveBeenLastCalledWith(
      ['/v1/groups/group-1/competition-territory/tiles/{z}/{x}/{y}.mvt?month=2026-08&pilot=pilot-2'],
    );
    await controller.selectFlight('flight-2');
    expect(sources.get('group-selected-flight-track').setData).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'Feature' }),
    );
    expect(map.fitBounds).toHaveBeenCalledWith([[-105, 40], [-104, 41]], expect.objectContaining({ maxZoom: 12 }));
    clearGroupTrack(map);
    expect(sources.get('group-selected-flight-track').setData).toHaveBeenLastCalledWith(
      { type: 'FeatureCollection', features: [] },
    );
  });

  it('prevents link navigation for controller actions', () => {
    const { map } = mapHarness();
    const pilot = { dataset: { groupPilotId: 'pilot-1' }, addEventListener: vi.fn() };
    const flight = { dataset: { groupFlightId: 'flight-1' }, addEventListener: vi.fn() };
    const clear = { dataset: {}, addEventListener: vi.fn() };
    const documentRef = {
      querySelectorAll: (selector: string) => selector === '[data-group-pilot-filter]'
        ? [pilot] : selector === '[data-group-flight-track]' ? [flight] : [clear],
    } as any;
    initializeGroupMapController({
      map,
      mapElement: { dataset: { groupId: 'group-1', groupMonth: '2026-08' } } as any,
      documentRef,
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    });
    for (const element of [pilot, flight, clear]) {
      const handler = element.addEventListener.mock.calls[0]![1];
      const event = { preventDefault: vi.fn() };
      handler(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
  });
});
