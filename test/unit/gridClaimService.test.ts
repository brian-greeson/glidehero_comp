import { describe, expect, it, vi } from 'vitest';
import { createPersonalGridClaimService } from '../../src/services/gridClaimService.js';

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
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    select,
    insert,
    delete: deleteFrom,
    execute,
  }));

  return { database: { transaction }, where, execute, deleteFrom, transaction };
}

function projectionDatabaseDouble(rows: unknown[] = []) {
  const execute = vi.fn(async (_query: unknown) => ({ rows }));
  return { database: { execute }, execute };
}

describe('PersonalGridClaimService', () => {
  it('replaces a flight’s existing cells and reports direct and enclosed claims', async () => {
    const { database, where, execute, deleteFrom, transaction } = processingDatabaseDouble({
      directCellCount: 3,
      enclosedCellCount: 2,
      newPersonalCellCount: 3,
      personalCellTotalAfter: 3,
      progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
    });
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.process({ flightId, userId })).resolves.toEqual({
      flightId,
      cellSize: 1_000,
      directCellCount: 3,
      enclosedCellCount: 2,
      newPersonalCellCount: 3,
      personalCellTotalAfter: 3,
      progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteFrom).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('returns full-cell viewport stats with distinct contributing flights', async () => {
    const stats = {
      claimedCellCount: 2,
      claimedAreaSquareMeters: 2_000_000,
      flightCount: 2,
    };
    const { database } = projectionDatabaseDouble([stats]);
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.getViewportStats({
      userId,
      west: -1,
      south: -1,
      east: 1,
      north: 1,
    })).resolves.toEqual(stats);
  });
});
