import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLIGHT_MAP_BACKFILL_BATCH_SIZE,
  DEFAULT_FLIGHT_MAP_BACKFILL_LIMIT,
  parseFlightMapBackfillArgs,
  runFlightMapBackfill,
} from '../../src/scripts/backfillFlightMapGeometry.js';
import { vi } from 'vitest';

describe('flight map backfill arguments', () => {
  it('is dry-run-first and bounded by default', () => {
    expect(parseFlightMapBackfillArgs([])).toEqual({
      help: false,
      apply: false,
      batchSize: DEFAULT_FLIGHT_MAP_BACKFILL_BATCH_SIZE,
      limit: DEFAULT_FLIGHT_MAP_BACKFILL_LIMIT,
    });
  });

  it('requires an explicit apply flag and validates bounds', () => {
    expect(parseFlightMapBackfillArgs(['--apply', '--batch-size', '5', '--limit=20']))
      .toEqual({ help: false, apply: true, batchSize: 5, limit: 20 });
    expect(() => parseFlightMapBackfillArgs(['--limit=0'])).toThrow('Limit must be a positive integer.');
  });

  it('does not load or write projections in dry-run mode', async () => {
    const loadInput = vi.fn();
    const writeProjection = vi.fn();
    const summary = await runFlightMapBackfill({} as never, {
      apply: false,
      listCandidates: vi.fn(async (cursor) => cursor ? [] : [{ id: 'flight-1' }]),
      loadInput,
      writeProjection,
      logger: { log: vi.fn(), error: vi.fn() },
    });
    expect(summary).toMatchObject({ mode: 'dry-run', inspected: 1, stale: 1, written: 0, failed: 0 });
    expect(loadInput).not.toHaveBeenCalled();
    expect(writeProjection).not.toHaveBeenCalled();
  });

  it('continues bounded apply work after an individual failure', async () => {
    const candidates = [{ id: 'flight-1' }, { id: 'flight-2' }];
    const writeProjection = vi.fn(async (flightId: string) => {
      if (flightId === 'flight-1') throw new Error('write failed');
    });
    const summary = await runFlightMapBackfill({} as never, {
      apply: true,
      batchSize: 2,
      limit: 2,
      listCandidates: vi.fn(async (cursor) => cursor ? [] : candidates),
      loadInput: vi.fn(async () => ({
        points: [
          { sequenceNumber: 0, latitude: 40, longitude: -105 },
          { sequenceNumber: 1, latitude: 41, longitude: -104 },
        ],
        protectedSequenceNumbers: new Set<number>(),
      })),
      writeProjection,
      logger: { log: vi.fn(), error: vi.fn() },
    });
    expect(summary).toEqual({ mode: 'apply', inspected: 2, stale: 2, written: 1, failed: 1, limited: false });
    expect(writeProjection).toHaveBeenCalledTimes(2);
  });
});
