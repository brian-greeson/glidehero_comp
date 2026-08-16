import { describe, expect, it, vi } from 'vitest';
import { matchNearestCatalogLaunch } from '../../src/services/flightLaunchMatchService.js';

describe('flight launch matcher', () => {
  it('returns Unknown without querying when launch coordinates are missing or invalid', async () => {
    const execute = vi.fn();
    await expect(matchNearestCatalogLaunch({ execute } as never, {
      latitude: null,
      longitude: -105,
    })).resolves.toEqual({ launchId: null, distanceMeters: null });
    await expect(matchNearestCatalogLaunch({ execute } as never, {
      latitude: 91,
      longitude: -105,
    })).resolves.toEqual({ launchId: null, distanceMeters: null });
    expect(execute).not.toHaveBeenCalled();
  });

  it('normalizes bigint and distance driver values from the nearest result', async () => {
    const execute = vi.fn(async () => ({ rows: [{ launchId: '745', distanceMeters: '999.9' }] }));
    await expect(matchNearestCatalogLaunch({ execute } as never, {
      latitude: 40,
      longitude: -105,
    })).resolves.toEqual({ launchId: 745, distanceMeters: 999.9 });
    expect(execute).toHaveBeenCalledOnce();
  });
});
