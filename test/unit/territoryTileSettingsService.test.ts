import { describe, expect, it } from 'vitest';
import { createTerritoryTileSettingsService } from '../../src/services/territoryTileSettingsService.js';

describe('territoryTileSettingsService', () => {
  it('starts with defaults and atomically replaces runtime settings', () => {
    const settings = createTerritoryTileSettingsService();

    expect(settings.get()).toEqual({
      personal: { minimumZoom: 4, maximumZoom: 14 },
      competition: { minimumZoom: 4, maximumZoom: 14 },
    });

    settings.update({
      personal: { minimumZoom: 5, maximumZoom: 11 },
      competition: { minimumZoom: 6, maximumZoom: 12 },
    });

    expect(settings.get()).toEqual({
      personal: { minimumZoom: 5, maximumZoom: 11 },
      competition: { minimumZoom: 6, maximumZoom: 12 },
    });
  });

  it('rejects invalid ranges without changing the current settings', () => {
    const settings = createTerritoryTileSettingsService();

    expect(() => settings.update({
      personal: { minimumZoom: 10, maximumZoom: 9 },
      competition: { minimumZoom: 4, maximumZoom: 14 },
    })).toThrow(RangeError);
    expect(settings.get().personal).toEqual({ minimumZoom: 4, maximumZoom: 14 });

    expect(() => settings.update({
      personal: { minimumZoom: 4, maximumZoom: 14 },
      competition: { minimumZoom: 0, maximumZoom: 23 },
    })).toThrow(RangeError);
    expect(settings.get().competition).toEqual({ minimumZoom: 4, maximumZoom: 14 });
  });

  it('does not expose mutable internal state', () => {
    const settings = createTerritoryTileSettingsService();
    const snapshot = settings.get();
    snapshot.personal.minimumZoom = 0;

    expect(settings.get().personal.minimumZoom).toBe(4);
  });
});
