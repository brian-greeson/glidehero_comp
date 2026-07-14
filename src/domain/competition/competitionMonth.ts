const isoCalendarDate = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeCompetitionMonth(input: string): string {
  const match = isoCalendarDate.exec(input);
  if (!match) throw new RangeError('Competition month must be a valid ISO calendar date.');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    year < 1
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new RangeError('Competition month must be a valid ISO calendar date.');
  }

  return `${match[1]}-${match[2]}-01`;
}
