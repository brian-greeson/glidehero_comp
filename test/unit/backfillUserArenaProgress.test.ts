import { describe, expect, it, vi } from 'vitest';
import { parseUserArenaProgressBackfillArgs, runUserArenaProgressBackfill } from '../../src/scripts/backfillUserArenaProgress.js';

describe('user Arena progress backfill CLI', () => {
  it('defaults to dry-run and validates supported flags', () => {
    expect(parseUserArenaProgressBackfillArgs([])).toEqual({ apply: false, help: false });
    expect(parseUserArenaProgressBackfillArgs(['--dry-run'])).toEqual({ apply: false, help: false });
    expect(parseUserArenaProgressBackfillArgs(['--apply'])).toEqual({ apply: true, help: false });
    expect(parseUserArenaProgressBackfillArgs(['--help'])).toEqual({ apply: false, help: true });
    expect(() => parseUserArenaProgressBackfillArgs(['--apply', '--apply'])).toThrow('Duplicate');
    expect(() => parseUserArenaProgressBackfillArgs(['--dry-run', '--dry-run'])).toThrow('Duplicate');
    expect(() => parseUserArenaProgressBackfillArgs(['--apply', '--dry-run'])).toThrow('cannot be used together');
    expect(() => parseUserArenaProgressBackfillArgs(['--help', '--apply'])).toThrow('cannot be combined');
    expect(() => parseUserArenaProgressBackfillArgs(['--unknown'])).toThrow('Unknown argument');
  });

  it('locks the Arena catalog before projection reads, rebuild, and promotion', async () => {
    const events: string[] = [];
    let readIndex = 0;
    const transaction = {
      execute: vi.fn(async (query: unknown) => {
        if (JSON.stringify(query).includes('pg_advisory_xact_lock_shared')) {
          events.push('catalog-lock');
          return { rows: [] };
        }
        events.push(`read-${++readIndex}`);
        return { rows: [] };
      }),
    };
    const database = {
      execute: vi.fn(async () => ({ rows: [{ userId: 'user-1' }] })),
      transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const snapshot = { rows: [], lifetimeUniqueCellCount: 0 };
    const arenaProgressService = {
      rebuildInTransaction: vi.fn(async () => {
        events.push('rebuild');
        return snapshot;
      }),
    };
    const achievementProgressService = {
      upsertFromArenaSnapshotInTransaction: vi.fn(async () => {
        events.push('promote');
        return {
          userId: 'user-1',
          lifetimeUniqueCellCount: 0,
          launchArenasVisited: 0,
          generalArenasExplored: 0,
          statesFlownIn: 0,
          countriesFlownIn: 0,
          bestGeneralArenaId: null,
          bestGeneralClaimedCellCount: 0,
          bestGeneralClaimableCellCount: 0,
          projectionVersion: 2,
          updatedAt: new Date('2026-07-23T00:00:00Z'),
        };
      }),
    };

    await runUserArenaProgressBackfill(database as never, {
      apply: true,
      logger: { log: vi.fn(), error: vi.fn() },
      arenaProgressService,
      achievementProgressService: achievementProgressService as never,
    });

    expect(events).toEqual(['catalog-lock', 'read-1', 'read-2', 'rebuild', 'promote']);
    expect(arenaProgressService.rebuildInTransaction).toHaveBeenCalledWith(transaction, 'user-1');
    expect(achievementProgressService.upsertFromArenaSnapshotInTransaction).toHaveBeenCalledWith(
      transaction,
      'user-1',
      snapshot,
      { promoteToComplete: true },
    );
  });
});
