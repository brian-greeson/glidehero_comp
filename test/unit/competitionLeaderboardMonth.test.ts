import { describe, expect, it } from 'vitest';
import { normalizeCompetitionLeaderboardMonth } from '../../src/domain/competition/competitionLeaderboardMonth.js';

describe('normalizeCompetitionLeaderboardMonth', () => {
  it('normalizes YYYY-MM to the stored first-of-month date', () => {
    expect(normalizeCompetitionLeaderboardMonth('2026-07')).toBe('2026-07-01');
  });

  it.each(['2026-00', '2026-13', '2026-7', '2026-07-14', ' 2026-07', 'not-a-month'])('rejects %j', (value) => {
    expect(() => normalizeCompetitionLeaderboardMonth(value)).toThrow(RangeError);
  });
});
