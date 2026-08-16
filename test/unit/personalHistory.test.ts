import { describe, expect, it } from 'vitest';
// @ts-expect-error Browser assets remain JavaScript.
import { personalHistoryRequestUrl, personalHistorySummaryLabels } from '../../public/scripts/app-ui/personalHistory.js';

describe('personal history browser contracts', () => {
  it('builds all-time and custom map-area requests', () => {
    const all = new URL(personalHistoryRequestUrl('/v1/personal-history/summary', {
      period: { period: 'all-time' }, geography: 'global', launch: 'unknown',
    }), 'https://example.test');
    expect(Object.fromEntries(all.searchParams)).toEqual({ scope: 'personal', period: 'all-time', geography: 'global', launch: 'unknown' });
    const custom = new URL(personalHistoryRequestUrl('/v1/personal-history/summary', {
      period: { period: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' }, geography: 'map-area',
      bounds: { west: -106, south: 39, east: -105, north: 40 }, launch: 42,
    }), 'https://example.test');
    expect(Object.fromEntries(custom.searchParams)).toMatchObject({ period: 'custom', start: '2026-01-01', end: '2026-01-31', launch: '42', west: '-106' });
  });

  it('formats the five summaries', () => {
    expect(personalHistorySummaryLabels({ totalFlights: 3, fivePointDistanceMeters: 12_345, airtimeSeconds: 7_500, launchesVisited: 2, countriesVisited: 1 }))
      .toEqual({ totalFlights: '3', fivePointDistanceMeters: '12.3 km', airtimeSeconds: '2h 5m', launchesVisited: '2', countriesVisited: '1' });
  });
});
