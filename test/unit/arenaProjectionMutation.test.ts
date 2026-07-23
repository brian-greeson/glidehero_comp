import { describe, expect, it, vi } from 'vitest';
import { createAdminAreaService } from '../../src/services/adminAreaService.js';
import { importLaunchArenasInTransaction, type DatabaseTransaction } from '../../src/services/launchArenaImportService.js';
import type { ArenaAchievementSnapshot } from '../../src/services/arenaAchievementService.js';

const polygon = {
  type: 'Polygon' as const,
  coordinates: [[[0, 0], [0, 0.02], [0.02, 0.02], [0.02, 0], [0, 0]]],
};

function transactionWithResponses(rows: unknown[]) {
  let index = 0;
  rows.unshift([]);
  const transaction = {
    execute: vi.fn(async (query: unknown) => ({ rows: (JSON.stringify(query).includes('pg_advisory_xact_lock') ? (index++, []) : (rows[index++] ?? [])) as never[] })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => undefined) })),
    })),
  } as unknown as DatabaseTransaction;
  return transaction;
}

function snapshot(id: string): ArenaAchievementSnapshot {
  return {
    rows: [{ id: 'arena', name: 'Arena', sourceId: '1', arenaType: 'general', claimableCellCount: 10, claimedCells: 2, visited: false, firstFromLaunch: false, tagged: false }],
    lifetimeUniqueCellCount: 2,
  };
}

describe('Arena mutation projection reconciliation', () => {
  it('unions old/new affected users and forwards each exact snapshot in deterministic order', async () => {
    const transaction = transactionWithResponses([
      [{ id: 'country', sourceId: 1, name: 'United States', countryCode: 'US' }],
      [{ arenaType: 'general' }],
      [{ id: 'arena', arenaType: 'general' }],
    ]);
    const database = {
      transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction),
      execute: vi.fn(async () => ({ rows: [{
        id: 'arena', sourceId: 1, name: 'Updated', country: 'United States', state: '', city: '',
        arenaType: 'general', countryCode: 'US', componentCount: 1,
        geometry: { type: 'MultiPolygon', coordinates: [] }, west: 0, south: 0, east: 1, north: 1,
      }] })),
    } as never;
    const rebuilt = snapshot('arena');
    const events: string[] = [];
    const userArenaProgress = {
      findUsersAffectedByArenasInTransaction: vi.fn()
        .mockResolvedValueOnce(['old-user'])
        .mockResolvedValueOnce(['new-user']),
      rebuildUsersInTransaction: vi.fn(async (...args) => { events.push('rebuild'); return [
        { userId: 'old-user', snapshot: rebuilt },
        { userId: 'new-user', snapshot: { ...rebuilt, lifetimeUniqueCellCount: 3 } },
      ]; }),
    };
    const upsertFromSnapshot = vi.fn(async () => { events.push('summary'); });
    const reconcile = vi.fn(async () => { events.push('leadership'); });
    const service = createAdminAreaService(
      database,
      { cellSize: 1_000 },
      { reconcileInTransaction: reconcile } as never,
      userArenaProgress,
      { upsertFromArenaSnapshotInTransaction: upsertFromSnapshot } as never,
    );

    await service.update('arena', {
      name: 'Updated', countryArenaId: '00000000-0000-4000-8000-000000000001', geometries: [polygon],
    });

    expect(userArenaProgress.rebuildUsersInTransaction).toHaveBeenCalledWith(transaction, ['old-user', 'new-user']);
    expect(upsertFromSnapshot).toHaveBeenNthCalledWith(1, transaction, 'old-user', rebuilt, { promoteToComplete: true });
    expect(upsertFromSnapshot).toHaveBeenNthCalledWith(2, transaction, 'new-user', expect.objectContaining({ lifetimeUniqueCellCount: 3 }), { promoteToComplete: true });
    expect(events).toEqual(['rebuild', 'summary', 'summary', 'leadership']);
  });

  it('rebuilds all Arena projections and forwards exact snapshots for Launch imports', async () => {
    const transaction = transactionWithResponses([
      [{ name: 'United States of America', countryCode: 'US' }],
      [{ count: 0 }], [], [],
      [{ valid: true, geometryType: 'ST_MultiPolygon', components: 25 }],
      [{ id: 'launch' }],
    ]);
    const arenaSnapshot = snapshot('launch');
    const arenaProgress = { rebuildAllInTransaction: vi.fn().mockResolvedValue([{ userId: 'u1', snapshot: arenaSnapshot }]) };
    const upsert = vi.fn().mockResolvedValue(undefined);
    await importLaunchArenasInTransaction(transaction, [{
      id: 1, name: 'Launch', longitude: 0, latitude: 0, country: 'United States', state: '', city: '', description: '',
      elevation: 0, xcByMonth: '', xcByYear: '', rank: 0, rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0,
      rank7: 0, rank8: 0, rank9: 0, rank10: 0, rank11: 0, rank12: 0, xcontestLaunchSite: 0, timezoneOffset: 0,
    }], 1_000, {
      userArenaProgress: arenaProgress,
      userAchievementProgress: { upsertFromArenaSnapshotInTransaction: upsert } as never,
    });
    expect(arenaProgress.rebuildAllInTransaction).toHaveBeenCalledWith(transaction);
    expect(upsert).toHaveBeenCalledWith(transaction, 'u1', arenaSnapshot, { promoteToComplete: true });
  });

  it('skips both projection services when reconcileProjection is false', async () => {
    const transaction = transactionWithResponses([
      [{ name: 'United States of America', countryCode: 'US' }], [{ count: 0 }], [], [],
      [{ valid: true, geometryType: 'ST_MultiPolygon', components: 25 }], [{ id: 'launch' }],
    ]);
    const arenaProgress = { rebuildAllInTransaction: vi.fn() };
    const upsert = vi.fn();
    await importLaunchArenasInTransaction(transaction, [{
      id: 1, name: 'Launch', longitude: 0, latitude: 0, country: 'United States', state: '', city: '', description: '',
      elevation: 0, xcByMonth: '', xcByYear: '', rank: 0, rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0,
      rank7: 0, rank8: 0, rank9: 0, rank10: 0, rank11: 0, rank12: 0, xcontestLaunchSite: 0, timezoneOffset: 0,
    }], 1_000, { userArenaProgress: arenaProgress, userAchievementProgress: { upsertFromArenaSnapshotInTransaction: upsert } as never, reconcileProjection: false });
    expect(arenaProgress.rebuildAllInTransaction).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('propagates projection failure so the owning transaction can roll back', async () => {
    const transaction = transactionWithResponses([
      [{ name: 'United States of America', countryCode: 'US' }], [{ count: 0 }], [], [],
      [{ valid: true, geometryType: 'ST_MultiPolygon', components: 25 }], [{ id: 'launch' }],
    ]);
    const rollback = vi.fn();
    const database = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => {
        try { return await callback(transaction); } catch (error) { rollback(); throw error; }
      },
    };
    await expect(database.transaction((tx) => importLaunchArenasInTransaction(tx, [{
      id: 1, name: 'Launch', longitude: 0, latitude: 0, country: 'United States', state: '', city: '', description: '',
      elevation: 0, xcByMonth: '', xcByYear: '', rank: 0, rank1: 0, rank2: 0, rank3: 0, rank4: 0, rank5: 0, rank6: 0,
      rank7: 0, rank8: 0, rank9: 0, rank10: 0, rank11: 0, rank12: 0, xcontestLaunchSite: 0, timezoneOffset: 0,
    }], 1_000, {
      userArenaProgress: { rebuildAllInTransaction: vi.fn().mockRejectedValue(new Error('projection failed')) },
      userAchievementProgress: { upsertFromArenaSnapshotInTransaction: vi.fn() } as never,
    }))).rejects.toThrow('projection failed');
    expect(rollback).toHaveBeenCalledOnce();
  });
});
