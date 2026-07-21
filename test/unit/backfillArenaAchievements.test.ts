import { describe, expect, it } from 'vitest';
import { parseArenaAchievementBackfillArgs, printArenaAchievementBackfillSummary, runArenaAchievementBackfill } from '../../src/scripts/backfillArenaAchievements.js';

describe('Arena achievement backfill CLI', () => {
  it('defaults to dry-run and accepts apply or explicit dry-run', () => {
    expect(parseArenaAchievementBackfillArgs([])).toEqual({ apply: false, help: false });
    expect(parseArenaAchievementBackfillArgs(['--dry-run'])).toEqual({ apply: false, help: false });
    expect(parseArenaAchievementBackfillArgs(['--apply'])).toEqual({ apply: true, help: false });
  });

  it('rejects unknown and conflicting arguments', () => {
    expect(() => parseArenaAchievementBackfillArgs(['--apply', '--dry-run'])).toThrow('cannot be used together');
    expect(() => parseArenaAchievementBackfillArgs(['--apply', '--apply'])).toThrow('Duplicate');
    expect(() => parseArenaAchievementBackfillArgs(['--dry-run', '--dry-run'])).toThrow('Duplicate');
    expect(() => parseArenaAchievementBackfillArgs(['--wat'])).toThrow('Unknown argument');
    expect(() => parseArenaAchievementBackfillArgs(['--help', '--apply'])).toThrow('cannot be combined');
  });

  it('rejects invalid transaction batch sizes before accessing the database', async () => {
    await expect(runArenaAchievementBackfill({} as never, { apply: true, cellSize: 1_000, batchSize: 0 }))
      .rejects.toThrow('batch size must be a positive integer');
    await expect(runArenaAchievementBackfill({} as never, { apply: true, cellSize: 1_000, batchSize: 1.5 }))
      .rejects.toThrow('batch size must be a positive integer');
  });

  it('has no import side effects and prints a concise deterministic summary', () => {
    expect(parseArenaAchievementBackfillArgs(['--help'])).toEqual({ apply: false, help: true });
    const lines: string[] = [];
    const logger = { log: (line: string) => lines.push(line), error: () => undefined };
    printArenaAchievementBackfillSummary({
      usersExamined: 2,
      flightsExamined: 3,
      achievementCounts: { first_flight_from_launch: 1 } as never,
      launchTagRecordEvents: 2,
      unchangedOrAlreadyEarned: 4,
      failures: 0,
    }, false, logger);
    expect(lines[0]).toContain('Dry-run');
    expect(lines).toContain('Users examined: 2');
    expect(lines).toContain('Flights examined: 3');
    expect(lines).toContain('Launch-tag record events: 2');
    expect(lines).toContain('Unchanged/already earned: 4');

    const failedLines: string[] = [];
    printArenaAchievementBackfillSummary({
      usersExamined: 2,
      flightsExamined: 3,
      achievementCounts: {} as never,
      launchTagRecordEvents: 1,
      unchangedOrAlreadyEarned: 0,
      failures: 1,
    }, true, { log: (line: string) => failedLines.push(line), error: () => undefined }, true);
    expect(failedLines[0]).toContain('Failed/partial apply');
  });
});
