export const REGULAR_FLIGHT_WINDOW_DAYS = 30;

export type FlightUploadWindowResult =
  | { accepted: true; ageDays: number }
  | { accepted: false; reason: 'future' | 'too_old'; ageDays: number };

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function calendarDateInTimeZone(value: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const parsed = Number(parts.find((candidate) => candidate.type === type)?.value);
    if (!Number.isInteger(parsed)) throw new Error(`Unable to resolve ${type} in ${timeZone}.`);
    return parsed;
  };
  return { year: part('year'), month: part('month'), day: part('day') };
}

function serialDay({ year, month, day }: CalendarDate): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function regularFlightUploadWindow(
  startedAt: Date,
  launchTimeZone: string,
  now = new Date(),
): FlightUploadWindowResult {
  const ageDays = serialDay(calendarDateInTimeZone(now, launchTimeZone))
    - serialDay(calendarDateInTimeZone(startedAt, launchTimeZone));
  if (ageDays < 0) return { accepted: false, reason: 'future', ageDays };
  if (ageDays > REGULAR_FLIGHT_WINDOW_DAYS) return { accepted: false, reason: 'too_old', ageDays };
  return { accepted: true, ageDays };
}
