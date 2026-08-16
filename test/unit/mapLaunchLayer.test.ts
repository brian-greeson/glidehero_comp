import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { LAUNCH_CLUSTER_COUNT_LAYER_ID, LAUNCH_CLUSTER_LAYER_ID, LAUNCH_MARKER_LAYER_ID, LAUNCH_SOURCE_ID, installLaunchLayers, launchFeatureCollection, launchLayerVisibleFromSearch, launchLocationLabel, mapLaunchDetailRequestUrl, mapLaunchRequestUrl, normalizeLaunchDetailPayload, normalizeLaunchMarkerPayload, selectedLaunchIdFromSearch, setLaunchLayerVisibility } from '../../public/scripts/app-ui/mapLaunchLayer.js';

describe('map launch layer contracts', () => {
  it('normalizes marker payloads and marks one selected launch', () => {
    const launches = normalizeLaunchMarkerPayload({ launches: [
      { launchId: '42', name: 'Boulder', longitude: '-105.25', latitude: '40.02', visited: true },
      { launchId: 'invalid', name: 'Ignored', longitude: 0, latitude: 0 },
    ] });
    expect(launches).toEqual([{ launchId: 42, name: 'Boulder', longitude: -105.25, latitude: 40.02, visited: true }]);
    expect(launchFeatureCollection(launches, 42).features[0]).toMatchObject({
      id: 42,
      properties: { launchId: 42, selected: true, visited: true },
      geometry: { type: 'Point', coordinates: [-105.25, 40.02] },
    });
  });

  it('builds antimeridian-safe marker and filtered detail requests', () => {
    const markerUrl = new URL(mapLaunchRequestUrl('/v1/map-launches', { west: 179, south: -10, east: 181, north: 10 }, {
      scope: 'following', period: { period: 'month', anchor: '2026-08-01' }, launch: 'unknown',
    }), 'https://example.test');
    expect(Object.fromEntries(markerUrl.searchParams)).toEqual({ scope: 'following', period: 'month', anchor: '2026-08-01', launch: 'unknown', west: '179', south: '-10', east: '-179', north: '10' });
    const detailUrl = new URL(mapLaunchDetailRequestUrl('/v1/map-launches/{launchId}', 42, {
      scope: 'personal', period: { period: 'month', anchor: '2026-08-01' }, launch: 42,
    }), 'https://example.test');
    expect(detailUrl.pathname).toBe('/v1/map-launches/42');
    expect(Object.fromEntries(detailUrl.searchParams)).toEqual({ scope: 'personal', period: 'month', anchor: '2026-08-01', launch: '42' });
  });

  it('carries group scope through marker and detail requests', () => {
    const groupId = '00000000-0000-4000-8000-000000000042';
    const parameters = { scope: 'group', groupId, period: { period: 'month', anchor: '2026-08-01' } };
    const markerUrl = new URL(mapLaunchRequestUrl('/v1/map-launches', { west: -106, south: 39, east: -105, north: 40 }, parameters), 'https://example.test');
    const detailUrl = new URL(mapLaunchDetailRequestUrl('/v1/map-launches/{launchId}', 42, parameters), 'https://example.test');
    expect(markerUrl.searchParams.get('group')).toBe(groupId);
    expect(detailUrl.searchParams.get('group')).toBe(groupId);
  });

  it('uses visible-by-default URL state and validates launch selection', () => {
    expect(launchLayerVisibleFromSearch('')).toBe(true);
    expect(launchLayerVisibleFromSearch('?launches=off')).toBe(false);
    expect(selectedLaunchIdFromSearch('?selectedLaunch=42')).toBe(42);
    expect(selectedLaunchIdFromSearch('?selectedLaunch=not-a-launch')).toBeNull();
  });

  it('normalizes confirmed launch detail fields', () => {
    const detail = normalizeLaunchDetailPayload({ launch: {
      launchId: 42, name: 'Boulder', longitude: -105.25, latitude: 40.02,
      city: 'Boulder', state: 'Colorado', country: 'USA', elevationMeters: '2180',
      description: '  Foothills launch. ', matchingFlightCount: '3', visited: true,
    } });
    expect(detail).toMatchObject({ elevationMeters: 2180, description: 'Foothills launch.', matchingFlightCount: 3, visited: true });
    expect(launchLocationLabel(detail)).toBe('Boulder, Colorado, USA');
  });

  it('installs clustered marker layers and toggles all layer visibility', () => {
    const sources = new Map<string, unknown>(); const layers = new Map<string, unknown>();
    const map = {
      getSource: vi.fn((id: string) => sources.get(id)),
      addSource: vi.fn((id: string, value: unknown) => sources.set(id, value)),
      getLayer: vi.fn((id: string) => layers.get(id)),
      addLayer: vi.fn((value: { id: string }) => layers.set(value.id, value)),
      setLayoutProperty: vi.fn(),
    };

    installLaunchLayers(map, { visible: false });

    expect(map.addSource).toHaveBeenCalledWith(LAUNCH_SOURCE_ID, expect.objectContaining({ type: 'geojson', cluster: true, clusterMaxZoom: 12, clusterRadius: 44 }));
    expect([...layers.keys()]).toEqual([LAUNCH_CLUSTER_LAYER_ID, LAUNCH_CLUSTER_COUNT_LAYER_ID, LAUNCH_MARKER_LAYER_ID]);
    expect([...layers.values()]).toEqual(expect.arrayContaining([expect.objectContaining({ layout: expect.objectContaining({ visibility: 'none' }) })]));

    setLaunchLayerVisibility(map, true);
    expect(map.setLayoutProperty).toHaveBeenCalledTimes(3);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(LAUNCH_MARKER_LAYER_ID, 'visibility', 'visible');
  });
});
