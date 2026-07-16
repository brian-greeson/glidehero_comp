import { describe, expect, it } from 'vitest';
import { buildLiteralSearchPatterns, escapeLikeSearchTerm } from '../../src/domain/search/searchSanitizer.js';

describe('search sanitizer', () => {
  it.each([
    ['Boulder', 'Boulder'],
    ['100% Ridge', '100\\% Ridge'],
    ['Under_score', 'Under\\_score'],
    ['Back\\slash', 'Back\\\\slash'],
    ['50%_Back\\slash', '50\\%\\_Back\\\\slash'],
    ["Pilot's Ridge", "Pilot's Ridge"],
    ["' OR TRUE --", "' OR TRUE --"],
  ])('escapes LIKE metacharacters in %j', (input, expected) => {
    expect(escapeLikeSearchTerm(input)).toBe(expected);
  });

  it('builds literal prefix and contains patterns', () => {
    expect(buildLiteralSearchPatterns('50%_Hill')).toEqual({
      contains: '%50\\%\\_Hill%',
      prefix: '50\\%\\_Hill%',
    });
  });
});
