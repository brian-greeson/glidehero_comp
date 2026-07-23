import { describe, expect, it, vi } from 'vitest';
import {
  BatchedUserHistoryRebuildError,
  type BatchedUserHistoryRebuildSummary,
  type UserHistoryBatchedRebuildService,
  type UserHistoryRebuildInspection,
} from '../../src/services/userHistoryRebuildService.js';
import {
  parseRebuildUserHistoryArgs,
  runRebuildUserHistoryCommand,
} from '../../src/scripts/rebuildUserHistory.js';

const userId = '00000000-0000-4000-8000-000000000001';
const startedAt = new Date('2026-07-01T12:00:00Z');
const readyInspection: Extract<UserHistoryRebuildInspection, { status: 'ready' }> = {
  status: 'ready',
  userId,
  email: 'pilot@example.com',
  completedFlightCount: 1,
  invalidFlightIds: [],
  snapshot: {
    userId,
    email: 'pilot@example.com',
    completedFlights: [{ id: '00000000-0000-4000-8000-000000000010', startedAt }],
  },
};

function summary(overrides: Partial<BatchedUserHistoryRebuildSummary> = {}): BatchedUserHistoryRebuildSummary {
  return {
    completedFlights: 1,
    activitiesDeleted: 1,
    achievementsDeleted: 1,
    achievementRecordEventsDeleted: 0,
    achievementRecordsDeleted: 0,
    flightProgressDeleted: 1,
    userAchievementProgressDeleted: 1,
    activitiesCreated: 1,
    achievementsCreated: 1,
    achievementRecordEventsCreated: 0,
    achievementRecordsCreated: 0,
    flightProgressCreated: 1,
    totalBatches: 1,
    committedBatches: 1,
    committedFlights: 1,
    resetCommitted: true,
    finalizationCommitted: true,
    ...overrides,
  };
}

function service(
  inspection: UserHistoryRebuildInspection = readyInspection,
  rebuildResult: BatchedUserHistoryRebuildSummary | Error = summary(),
): UserHistoryBatchedRebuildService {
  return {
    rebuild: vi.fn(async () => ({ status: 'not_found' as const })),
    inspectByEmail: vi.fn(async () => inspection),
    rebuildSnapshot: vi.fn(async (_snapshot, callbacks) => {
      if (rebuildResult instanceof Error) throw rebuildResult;
      callbacks?.onBatchCommitted?.({ batchNumber: 1, totalBatches: 1, flightCount: 1 });
      return rebuildResult;
    }),
  };
}

function logger() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    logger: {
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

describe('rebuild user history CLI', () => {
  it('parses and normalizes the required email with dry-run as the default', () => {
    expect(parseRebuildUserHistoryArgs(['--email', ' Pilot@Example.com '])).toEqual({
      email: 'pilot@example.com',
      apply: false,
      help: false,
    });
    expect(parseRebuildUserHistoryArgs(['--email=pilot@example.com', '--apply'])).toEqual({
      email: 'pilot@example.com',
      apply: true,
      help: false,
    });
    expect(parseRebuildUserHistoryArgs(['--help'])).toEqual({ email: '', apply: false, help: true });
  });

  it('rejects missing, invalid, duplicate, conflicting, and unknown arguments', () => {
    expect(() => parseRebuildUserHistoryArgs([])).toThrow('--email is required');
    expect(() => parseRebuildUserHistoryArgs(['--email', 'invalid'])).toThrow('valid email');
    expect(() => parseRebuildUserHistoryArgs(['--email'])).toThrow('requires an email');
    expect(() => parseRebuildUserHistoryArgs(['--email', 'a@example.com', '--email=b@example.com']))
      .toThrow('Duplicate --email');
    expect(() => parseRebuildUserHistoryArgs(['--email=a@example.com', '--apply', '--dry-run']))
      .toThrow('cannot be used together');
    expect(() => parseRebuildUserHistoryArgs(['--email=a@example.com', '--wat'])).toThrow('Unknown argument');
    expect(() => parseRebuildUserHistoryArgs(['--help', '--email=a@example.com'])).toThrow('cannot be combined');
  });

  it('performs read-only validation without invoking the rebuild', async () => {
    const fake = service();
    const output = logger();
    await expect(runRebuildUserHistoryCommand(
      fake,
      { email: 'pilot@example.com', apply: false, help: false },
      output.logger,
    )).resolves.toBe(0);
    expect(fake.inspectByEmail).toHaveBeenCalledWith('pilot@example.com');
    expect(fake.rebuildSnapshot).not.toHaveBeenCalled();
    expect(output.logs).toContain(`User: pilot@example.com (${userId})`);
    expect(output.logs).toContain('Completed flights found at startup: 1');
    expect(output.logs).toContain('Dry-run validation completed. No changes were made.');
  });

  it('rejects unknown, empty, and invalid histories without applying', async () => {
    const inspections: UserHistoryRebuildInspection[] = [
      { status: 'not_found', email: 'missing@example.com' },
      {
        status: 'no_completed_flights',
        userId,
        email: 'pilot@example.com',
        completedFlightCount: 0,
        invalidFlightIds: [],
      } as const,
      {
        status: 'invalid_flight_history',
        userId,
        email: 'pilot@example.com',
        completedFlightCount: 1,
        invalidFlightIds: ['00000000-0000-4000-8000-000000000099'],
      },
    ];
    for (const inspection of inspections) {
      const fake = service(inspection);
      const output = logger();
      await expect(runRebuildUserHistoryCommand(
        fake,
        { email: inspection.email, apply: true, help: false },
        output.logger,
      )).resolves.toBe(1);
      expect(fake.rebuildSnapshot).not.toHaveBeenCalled();
      expect(output.errors).not.toHaveLength(0);
    }
  });

  it('reports committed batches and a successful apply summary', async () => {
    const fake = service();
    const output = logger();
    await expect(runRebuildUserHistoryCommand(
      fake,
      { email: 'pilot@example.com', apply: true, help: false },
      output.logger,
    )).resolves.toBe(0);
    expect(fake.rebuildSnapshot).toHaveBeenCalledWith(readyInspection.snapshot, expect.any(Object));
    expect(output.logs).toContain('Committed flight batch 1/1 (1 flights).');
    expect(output.logs).toContain('Flight batches committed: 1/1');
    expect(output.errors).toEqual([]);
  });

  it('reports a partial apply and returns a failure exit code', async () => {
    const partial = summary({
      completedFlights: 6,
      totalBatches: 2,
      committedBatches: 1,
      committedFlights: 5,
      activitiesCreated: 5,
      flightProgressCreated: 5,
      finalizationCommitted: false,
    });
    const fake = service(
      { ...readyInspection, completedFlightCount: 6 },
      new BatchedUserHistoryRebuildError(partial, new Error('intentional batch failure')),
    );
    const output = logger();
    await expect(runRebuildUserHistoryCommand(
      fake,
      { email: 'pilot@example.com', apply: true, help: false },
      output.logger,
    )).resolves.toBe(1);
    expect(output.logs).toContain('Flight batches committed: 1/2');
    expect(output.errors.some((message) => message.includes('earlier') || message.includes('remain committed'))).toBe(true);
  });
});
