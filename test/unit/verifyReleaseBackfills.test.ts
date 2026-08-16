import { describe, expect, it, vi } from 'vitest';
import {
  checkFlightAltitudes,
  checkFlightLaunchMatches,
  checkUserAchievementProgress,
  printReleaseBackfillSpotCheck,
  summarizeReleaseBackfillSpotCheck,
} from '../../src/scripts/verifyReleaseBackfills.js';

describe('release backfill spot checks', () => {
  it('reports missing flight altitude metrics from the read-only sample', async () => {
    const database = { execute: vi.fn(async () => ({ rows: [
      { id: 'complete', artifactPresent: true },
      { id: 'missing', artifactPresent: false },
    ] })) };
    await expect(checkFlightAltitudes(database as never)).resolves.toEqual({
      name: 'flight-altitudes', status: 'FAIL', sampled: 2, present: 1, missingIds: ['missing'],
    });
  });

  it('distinguishes matched, Unknown, and not-yet-evaluated launch projections', async () => {
    const database = { execute: vi.fn(async () => ({ rows: [{
      eligible: 5, evaluated: 4, matched: 3, unknown: 1, pendingIds: ['pending-flight'],
    }] })) };
    await expect(checkFlightLaunchMatches(database as never)).resolves.toEqual({
      name: 'flight-launch-matches',
      status: 'FAIL',
      sampled: 5,
      present: 4,
      missingIds: ['pending-flight'],
      detail: '3 matched, 1 unknown, 1 not evaluated',
    });
  });
  it('passes when every sampled artifact is present', () => {
    expect(summarizeReleaseBackfillSpotCheck('example', [
      { id: 'one', artifactPresent: true },
      { id: 'two', artifactPresent: true },
    ])).toEqual({
      name: 'example', status: 'PASS', sampled: 2, present: 2, missingIds: [],
    });
  });

  it('fails and identifies missing sampled artifacts', () => {
    expect(summarizeReleaseBackfillSpotCheck('example', [
      { id: 'one', artifactPresent: true },
      { id: 'two', artifactPresent: false },
    ])).toEqual({
      name: 'example', status: 'FAIL', sampled: 2, present: 1, missingIds: ['two'],
    });
  });

  it('skips a check with no eligible records', () => {
    expect(summarizeReleaseBackfillSpotCheck('example', [])).toEqual({
      name: 'example', status: 'SKIP', sampled: 0, present: 0, missingIds: [],
    });
  });

  it('requires complete v2 user achievement progress while rejecting legacy v1', async () => {
    const database = {
      execute: vi.fn(async () => ({
        rows: [
          { id: 'legacy', projectionVersion: 1 },
          { id: 'complete', projectionVersion: 2 },
        ],
      })),
    };

    await expect(checkUserAchievementProgress(database as never)).resolves.toEqual({
      name: 'user-achievement-progress',
      status: 'FAIL',
      sampled: 2,
      present: 1,
      missingIds: ['legacy'],
    });
  });

  it('passes complete user achievement progress and skips when no users are eligible', async () => {
    const database = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'complete', projectionVersion: 2 }] })
        .mockResolvedValueOnce({ rows: [] }),
    };

    await expect(checkUserAchievementProgress(database as never)).resolves.toMatchObject({
      status: 'PASS', sampled: 1, present: 1,
    });
    await expect(checkUserAchievementProgress(database as never)).resolves.toMatchObject({
      status: 'SKIP', sampled: 0, present: 0,
    });
  });

  it('prints missing identifiers for a failed check', () => {
    const log = vi.fn();
    printReleaseBackfillSpotCheck({
      name: 'example', status: 'FAIL', sampled: 2, present: 1, missingIds: ['two'],
    }, { log });
    expect(log).toHaveBeenNthCalledWith(1, 'FAIL example: 1/2 sampled records have expected artifacts');
    expect(log).toHaveBeenNthCalledWith(2, '     Missing sample IDs: two');
  });

  it('prints an operational error distinctly from a failed sample', () => {
    const log = vi.fn();
    printReleaseBackfillSpotCheck({
      name: 'example', status: 'ERROR', sampled: 0, present: 0, missingIds: [], error: 'connection failed',
    }, { log });
    expect(log).toHaveBeenCalledWith('ERROR example: connection failed');
  });
});
