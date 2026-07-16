export type LiteralSearchPatterns = {
  contains: string;
  prefix: string;
};

/**
 * Escapes characters that have special meaning in a SQL LIKE or ILIKE pattern.
 *
 * This only makes LIKE searches treat user input literally. SQL injection
 * protection must still come from parameterized queries.
 */
export function escapeLikeSearchTerm(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function buildLiteralSearchPatterns(value: string): LiteralSearchPatterns {
  const escaped = escapeLikeSearchTerm(value);
  return {
    contains: `%${escaped}%`,
    prefix: `${escaped}%`,
  };
}
