import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BATCH_SIZE,
  parseFlightThumbnailBackfillArgs,
  runFlightThumbnailBackfill,
} from '../../src/scripts/backfillFlightThumbnails.js';

const flights = [
  { id: 'flight-1', userId: 'user-1' },
  { id: 'flight-2', userId: 'user-1' },
  { id: 'flight-3', userId: 'user-2' },
];

describe('flight thumbnail backfill arguments', () => {
  it('defaults to dry-run, missing-only, and ten-flight batches', () => {
    expect(parseFlightThumbnailBackfillArgs([])).toEqual({ apply: false, force: false, batchSize: DEFAULT_BATCH_SIZE, help: false });
  });

  it('accepts apply, force, and both batch-size spellings', () => {
    expect(parseFlightThumbnailBackfillArgs(['--apply', '--force', '--batch-size', '7'])).toMatchObject({ apply: true, force: true, batchSize: 7 });
    expect(parseFlightThumbnailBackfillArgs(['--batch-size=3']).batchSize).toBe(3);
  });

  it('rejects invalid or conflicting flags', () => {
    expect(() => parseFlightThumbnailBackfillArgs(['--batch-size', '0'])).toThrow(/positive integer/);
    expect(() => parseFlightThumbnailBackfillArgs(['--batch-size', '1.5'])).toThrow(/positive integer/);
    expect(() => parseFlightThumbnailBackfillArgs(['--apply', '--dry-run'])).toThrow(/cannot/);
    expect(() => parseFlightThumbnailBackfillArgs(['--help', '--force'])).toThrow(/cannot/);
  });
});

describe('flight thumbnail backfill traversal', () => {
  it('walks keyset batches sequentially and reports missing pairs without writing in dry-run', async () => {
    const cursors: Array<string | undefined> = [];
    const head = vi.fn(async (key: string) => key.includes('flight-2') ? 'missing' as const : 'present' as const);
    const generate = vi.fn(async () => undefined);
    const summary = await runFlightThumbnailBackfill(undefined as never, {
      apply: false,
      bucketFolder: 'private',
      batchSize: 2,
      headObject: head,
      generate,
      listFlights: async (cursor, limit) => {
        cursors.push(cursor);
        expect(limit).toBe(2);
        const start = cursor ? flights.findIndex((flight) => flight.id === cursor) + 1 : 0;
        return flights.slice(start, start + limit);
      },
    });

    expect(cursors).toEqual([undefined, 'flight-2', 'flight-3']);
    expect(head).toHaveBeenCalledTimes(6);
    expect(generate).not.toHaveBeenCalled();
    expect(summary).toEqual({ mode: 'dry-run', batchSize: 2, inspected: 3, wouldGenerate: 1, generated: 0, skippedPresent: 2, failed: 0 });
  });

  it('regenerates all flights in force/apply mode sequentially and continues after a failure', async () => {
    const head = vi.fn();
    const order: string[] = [];
    const generate = vi.fn(async (flightId: string) => {
      order.push(flightId);
      if (flightId === 'flight-2') throw new Error('provider secret should not be logged');
    });
    const summary = await runFlightThumbnailBackfill(undefined as never, {
      apply: true,
      force: true,
      batchSize: 10,
      headObject: head,
      generate,
      listFlights: async (cursor) => cursor ? [] : flights,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    expect(head).not.toHaveBeenCalled();
    expect(order).toEqual(['flight-1', 'flight-2', 'flight-3']);
    expect(summary).toMatchObject({ mode: 'apply', inspected: 3, wouldGenerate: 3, generated: 2, skippedPresent: 0, failed: 1 });
  });

  it('counts and surfaces a non-not-found HEAD failure without attempting generation', async () => {
    const logger = { log: vi.fn(), error: vi.fn() };
    const generate = vi.fn(async () => undefined);
    const summary = await runFlightThumbnailBackfill(undefined as never, {
      apply: true,
      bucketFolder: 'private',
      headObject: vi.fn(async () => { throw new Error('sensitive credentials'); }),
      generate,
      listFlights: async (cursor) => cursor ? [] : [flights[0]!],
      logger,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Unable to inspect thumbnail objects for flight flight-1.');
  });
});
