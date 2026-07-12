import { IgcParseError } from './errors.js';

export function parseIgcDate(line: string): Date {
  const match = /^HFDTE(\d{2})(\d{2})(\d{2})/.exec(line);
  if (!match) throw new IgcParseError('invalid_date');

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const shortYear = Number(yearText);
  const year = shortYear >= 80 ? 1900 + shortYear : 2000 + shortYear;
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) {
    throw new IgcParseError('invalid_date');
  }
  return value;
}

export function timestampForFix(date: Date, time: string, previous: Date | undefined): Date {
  const value = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  ));
  while (previous && value < previous) value.setUTCDate(value.getUTCDate() + 1);
  return value;
}
