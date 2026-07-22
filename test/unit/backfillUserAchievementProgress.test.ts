import { describe, expect, it } from 'vitest';
import {
  parseUserAchievementProgressBackfillArgs,
  runUserAchievementProgressBackfill,
} from '../../src/scripts/backfillUserAchievementProgress.js';

describe('user achievement progress backfill CLI', () => {
  it('defaults to dry-run and validates supported flags', () => {
    expect(parseUserAchievementProgressBackfillArgs([])).toEqual({ apply: false, help: false });
    expect(parseUserAchievementProgressBackfillArgs(['--dry-run'])).toEqual({ apply: false, help: false });
    expect(parseUserAchievementProgressBackfillArgs(['--apply'])).toEqual({ apply: true, help: false });
    expect(parseUserAchievementProgressBackfillArgs(['--help'])).toEqual({ apply: false, help: true });
    expect(() => parseUserAchievementProgressBackfillArgs(['--apply', '--apply'])).toThrow('Duplicate');
    expect(() => parseUserAchievementProgressBackfillArgs(['--dry-run', '--dry-run'])).toThrow('Duplicate');
    expect(() => parseUserAchievementProgressBackfillArgs(['--apply', '--dry-run'])).toThrow('cannot be used together');
    expect(() => parseUserAchievementProgressBackfillArgs(['--help', '--apply'])).toThrow('cannot be combined');
    expect(() => parseUserAchievementProgressBackfillArgs(['--unknown'])).toThrow('Unknown argument');
  });

  it('rejects invalid batch sizes before database access', async () => {
    await expect(runUserAchievementProgressBackfill({} as never, { apply: true, batchSize: 0 })).rejects.toThrow('batch size must be a positive integer');
    await expect(runUserAchievementProgressBackfill({} as never, { apply: true, batchSize: 1.5 })).rejects.toThrow('batch size must be a positive integer');
  });
});
