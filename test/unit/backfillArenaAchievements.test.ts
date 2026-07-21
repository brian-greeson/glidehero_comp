import { describe, expect, it } from 'vitest';
import { parseArenaAchievementBackfillArgs, printArenaAchievementBackfillSummary } from '../../src/scripts/backfillArenaAchievements.js';

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
  });
});
