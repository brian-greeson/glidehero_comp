import { describe, expect, it, vi } from 'vitest';
import {
  printReleaseBackfillSpotCheck,
  summarizeReleaseBackfillSpotCheck,
} from '../../src/scripts/verifyReleaseBackfills.js';

describe('release backfill spot checks', () => {
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
