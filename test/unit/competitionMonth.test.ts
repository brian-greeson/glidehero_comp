import { describe, expect, it } from 'vitest';
import { normalizeCompetitionMonth } from '../../src/domain/competition/competitionMonth.js';

describe('normalizeCompetitionMonth', () => {
  it('normalizes any date in a month to its first calendar day', () => {
    expect(normalizeCompetitionMonth('2026-07-19')).toBe('2026-07-01');
    expect(normalizeCompetitionMonth('2024-02-29')).toBe('2024-02-01');
  });

  it.each(['2026-02-29', '2026-13-01', '2026-00-01', '2026-07', 'July 19, 2026'])(
    'rejects invalid or non-ISO input %s',
    (input) => {
      expect(() => normalizeCompetitionMonth(input)).toThrow(RangeError);
    },
  );
});
