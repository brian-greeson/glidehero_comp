import { describe, expect, it, vi } from 'vitest';
// The Arena browser entry point intentionally remains JavaScript.
// @ts-expect-error TypeScript does not emit or typecheck files under public/.
import { initializeArena } from '../../public/scripts/arena.js';

describe('Arena dashboard', () => {
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
        if (selector === '[data-competition-coverage]') return {};
        return selector === '[data-coverage-map]' ? mapElement : null;
      },
    } as any;
    const maplibre = {
      Map: vi.fn(function MapStub() { return map; }),
      NavigationControl: vi.fn(),
    };

    initializeArena({ documentRef, maplibre, fetchImpl: vi.fn() });

    expect(maplibre.Map).toHaveBeenCalledOnce();
    expect(map.on).not.toHaveBeenCalledWith('moveend', expect.any(Function));
  });
});
