import { describe, expect, it } from 'vitest';
import { IgcParseError } from '../../src/domain/igc/errors.js';
import { parseIgcFlight } from '../../src/domain/igc/parseIgcFlight.js';

const validIgc = [
  'AXXXGLIDEHERO',
  'HFDTE120726',
  'B2359584000000N10500000WA0123401234',
  'B0000024000060N10500060WA0123501235',
].join('\r\n');

describe('parseIgcFlight', () => {
  it('returns ordered UTC fixes and the derived flight summary across midnight', () => {
    const flight = parseIgcFlight(validIgc);

    expect(flight.points).toHaveLength(2);
    expect(flight.points[0]).toMatchObject({
      sequenceNumber: 0,
      latitude: 40,
      longitude: -105,
      pressureAltitudeMeters: 1234,
      gpsAltitudeMeters: 1234,
    });
    expect(flight.points[1]?.recordedAt.toISOString()).toBe('2026-07-13T00:00:02.000Z');
    expect(flight.launchLatitude).toBe(40);
    expect(flight.launchLongitude).toBe(-105);
    expect(flight.durationSeconds).toBe(4);
    expect(flight.distanceMeters).toBeGreaterThan(135);
    expect(flight.distanceMeters).toBeLessThan(145);
  });

  it('rejects a file without a manufacturer record', () => {
    expect(() => parseIgcFlight('HFDTE120726\nB1200004000000N10500000WA0000000000'))
      .toThrow(new IgcParseError('missing_manufacturer'));
  });

  it('rejects a file without a date header', () => {
    expect(() => parseIgcFlight('AXXXGLIDEHERO\nB1200004000000N10500000WA0000000000'))
      .toThrow(new IgcParseError('missing_date'));
  });

  it('rejects malformed calendar dates', () => {
    expect(() => parseIgcFlight('AXXXGLIDEHERO\nHFDTE310226\nB1200004000000N10500000WA0000000000'))
      .toThrow(new IgcParseError('invalid_date'));
  });

  it('rejects malformed B records', () => {
    const source = ['AXXXGLIDEHERO', 'HFDTE120726', 'B1200004000000N10500000WX0000000000'].join('\n');
    expect(() => parseIgcFlight(source)).toThrow(new IgcParseError('invalid_fix'));
  });

  it('rejects out-of-range coordinates', () => {
    const source = ['AXXXGLIDEHERO', 'HFDTE120726', 'B1200009100000N10500000WA0000000000'].join('\n');
    expect(() => parseIgcFlight(source)).toThrow(new IgcParseError('invalid_fix'));
  });

  it('ignores invalid fixes and rejects when fewer than two valid fixes remain', () => {
    const source = ['AXXXGLIDEHERO', 'HFDTE120726', 'B1200004000000N10500000WV0000000000'].join('\n');
    expect(() => parseIgcFlight(source)).toThrow(new IgcParseError('insufficient_fixes'));
  });

  it('accepts identical valid fixes with zero distance', () => {
    const source = [
      'AXXXGLIDEHERO',
      'HFDTE120726',
      'B1200004000000N10500000WA0000000000',
      'B1200014000000N10500000WA0000000000',
    ].join('\n');

    expect(parseIgcFlight(source).distanceMeters).toBe(0);
  });
});
