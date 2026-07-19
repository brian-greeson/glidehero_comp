import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { loadPersonalTerritory, PERSONAL_TERRITORY_SOURCE_ID } from '../../public/scripts/personalMap.js';

describe('Dashboard territory maps', () => {
  it('loads the personal aggregate as one source with fill and outline layers', async () => {
    const map = { addSource: vi.fn(), addLayer: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      type: 'FeatureCollection', features: [],
    }), { status: 200 }));

    await loadPersonalTerritory(map, '#1769AA', {
      getWest: () => -107, getSouth: () => 39, getEast: () => -105, getNorth: () => 41,
    }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/v1/personal-territory?west=-107&south=39&east=-105&north=41',
      expect.objectContaining({ credentials: 'same-origin' }),
    );

    expect(map.addSource).toHaveBeenCalledWith(PERSONAL_TERRITORY_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    expect(map.addLayer).toHaveBeenCalledTimes(2);
  });

});
