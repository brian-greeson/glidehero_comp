import { describe, expect, it, vi } from 'vitest';
import {
  parseFlightLaunchBackfillArgs,
  runFlightLaunchBackfill,
  type FlightLaunchBackfillCandidate,
} from '../../src/scripts/backfillFlightLaunchMatches.js';

const candidate = (id: string): FlightLaunchBackfillCandidate => ({
  id,
  launchLatitude: 40,
  launchLongitude: -105,
});

describe('flight launch reconciliation backfill', () => {
  it('defaults to a bounded dry run and validates limits', () => {
    expect(parseFlightLaunchBackfillArgs([])).toEqual({ help: false, apply: false, batchSize: 100, limit: 1_000 });
    expect(parseFlightLaunchBackfillArgs(['--apply', '--batch-size=5', '--limit', '10']))
      .toEqual({ help: false, apply: true, batchSize: 5, limit: 10 });
    expect(() => parseFlightLaunchBackfillArgs(['--limit=0'])).toThrow(/positive integer/);
    expect(() => parseFlightLaunchBackfillArgs(['--dry-run', '--apply'])).toThrow(/cannot be used together/);
    expect(() => parseFlightLaunchBackfillArgs(['--apply', '--dry-run'])).toThrow(/cannot be used together/);
    expect(() => parseFlightLaunchBackfillArgs(['--apply', '--apply'])).toThrow(/Duplicate --apply/);
    expect(() => parseFlightLaunchBackfillArgs(['--batch-size=999999999999999999999'])).toThrow(/positive integer/);
  });

  it('rejects unsafe programmatic batch bounds before loading candidates', async () => {
    await expect(runFlightLaunchBackfill(undefined as never, {
      apply: false, batchSize: Number.POSITIVE_INFINITY,
    })).rejects.toThrow('Batch size must be a positive integer.');
    await expect(runFlightLaunchBackfill(undefined as never, {
      apply: false, limit: Number.MAX_SAFE_INTEGER + 1,
    })).rejects.toThrow('Limit must be a positive integer.');
  });

  it('classifies matched and Unknown rows without writing in dry-run mode', async () => {
    const rows = [candidate('flight-1'), candidate('flight-2')];
    const reconcileCandidate = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const summary = await runFlightLaunchBackfill(undefined as never, {
      apply: false,
      logger,
      listCandidates: async (cursor) => cursor ? [] : rows,
      matchCandidate: async (flight) => flight.id === 'flight-1'
        ? { launchId: 745, distanceMeters: 12 }
        : { launchId: null, distanceMeters: null },
      reconcileCandidate,
    });
    expect(summary).toEqual({
      mode: 'dry-run', inspected: 2, matched: 1, unknown: 1, written: 0, failed: 0, limited: false,
    });
    expect(reconcileCandidate).not.toHaveBeenCalled();
    expect(logger.log.mock.calls.map(([message]) => message)).toEqual([
      'Starting flight launch backfill in dry-run mode (batch size 100, limit 1000).',
      'Batch 1: processing 2 flights.',
      'Batch 1 complete: inspected 2/1000 total; batch matched 1, Unknown 1, written 0, failed 0.',
      'Flight launch backfill complete: inspected 2, matched 1, Unknown 1, written 0, failed 0.',
    ]);
  });

  it('isolates failures and reports the bounded remainder in apply mode', async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const listCandidates = vi.fn(async (cursor: string | undefined, limit: number) => {
      if (!cursor) return [candidate('flight-1'), candidate('flight-2')].slice(0, limit);
      if (cursor === 'flight-2') return [candidate('flight-3')].slice(0, limit);
      return [];
    });
    const summary = await runFlightLaunchBackfill(undefined as never, {
      apply: true,
      limit: 2,
      batchSize: 2,
      logger,
      listCandidates,
      reconcileCandidate: async (flight) => {
        if (flight.id === 'flight-2') throw new Error('database unavailable');
        return { launchId: 745, distanceMeters: 20, written: true };
      },
    });
    expect(summary).toEqual({
      mode: 'apply', inspected: 2, matched: 1, unknown: 0, written: 1, failed: 1, limited: true,
    });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('flight-2: database unavailable'));
    expect(logger.log.mock.calls.map(([message]) => message)).toEqual([
      'Starting flight launch backfill in apply mode (batch size 2, limit 2).',
      'Batch 1: processing 2 flights.',
      'Batch 1 complete: inspected 2/2 total; batch matched 1, Unknown 0, written 1, failed 1.',
      'Flight launch backfill stopped at the configured limit: inspected 2, matched 1, Unknown 0, written 1, failed 1.',
    ]);
  });

  it('loads and reports each batch before advancing the cursor', async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const listCandidates = vi.fn(async (cursor: string | undefined) => {
      if (!cursor) return [candidate('flight-1'), candidate('flight-2')];
      if (cursor === 'flight-2') return [candidate('flight-3')];
      return [];
    });

    await runFlightLaunchBackfill(undefined as never, {
      apply: true,
      batchSize: 2,
      limit: 10,
      logger,
      listCandidates,
      reconcileCandidate: async () => ({ launchId: 745, distanceMeters: 20, written: true }),
    });

    expect(listCandidates).toHaveBeenNthCalledWith(1, undefined, 2);
    expect(listCandidates).toHaveBeenNthCalledWith(2, 'flight-2', 2);
    expect(logger.log).toHaveBeenCalledWith('Batch 1: processing 2 flights.');
    expect(logger.log).toHaveBeenCalledWith('Batch 2: processing 1 flight.');
    expect(logger.log).toHaveBeenCalledWith('Batch 2 complete: inspected 3/10 total; batch matched 1, Unknown 0, written 1, failed 0.');
  });
});
