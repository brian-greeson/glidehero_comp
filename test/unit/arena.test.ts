import { describe, expect, it, vi } from 'vitest';
// The Arena browser entry point intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { arenaBoundaryUrl, arenaLeaderboardUrl, arenaTerritoryUrl, initializeArena } from '../../public/scripts/arena.js';

describe('Arena dashboard', () => {
  it('builds Arena requests without viewport bounds', () => {
    const date = new Date(2026, 6, 14, 12);
    expect(arenaBoundaryUrl('745')).toBe('/v1/arenas/745/boundary');
    expect(arenaTerritoryUrl('745', date)).toBe('/v1/arenas/745/competition-territory?date=2026-07-14');
    expect(arenaLeaderboardUrl('745', date)).toBe('/v1/arenas/745/competition-leaderboard?month=2026-07');
    expect(arenaLeaderboardUrl('745', date)).not.toContain('west=');
  });

  it('does not register a map movement scoring refresh', () => {
    const map = {
      addControl: vi.fn(),
      once: vi.fn(),
      on: vi.fn(),
    };
    const mapElement = {
      dataset: {
        arenaSourceId: '745',
        mapStyleUrl: 'map-style',
        currentUserId: 'user-1',
        territoryColor: '#1769AA',
      },
    };
    const documentRef = {
      querySelector(selector: string) {
        return selector === '[data-arena-map]' ? mapElement : null;
      },
    } as any;
    const maplibre = {
      Map: vi.fn(function MapStub() { return map; }),
      NavigationControl: vi.fn(),
    };

    initializeArena({ documentRef, maplibre, fetchImpl: vi.fn() });

    expect(maplibre.Map).toHaveBeenCalledOnce();
    expect(map.on).not.toHaveBeenCalled();
  });
});
