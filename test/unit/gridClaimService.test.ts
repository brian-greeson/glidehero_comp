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
}> = {}, options: { executeRows?: unknown[][] } = {}) {
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
  let executeIndex = 0;
  const executeRows = options.executeRows ? [[], ...options.executeRows] : undefined;
  const execute = vi.fn(async (query: unknown) => ({
    ...(JSON.stringify(query).includes('pg_advisory_xact_lock') ? (executeIndex++, { rows: [] }) : {
    rows: executeRows?.[executeIndex++] ?? [storedCounts],
    }),
  }));
  const onConflictDoNothing = vi.fn(async () => undefined);
  const onConflictDoUpdate = vi.fn(async () => undefined);
  const returning = vi.fn(async () => [{
    userId,
    lifetimeUniqueCellCount: 0,
    launchArenasVisited: 0,
    generalArenasExplored: 0,
    statesFlownIn: 0,
    countriesFlownIn: 0,
    bestGeneralArenaId: null,
    bestGeneralClaimedCellCount: 0,
    bestGeneralClaimableCellCount: 0,
    projectionVersion: 1,
    updatedAt: new Date('2026-07-20T00:00:00Z'),
  }]);
  const values = vi.fn(() => ({ onConflictDoNothing, onConflictDoUpdate: () => ({ returning }) }));
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
    expect(execute).toHaveBeenCalledTimes(8);
  });

  it('processes claims inside a caller-owned transaction', async () => {
    const { database, tx, transaction, deleteFrom, execute } = processingDatabaseDouble();
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' });

    expect(transaction).not.toHaveBeenCalled();
    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(8);
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
      period: { period: 'all-time' },
      west: -1,
      south: -1,
      east: 1,
      north: 1,
    })).resolves.toEqual(stats);
  });

  it('incrementally applies a flight to sorted unique eligible Arenas', async () => {
    const arenaIds = [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    ];
    const { database, tx } = processingDatabaseDouble({}, {
      executeRows: [
        [],
        [{ directCellCount: 1, enclosedCellCount: 0, newPersonalCellCount: 1, personalCellTotalAfter: 1, progressionVersion: 1, evaluatedAt: new Date('2026-07-20T00:00:00Z') }],
        arenaIds.map((arenaId) => ({ arenaId })),
      ],
    });
    const reconcileInTransaction = vi.fn(async () => ({
      arenas: [],
      eventsBuilt: 0,
      achievements: { newlyEarned: [], alreadyEarned: 0 },
    }));
    const applyFlightInTransaction = vi.fn(async () => ({
      arenas: [],
      eventsBuilt: 0,
      achievements: { newlyEarned: [], alreadyEarned: 0 },
    }));
    const arenaAchievements = {
      evaluateInTransaction: vi.fn(async () => ({ newlyEarned: [], alreadyEarned: 0, record: null })),
      evaluateTransitionInTransaction: vi.fn(async () => ({ newlyEarned: [], alreadyEarned: 0, record: null })),
    };
    const userArenaProgress = {
      applyFlightInTransaction: vi.fn(async () => ({ before: { rows: [], lifetimeUniqueCellCount: 0 }, after: { rows: [], lifetimeUniqueCellCount: 1 } })),
    };
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      undefined,
      arenaAchievements,
      { reconcile: vi.fn(), reconcileInTransaction, applyFlightInTransaction } as never,
      undefined,
      userArenaProgress as never,
    );

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' });

    expect(applyFlightInTransaction).toHaveBeenCalledWith(expect.anything(), {
      arenaIds: [arenaIds[1], arenaIds[0]],
      flightId,
    });
    expect(reconcileInTransaction).not.toHaveBeenCalled();
  });

  it('does not reconcile when no newly claimed cell intersects an eligible Arena', async () => {
    const { database, tx } = processingDatabaseDouble({}, {
      executeRows: [
        [],
        [{ directCellCount: 1, enclosedCellCount: 0, newPersonalCellCount: 0, personalCellTotalAfter: 1, progressionVersion: 2, evaluatedAt: new Date('2026-07-20T00:00:00Z') }],
        [],
      ],
    });
    const reconcileInTransaction = vi.fn();
    const arenaAchievements = {
      evaluateInTransaction: vi.fn(async () => ({ newlyEarned: [], alreadyEarned: 0, record: null })),
      evaluateTransitionInTransaction: vi.fn(async () => ({ newlyEarned: [], alreadyEarned: 0, record: null })),
    };
    const userArenaProgress = {
      applyFlightInTransaction: vi.fn(async () => ({ before: { rows: [], lifetimeUniqueCellCount: 0 }, after: { rows: [], lifetimeUniqueCellCount: 1 } })),
    };
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      undefined,
      arenaAchievements,
      { reconcile: vi.fn(), reconcileInTransaction } as never,
      undefined,
      userArenaProgress as never,
    );

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' });

    expect(reconcileInTransaction).not.toHaveBeenCalled();
  });

  it('suppresses leadership evaluation during reprocessing', async () => {
    const { database, tx } = processingDatabaseDouble();
    const reconcileInTransaction = vi.fn();
    const userArenaProgress = {
      applyFlightInTransaction: vi.fn(async () => ({ before: { rows: [], lifetimeUniqueCellCount: 0 }, after: { rows: [], lifetimeUniqueCellCount: 1 } })),
    };
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      undefined,
      undefined,
      { reconcile: vi.fn(), reconcileInTransaction } as never,
      undefined,
      userArenaProgress as never,
    );

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' }, { evaluateLeadership: false });

    expect(reconcileInTransaction).not.toHaveBeenCalled();
  });

  it('persists the Arena snapshot as user progress in the same transaction', async () => {
    const { database, tx } = processingDatabaseDouble();
    const arenaAchievements = {
      evaluateInTransaction: vi.fn(),
      evaluateTransitionInTransaction: vi.fn(async () => ({
        newlyEarned: ['first_cells_in_general_arena' as const],
        alreadyEarned: 0,
        record: null,
      })),
    };
    const after = {
      lifetimeUniqueCellCount: 4,
      rows: [{
        id: '00000000-0000-4000-8000-000000000040',
        arenaType: 'general' as const,
        name: 'Test Arena',
        sourceId: '1',
        claimableCellCount: 10,
        claimedCells: 4,
        visited: false,
        firstFromLaunch: false,
        tagged: false,
      }],
    };
    const userArenaProgress = {
      applyFlightInTransaction: vi.fn(async () => ({ before: { rows: [], lifetimeUniqueCellCount: 3 }, after })),
    };
    const upsertFromArenaSnapshotInTransaction = vi.fn(async () => undefined);
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      undefined,
      arenaAchievements,
      { reconcile: vi.fn(), reconcileInTransaction: vi.fn() } as never,
      { upsertFromArenaSnapshotInTransaction } as never,
      userArenaProgress as never,
    );

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' });

    expect(upsertFromArenaSnapshotInTransaction).toHaveBeenCalledWith(expect.anything(), userId, after);
    expect(arenaAchievements.evaluateInTransaction).not.toHaveBeenCalled();
  });

  it('does not persist progress when achievement evaluation is disabled', async () => {
    const { database, tx } = processingDatabaseDouble();
    const upsertFromArenaSnapshotInTransaction = vi.fn(async () => undefined);
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      undefined,
      undefined,
      undefined,
      { upsertFromArenaSnapshotInTransaction } as never,
    );

    await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' }, { evaluateAchievements: false });

    expect(upsertFromArenaSnapshotInTransaction).not.toHaveBeenCalled();
  });

  it('projects first-pass Arena progress before transition achievements and leadership', async () => {
    const { database, tx } = processingDatabaseDouble({
      newPersonalCellCount: 2,
      personalCellTotalAfter: 5,
    }, { executeRows: [[], [{
      directCellCount: 1,
      enclosedCellCount: 0,
      newPersonalCellCount: 2,
      personalCellTotalAfter: 5,
      progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
    }], [{ arenaId: '00000000-0000-4000-8000-000000000001' }]] });
    const events: string[] = [];
    const before = { rows: [], lifetimeUniqueCellCount: 3 };
    const after = { rows: [], lifetimeUniqueCellCount: 5 };
    const userArenaProgress = {
      applyFlightInTransaction: vi.fn(async (_transaction: unknown, input: unknown) => {
        events.push('projection');
        expect(input).toEqual({
          userId,
          flightId,
          previousLifetimeUniqueCellCount: 3,
          lifetimeUniqueCellCount: 5,
        });
        return { before, after };
      }),
    };
    const arenaAchievements = {
      evaluateInTransaction: vi.fn(),
      evaluateTransitionInTransaction: vi.fn(async (_transaction: unknown, _input: unknown, actualBefore: unknown, actualAfter: unknown) => {
        events.push('transition');
        expect(actualBefore).toBe(before);
        expect(actualAfter).toBe(after);
        return { newlyEarned: ['first_cells_in_general_arena' as const], alreadyEarned: 0, record: null };
      }),
    };
    const userAchievementProgress = {
      upsertFromArenaSnapshotInTransaction: vi.fn(async (_transaction: unknown, _userId: string, snapshot: unknown) => {
        events.push('summary');
        expect(snapshot).toBe(after);
      }),
    };
    const arenaLeadership = {
      reconcile: vi.fn(),
      applyFlightInTransaction: vi.fn(async () => { events.push('leadership'); }),
    };
    const progressionAchievements = {
      awardUniqueCellMilestones: vi.fn(),
      awardPersonalBestAchievements: vi.fn(),
    };
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      progressionAchievements as never,
      arenaAchievements,
      arenaLeadership as never,
      userAchievementProgress as never,
      userArenaProgress as never,
    );

    await expect(service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' })).resolves.toMatchObject({
      arenaAchievements: { newlyEarned: ['first_cells_in_general_arena'], alreadyEarned: 0, record: null },
    });
    expect(events).toEqual(['projection', 'transition', 'summary', 'leadership']);
    expect(arenaAchievements.evaluateInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'retry', progressionVersion: 2, evaluateAchievements: true },
    { label: 'disabled', progressionVersion: 1, evaluateAchievements: false },
  ])('does not project or evaluate Arena achievements on $label processing', async ({ progressionVersion, evaluateAchievements }) => {
    const { database, tx } = processingDatabaseDouble({ progressionVersion }, {
      executeRows: [[], [{
        directCellCount: 1,
        enclosedCellCount: 0,
        newPersonalCellCount: 1,
        personalCellTotalAfter: 1,
        progressionVersion,
        evaluatedAt: new Date('2026-07-20T00:00:00Z'),
      }], []],
    });
    const userArenaProgress = { applyFlightInTransaction: vi.fn() };
    const arenaAchievements = {
      evaluateInTransaction: vi.fn(),
      evaluateTransitionInTransaction: vi.fn(),
    };
    const userAchievementProgress = { upsertFromArenaSnapshotInTransaction: vi.fn() };
    const service = createGridClaimService(
      database as never,
      { cellSize: 1_000 },
      { awardUniqueCellMilestones: vi.fn(), awardPersonalBestAchievements: vi.fn() } as never,
      arenaAchievements,
      { reconcile: vi.fn(), applyFlightInTransaction: vi.fn() } as never,
      userAchievementProgress as never,
      userArenaProgress as never,
    );

    const result = await service.processInTransaction(tx as never, { flightId, userId, launchTimezone: 'UTC' }, { evaluateAchievements });
    expect(result.arenaAchievements).toEqual({ newlyEarned: [], alreadyEarned: 0, record: null });
    expect(userArenaProgress.applyFlightInTransaction).not.toHaveBeenCalled();
    expect(arenaAchievements.evaluateTransitionInTransaction).not.toHaveBeenCalled();
    expect(arenaAchievements.evaluateInTransaction).not.toHaveBeenCalled();
    expect(userAchievementProgress.upsertFromArenaSnapshotInTransaction).not.toHaveBeenCalled();
  });
});
