import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error Browser assets remain JavaScript.
import { colorCompetitionTerritory, competitionTerritoryUrl, COMPETITION_TERRITORY_FILL_LAYER_ID, COMPETITION_TERRITORY_OUTLINE_LAYER_ID, COMPETITION_TERRITORY_SOURCE_ID, createCompetitionColorRegistry, loadCompetitionTerritory } from '../../public/scripts/competitionMap.js';
// @ts-expect-error Browser assets remain JavaScript.
import { loadPersonalTerritory, PERSONAL_TERRITORY_SOURCE_ID } from '../../public/scripts/personalMap.js';

const currentUserId = 'current-user';
const otherUserId = 'other-user';

function feature(ownerUserId: string) {
  return {
    type: 'Feature',
    properties: { ownerUserId, cellId: `cell:${ownerUserId}` },
    geometry: { type: 'Polygon', coordinates: [] },
  };
}

describe('Dashboard territory maps', () => {
  it('loads the personal aggregate as one source with fill and outline layers', async () => {
    const map = { addSource: vi.fn(), addLayer: vi.fn() };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      type: 'FeatureCollection', features: [],
    }), { status: 200 }));

    await loadPersonalTerritory(map, '#1769AA', fetchImpl);

    expect(map.addSource).toHaveBeenCalledWith(PERSONAL_TERRITORY_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    expect(map.addLayer).toHaveBeenCalledTimes(2);
  });

  it('assigns stable owner colors shared by map and leaderboard consumers', () => {
    const registry = createCompetitionColorRegistry(currentUserId, '#1769AA', () => 0.5);
    const colored = colorCompetitionTerritory({
      type: 'FeatureCollection',
      features: [feature(currentUserId), feature(otherUserId), feature(otherUserId)],
    }, currentUserId, '#1769AA', () => 0.5, registry);

    expect(colored.features[0].properties.displayColor).toBe('#1769AA');
    expect(colored.features[1].properties.displayColor).toBe(registry.colorFor(otherUserId));
    expect(colored.features[2].properties.displayColor).toBe(colored.features[1].properties.displayColor);
  });

  it('creates competition layers and updates their shared source on later periods', async () => {
    const firstMap = { addSource: vi.fn(), addLayer: vi.fn() };
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      type: 'FeatureCollection', features: [feature(otherUserId)],
    }), { status: 200 }));
    await loadCompetitionTerritory(firstMap, {
      currentUserId,
      territoryColor: '#1769AA',
      month: '2026-07',
      fetchImpl,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/v1/competition-territory?month=2026-07');
    expect(firstMap.addSource).toHaveBeenCalledWith(
      COMPETITION_TERRITORY_SOURCE_ID,
      expect.objectContaining({ type: 'geojson' }),
    );
    expect(firstMap.addLayer).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: COMPETITION_TERRITORY_FILL_LAYER_ID,
    }));
    expect(firstMap.addLayer).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: COMPETITION_TERRITORY_OUTLINE_LAYER_ID,
    }));

    const setData = vi.fn();
    await loadCompetitionTerritory({
      getSource: () => ({ setData }), addSource: vi.fn(), addLayer: vi.fn(),
    }, { currentUserId, territoryColor: '#1769AA', fetchImpl });
    expect(setData).toHaveBeenCalled();
    expect(competitionTerritoryUrl()).toBe('/v1/competition-territory');
  });
});
