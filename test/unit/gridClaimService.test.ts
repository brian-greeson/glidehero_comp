import { describe, expect, it, vi } from 'vitest';
import { createGridClaimService } from '../../src/services/gridClaimService.js';

const flightId = '00000000-0000-4000-8000-000000000020';
const userId = '00000000-0000-4000-8000-000000000030';

function processingDatabaseDouble(counts: Partial<{
  directCellCount: number;
  enclosedCellCount: number;
  newPersonalCellCount: number;
  personalCellTotalAfter: number;
  progressionVersion: number;
  evaluatedAt: Date;
}> = {}) {
  const storedCounts = {
    directCellCount: 3,
    enclosedCellCount: 0,
    newPersonalCellCount: 3,
    personalCellTotalAfter: 3,
    progressionVersion: 1,
    evaluatedAt: new Date('2026-07-20T00:00:00Z'),
    ...counts,
  };
  const where = vi.fn(async () => undefined);
  const selectWhere = vi.fn(async () => [{
    startedAt: new Date('2026-07-20T00:00:00Z'),
    createdAt: new Date('2026-07-19T00:00:00Z'),
  }]);
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));
  const execute = vi.fn(async (_query: unknown) => ({ rows: [storedCounts] }));
  const onConflictDoNothing = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const deleteFrom = vi.fn(() => ({ where }));
  const tx = {
    select,
    insert,
    delete: deleteFrom,
    execute,
  };
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

  return { database: { transaction }, tx, where, execute, deleteFrom, transaction };
}

function projectionDatabaseDouble(rows: unknown[] = []) {
  const execute = vi.fn(async (_query: unknown) => ({ rows }));
  return { database: { execute }, execute };
}

describe('GridClaimService', () => {
  it('replaces a flight’s existing cells and reports direct and enclosed claims', async () => {
    const { database, where, execute, deleteFrom, transaction } = processingDatabaseDouble({
      directCellCount: 3,
      enclosedCellCount: 2,
      newPersonalCellCount: 3,
      personalCellTotalAfter: 3,
      progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
    });
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.process({ flightId, userId, launchTimezone: 'UTC' })).resolves.toEqual({
      flightId,
      cellSize: 1_000,
      directCellCount: 3,
      enclosedCellCount: 2,
      newPersonalCellCount: 3,
      personalCellTotalAfter: 3,
      progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
      arenaAchievements: { newlyEarned: [], alreadyEarned: 0, record: null },
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('processes claims inside a caller-owned transaction', async () => {
    const { database, tx, transaction, deleteFrom, execute } = processingDatabaseDouble();
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' });

    expect(transaction).not.toHaveBeenCalled();
    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns full-cell viewport stats with distinct contributing flights', async () => {
    const stats = {
      claimedCellCount: 2,
      claimedAreaSquareMeters: 2_000_000,
      flightCount: 2,
    };
    const { database } = projectionDatabaseDouble([stats]);
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.getViewportStats({
      userId,
      west: -1,
      south: -1,
      east: 1,
      north: 1,
    })).resolves.toEqual(stats);
  });
});
