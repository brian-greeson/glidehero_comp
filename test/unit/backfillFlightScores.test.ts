import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE,
  parseFlightScoreBackfillArgs,
  runFlightScoreBackfill,
  type FlightScoreCandidate,
} from '../../src/scripts/backfillFlightScores.js';

const points = Array.from({ length: 7 }, (_, sequenceNumber) => ({
  sequenceNumber,
  recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequenceNumber)),
  latitude: sequenceNumber,
  longitude: -sequenceNumber,
  pressureAltitudeMeters: 900 + sequenceNumber,
  gpsAltitudeMeters: 1_000 + sequenceNumber,
}));

const missingScore = (id: string): FlightScoreCandidate => ({
  id,
  totalDistanceMeters: null,
  totalDistanceCalcVersion: null,
  totalDistanceMetadata: null,
  sixPointDistanceMeters: null,
  sixPointDistanceCalcVersion: null,
  sixPointDistanceMetadata: null,
});

describe('flight score backfill arguments', () => {
  it('defaults to a dry-run with bounded batches', () => {
    expect(parseFlightScoreBackfillArgs([])).toEqual({
      apply: false,
      batchSize: DEFAULT_FLIGHT_SCORE_BACKFILL_BATCH_SIZE,
      help: false,
    });
  });

  it('accepts explicit modes and batch sizes and rejects conflicts', () => {
    expect(parseFlightScoreBackfillArgs(['--apply', '--batch-size=4']))
      .toMatchObject({ apply: true, batchSize: 4 });
    expect(parseFlightScoreBackfillArgs(['--dry-run', '--batch-size', '2']))
      .toMatchObject({ apply: false, batchSize: 2 });
    expect(() => parseFlightScoreBackfillArgs(['--apply', '--dry-run'])).toThrow(/cannot/);
    expect(() => parseFlightScoreBackfillArgs(['--batch-size', '0'])).toThrow(/positive integer/);
  });
});

describe('flight score backfill traversal', () => {
  it('uses ordered full tracks, walks keyset batches sequentially, and never writes in dry-run', async () => {
    const candidates = [missingScore('flight-1'), missingScore('flight-2'), missingScore('flight-3')];
    const cursors: Array<string | undefined> = [];
    const loadTrackPoints = vi.fn(async () => points);
    const calculateTotalDistance = vi.fn(() => 123);
    const calculateSixPointDistance = vi.fn(async (received: readonly (typeof points)[number][]) => {
      expect(received).toBe(points);
      return { distanceMeters: 456, pointIndices: [0, 1, 2, 3, 4, 6] as const };
    });
    const writeScores = vi.fn(async () => true);

    const summary = await runFlightScoreBackfill(undefined as never, {
      apply: false,
      batchSize: 2,
      listFlights: async (cursor, limit) => {
        cursors.push(cursor);
        expect(limit).toBe(2);
        const start = cursor ? candidates.findIndex((flight) => flight.id === cursor) + 1 : 0;
        return candidates.slice(start, start + limit);
      },
      loadTrackPoints,
      calculateTotalDistance,
      calculateSixPointDistance,
      writeScores,
    });

    expect(cursors).toEqual([undefined, 'flight-2', 'flight-3']);
    expect(loadTrackPoints).toHaveBeenCalledTimes(3);
    expect(calculateTotalDistance).toHaveBeenCalledTimes(3);
    expect(calculateSixPointDistance).toHaveBeenCalledTimes(3);
    expect(writeScores).not.toHaveBeenCalled();
    expect(summary).toEqual({
      mode: 'dry-run',
      batchSize: 2,
      inspected: 3,
      calculated: 3,
      skipped: 0,
      written: 0,
      failed: 0,
    });
  });

  it('checks score versions independently and preserves a current total score', async () => {
    const calculateTotalDistance = vi.fn(() => 999);
    const writeScores = vi.fn(async () => true);
    const currentTotal: FlightScoreCandidate = {
      ...missingScore('flight-1'),
      totalDistanceMeters: 321,
      totalDistanceCalcVersion: 1,
      totalDistanceMetadata: {},
    };

    const summary = await runFlightScoreBackfill(undefined as never, {
      apply: true,
      listFlights: async (cursor) => cursor ? [] : [currentTotal],
      loadTrackPoints: async () => points,
      calculateTotalDistance,
      calculateSixPointDistance: async () => ({
        distanceMeters: 654,
        pointIndices: [0, 1, 2, 3, 4, 5],
      }),
      writeScores,
    });

    expect(calculateTotalDistance).not.toHaveBeenCalled();
    expect(writeScores).toHaveBeenCalledWith('flight-1', expect.objectContaining({
      totalDistanceMeters: 321,
      totalDistanceCalcVersion: 1,
      totalDistanceMetadata: {},
      sixPointDistanceMeters: 654,
      sixPointDistanceCalcVersion: 1,
    }));
    expect(summary).toMatchObject({ inspected: 1, calculated: 1, skipped: 0, written: 1, failed: 0 });
  });

  it('skips current rows and continues sequentially after a calculation failure', async () => {
    const current: FlightScoreCandidate = {
      id: 'flight-1',
      totalDistanceMeters: 1,
      totalDistanceCalcVersion: 1,
      totalDistanceMetadata: {},
      sixPointDistanceMeters: 2,
      sixPointDistanceCalcVersion: 1,
      sixPointDistanceMetadata: { points: [] },
    };
    const logger = { log: vi.fn(), error: vi.fn() };
    const summary = await runFlightScoreBackfill(undefined as never, {
      apply: true,
      listFlights: async (cursor) => cursor ? [] : [current, missingScore('flight-2')],
      loadTrackPoints: async () => points,
      calculateSixPointDistance: async () => { throw new Error('sensitive detail'); },
      writeScores: vi.fn(async () => true),
      logger,
    });

    expect(summary).toMatchObject({ inspected: 2, calculated: 0, skipped: 1, written: 0, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith('Unable to calculate flight scores for flight flight-2.');
  });
});
