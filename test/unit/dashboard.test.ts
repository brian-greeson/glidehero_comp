import { beforeEach, describe, expect, it, vi } from 'vitest';

// The browser asset intentionally remains JavaScript; this test exercises its public module API.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeDashboard } from '../../public/scripts/dashboard.js';

describe('Personal territory dashboard map', () => {
  const geojson = {
    type: 'FeatureCollection',
    features: [],
  };

  let loadHandler: (() => Promise<void>) | undefined;
  let addSource: ReturnType<typeof vi.fn>;
  let addLayer: ReturnType<typeof vi.fn>;
  let fetchPersonalTerritory: ReturnType<typeof vi.fn>;
  let mapStatus: { hidden: boolean; textContent: string };

  beforeEach(() => {
    loadHandler = undefined;
    addSource = vi.fn();
    addLayer = vi.fn();
    fetchPersonalTerritory = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(geojson), {
        status: 200,
        headers: { 'content-type': 'application/geo+json' },
      }),
    );
    mapStatus = { hidden: true, textContent: '' };
  });

  function initialize() {
    const mapElement = {
      dataset: {
        mapStyleUrl: 'https://example.test/style.json',
        territoryColor: '#1769AA',
      },
    };
    const documentRef = {
      querySelector(selector: string) {
        if (selector === '[data-dashboard-map]') return mapElement;
        if (selector === '[data-map-empty-state]') return mapStatus;
        return null;
      },
    };
    const map = {
      addSource,
      addLayer,
      addControl: vi.fn(),
      once: vi.fn((event: string, handler: () => Promise<void>) => {
        if (event === 'load') loadHandler = handler;
      }),
    };
    const maplibre = {
      Map: vi.fn(function Map() {
        return map;
      }),
      NavigationControl: vi.fn(function NavigationControl() {}),
    };

    initializeDashboard({ documentRef, maplibre, fetchImpl: fetchPersonalTerritory });
  }

  it('loads exactly one aggregate GeoJSON source with personal fill and outline layers', async () => {
    initialize();
    expect(loadHandler).toBeTypeOf('function');

    await loadHandler?.();

    expect(fetchPersonalTerritory).toHaveBeenCalledWith('/v1/personal-territory', {
      credentials: 'same-origin',
      headers: { accept: 'application/geo+json' },
    });
    expect(addSource).toHaveBeenCalledTimes(1);
    expect(addSource).toHaveBeenCalledWith('personal-territory', {
      type: 'geojson',
      data: geojson,
    });
    expect(addLayer).toHaveBeenCalledTimes(2);
    expect(addLayer).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'personal-territory-fill',
      type: 'fill',
      source: 'personal-territory',
      paint: expect.objectContaining({ 'fill-color': '#1769AA' }),
    }));
    expect(addLayer).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: 'personal-territory-outline',
      type: 'line',
      source: 'personal-territory',
      paint: expect.objectContaining({ 'line-color': '#1769AA' }),
    }));
    expect(addSource.mock.calls.map(([id]) => id)).not.toContain('tracks');
    expect(addLayer.mock.calls.map(([layer]) => layer.source)).not.toContain('flight-areas');
  });

  it('shows a territory-specific status when the aggregate request fails', async () => {
    fetchPersonalTerritory.mockResolvedValue(new Response(null, { status: 500 }));
    initialize();

    await loadHandler?.();

    expect(mapStatus.hidden).toBe(false);
    expect(mapStatus.textContent).toBe('Unable to load your territory. Refresh the page.');
  });
});
