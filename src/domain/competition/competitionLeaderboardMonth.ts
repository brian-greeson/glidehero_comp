const competitionLeaderboardMonthPattern = /^(\d{4})-(\d{2})$/;

export function normalizeCompetitionLeaderboardMonth(input: string): string {
  const match = competitionLeaderboardMonthPattern.exec(input);
  if (!match) throw new RangeError('Competition month must use YYYY-MM.');

  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new RangeError('Competition month must use YYYY-MM.');

  return `${match[1]}-${match[2]}-01`;
}
