import { totalDistanceMeters } from './distance.js';
import { IgcParseError } from './errors.js';
import { decodeValidFix } from './fix.js';
import { parseIgcDate, timestampForFix } from './timestamp.js';
import type { IgcFix, ParsedIgcFlight } from './types.js';

export function parseIgcFlight(source: string): ParsedIgcFlight {
  const lines = source.split(/\r?\n/).filter(Boolean);
  if (!lines.some((line) => /^A[A-Z0-9]{3}/.test(line))) {
    throw new IgcParseError('missing_manufacturer');
  }

  const dateLine = lines.find((line) => line.startsWith('HFDTE'));
  if (!dateLine) throw new IgcParseError('missing_date');
  const date = parseIgcDate(dateLine);
  const points: IgcFix[] = [];

  for (const line of lines.filter((candidate) => candidate.startsWith('B'))) {
    const decoded = decodeValidFix(line);
    if (!decoded) continue;
    const recordedAt = timestampForFix(date, decoded.time, points.at(-1)?.recordedAt);
    points.push({
      sequenceNumber: points.length,
      recordedAt,
      latitude: decoded.latitude,
      longitude: decoded.longitude,
      pressureAltitudeMeters: decoded.pressureAltitudeMeters,
      gpsAltitudeMeters: decoded.gpsAltitudeMeters,
    });
  }

  if (points.length < 2) throw new IgcParseError('insufficient_fixes');
  const first = points[0]!;
  const last = points.at(-1)!;
  return {
    points,
    startedAt: first.recordedAt,
    endedAt: last.recordedAt,
    durationSeconds: (last.recordedAt.getTime() - first.recordedAt.getTime()) / 1000,
    distanceMeters: totalDistanceMeters(points),
    launchLatitude: first.latitude,
    launchLongitude: first.longitude,
  };
}
