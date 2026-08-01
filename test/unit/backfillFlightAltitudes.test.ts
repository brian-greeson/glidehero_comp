import { describe, expect, it, vi } from 'vitest';
import {
  parseFlightAltitudeBackfillArgs,
  runFlightAltitudeBackfill,
  type FlightAltitudeCandidate,
} from '../../src/scripts/backfillFlightAltitudes.js';

const candidate = (id: string, stored: number | null): FlightAltitudeCandidate => ({
  id,
  storedLaunchGpsAltitudeMeters: stored,
  storedMinGpsAltitudeMeters: stored,
  storedMaxGpsAltitudeMeters: stored,
  launchGpsAltitudeMeters: 1_000,
  minGpsAltitudeMeters: -12,
  maxGpsAltitudeMeters: 2_500,
});

describe('flight altitude backfill', () => {
  it('defaults to dry-run and validates batch size', () => {
    expect(parseFlightAltitudeBackfillArgs([])).toMatchObject({ apply: false, batchSize: 100 });
    expect(parseFlightAltitudeBackfillArgs(['--apply', '--batch-size=5'])).toMatchObject({ apply: true, batchSize: 5 });
    expect(() => parseFlightAltitudeBackfillArgs(['--batch-size', '0'])).toThrow(/positive integer/);
  });

  it('reports changed and current rows without writing during dry-run', async () => {
    const writeValues = vi.fn(async () => true);
    const rows = [candidate('flight-1', null), {
      ...candidate('flight-2', 0),
      storedLaunchGpsAltitudeMeters: 1_000,
      storedMinGpsAltitudeMeters: -12,
      storedMaxGpsAltitudeMeters: 2_500,
    }];
    const summary = await runFlightAltitudeBackfill(undefined as never, {
      apply: false,
      listFlights: async (cursor) => cursor ? [] : rows,
      writeValues,
    });
    expect(summary).toEqual({ mode: 'dry-run', inspected: 2, changed: 1, skipped: 1, written: 0, failed: 0 });
    expect(writeValues).not.toHaveBeenCalled();
  });

  it('writes authoritative launch, minimum, and maximum GPS values in apply mode', async () => {
    const writeValues = vi.fn(async () => true);
    const summary = await runFlightAltitudeBackfill(undefined as never, {
      apply: true,
      listFlights: async (cursor) => cursor ? [] : [candidate('flight-1', null)],
      writeValues,
    });
    expect(writeValues).toHaveBeenCalledWith('flight-1', {
      launchGpsAltitudeMeters: 1_000,
      minGpsAltitudeMeters: -12,
      maxGpsAltitudeMeters: 2_500,
    });
    expect(summary).toMatchObject({ changed: 1, written: 1, failed: 0 });
  });
});
