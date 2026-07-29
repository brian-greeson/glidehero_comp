import { describe, expect, it } from 'vitest';
import {
  REGULAR_FLIGHT_WINDOW_DAYS,
  regularFlightUploadWindow,
} from '../../src/domain/igc/flightUploadWindow.js';

describe('regularFlightUploadWindow', () => {
  it('accepts today and the inclusive launch-local 30-day boundary', () => {
    const now = new Date('2026-07-28T06:30:00.000Z');

    expect(regularFlightUploadWindow(
      new Date('2026-07-28T07:30:00.000Z'),
      'America/Denver',
      now,
    )).toEqual({ accepted: true, ageDays: 0 });
    expect(regularFlightUploadWindow(
      new Date('2026-06-28T18:00:00.000Z'),
      'America/Denver',
      now,
    )).toEqual({ accepted: true, ageDays: REGULAR_FLIGHT_WINDOW_DAYS });
  });

  it('rejects older and future launch-local calendar dates', () => {
    const now = new Date('2026-07-28T06:30:00.000Z');

    expect(regularFlightUploadWindow(
      new Date('2026-06-27T18:00:00.000Z'),
      'America/Denver',
      now,
    )).toEqual({ accepted: false, reason: 'too_old', ageDays: 31 });
    expect(regularFlightUploadWindow(
      new Date('2026-07-29T18:00:00.000Z'),
      'America/Denver',
      now,
    )).toEqual({ accepted: false, reason: 'future', ageDays: -1 });
  });

  it('uses the launch timezone across UTC date and daylight-saving boundaries', () => {
    expect(regularFlightUploadWindow(
      new Date('2026-03-08T07:30:00.000Z'),
      'America/Denver',
      new Date('2026-04-07T06:30:00.000Z'),
    )).toEqual({ accepted: true, ageDays: 30 });

    expect(regularFlightUploadWindow(
      new Date('2026-07-28T00:30:00.000Z'),
      'Pacific/Kiritimati',
      new Date('2026-07-28T23:30:00.000Z'),
    )).toEqual({ accepted: true, ageDays: 1 });
  });
});
