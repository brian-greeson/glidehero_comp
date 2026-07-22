import { describe, expect, it, vi } from 'vitest';
import { createProfileService } from '../../src/services/profileService.js';
import type { UserAchievementProgressService } from '../../src/services/userAchievementProgressService.js';

function database() {
  const execute = vi.fn(async (query: unknown) => {
    if (execute.mock.calls.length === 1) return { rows: [{ displayName: 'Pilot' }] };
    const text = String(query);
    if (text.includes('lifetimeUniqueCellCount')) return { rows: [{ lifetimeUniqueCellCount: 0 }] };
    return { rows: [] };
  });
  return { execute, select: vi.fn() } as never as { execute: typeof execute; select: ReturnType<typeof vi.fn> };
}

function progressService(get: UserAchievementProgressService['get']): UserAchievementProgressService {
  return { get } as unknown as UserAchievementProgressService;
}

describe('profile achievement projection read model', () => {
  it('builds dashboard progress from a persisted projection without authoritative calculation', async () => {
    const db = database();
    const get = vi.fn(async () => ({
      userId: 'pilot-1', lifetimeUniqueCellCount: 4, launchArenasVisited: 2,
      generalArenasExplored: 1, statesFlownIn: 0, countriesFlownIn: 0,
      bestGeneralArenaId: null, bestGeneralClaimedCellCount: 0, bestGeneralClaimableCellCount: 0,
      projectionVersion: 1, updatedAt: new Date(),
    }));
    const service = createProfileService(db as never, { cellSize: 1_000, userAchievementProgress: progressService(get) });

    const result = await service.getDashboardAchievementProgress('pilot-1');

    expect(result.length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledWith('pilot-1');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('warns and falls back to the authoritative calculation when projection is missing', async () => {
    const db = database();
    const get = vi.fn(async () => null);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const service = createProfileService(db as never, { cellSize: 1_000, userAchievementProgress: progressService(get) });
      await service.getDashboardAchievementProgress('pilot-1');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('projection row missing'));
      expect(db.execute.mock.calls.length).toBeGreaterThan(1);
    } finally {
      warning.mockRestore();
    }
  });
});
