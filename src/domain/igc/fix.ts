import { IgcParseError } from './errors.js';

function integer(value: string): number {
  if (!/^[-+]?\d+$/.test(value)) throw new IgcParseError('invalid_fix');
  return Number(value);
}

function coordinate(
  degrees: string,
  minutes: string,
  thousandths: string,
  hemisphere: string,
  maximum: number,
  positive: string,
  negative: string,
): number {
  const minuteValue = integer(minutes);
  const thousandthsValue = integer(thousandths);
  const value = integer(degrees) + (minuteValue + thousandthsValue / 1000) / 60;
  if (
    minuteValue > 59
    || thousandthsValue > 999
    || value > maximum
    || (hemisphere !== positive && hemisphere !== negative)
  ) {
    throw new IgcParseError('invalid_fix');
  }
  return hemisphere === negative ? -value : value;
}

export type DecodedFix = {
  time: string;
  latitude: number;
  longitude: number;
  pressureAltitudeMeters: number;
  gpsAltitudeMeters: number;
};

export function decodeValidFix(line: string): DecodedFix | null {
  if (line.length < 35 || line[0] !== 'B') throw new IgcParseError('invalid_fix');
  if (line[24] === 'V') return null;
  if (line[24] !== 'A') throw new IgcParseError('invalid_fix');

  const time = line.slice(1, 7);
  if (!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time)) throw new IgcParseError('invalid_fix');

  return {
    time,
    latitude: coordinate(line.slice(7, 9), line.slice(9, 11), line.slice(11, 14), line[14] ?? '', 90, 'N', 'S'),
    longitude: coordinate(line.slice(15, 18), line.slice(18, 20), line.slice(20, 23), line[23] ?? '', 180, 'E', 'W'),
    pressureAltitudeMeters: integer(line.slice(25, 30)),
    gpsAltitudeMeters: integer(line.slice(30, 35)),
  };
}
