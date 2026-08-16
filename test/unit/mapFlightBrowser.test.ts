import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

// @ts-expect-error Browser assets remain JavaScript.
import { defaultPeriodAnchor, mapFlightListRequestUrl, mapTrackRequestUrl, normalizeFlightListPayload, normalizeTrackPayload, periodStateFromSearch, stepPeriod, trackStatusMessage } from '../../public/scripts/app-ui/mapFlightBrowser.js';

const bounds = { west: -106, south: 39, east: -105, north: 40 };

describe('flight map browser contracts', () => {
  it('uses full date anchors for day, month, and year', () => {
    const now = new Date(2026, 7, 15);
    expect(defaultPeriodAnchor('day', now)).toBe('2026-08-15');
    expect(defaultPeriodAnchor('month', now)).toBe('2026-08-01');
    expect(defaultPeriodAnchor('year', now)).toBe('2026-01-01');
    expect(periodStateFromSearch('?month=2026-07', now)).toEqual({ period: 'month', anchor: '2026-07-01' });
  });

  it('steps calendar periods and leaves All Time stationary', () => {
    expect(stepPeriod({ period: 'day', anchor: '2026-03-01' }, 'previous')).toEqual({ period: 'day', anchor: '2026-02-28' });
    expect(stepPeriod({ period: 'month', anchor: '2026-01-01' }, 'previous')).toEqual({ period: 'month', anchor: '2025-12-01' });
    expect(stepPeriod({ period: 'year', anchor: '2026-01-01' }, 'next')).toEqual({ period: 'year', anchor: '2027-01-01' });
    expect(stepPeriod({ period: 'all-time', anchor: '' }, 'next')).toEqual({ period: 'all-time', anchor: '' });
  });

  it('builds viewport track and global list requests from the same scope and period', () => {
    const period = { period: 'month', anchor: '2026-08-01' };
    const track = new URL(mapTrackRequestUrl('/v1/map-flights/tracks', { scope: 'following', period, bounds, zoom: 8 }), 'https://example.test');
    expect(Object.fromEntries(track.searchParams)).toMatchObject({ scope: 'following', period: 'month', anchor: '2026-08-01', west: '-106', east: '-105', zoom: '8' });
    const list = new URL(mapFlightListRequestUrl('/v1/map-flights', { scope: 'all', period, geography: 'global', sort: 'distance', bounds, cursor: 'next' }), 'https://example.test');
    expect(Object.fromEntries(list.searchParams)).toEqual({ scope: 'all', period: 'month', anchor: '2026-08-01', geography: 'global', sort: 'distance', cursor: 'next' });
  });

  it('includes viewport bounds only when the list uses Map area', () => {
    const url = new URL(mapFlightListRequestUrl('/v1/map-flights', { scope: 'personal', period: { period: 'all-time', anchor: '' }, geography: 'map-area', sort: 'latest', bounds }), 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ scope: 'personal', period: 'all-time', geography: 'map-area', west: '-106', east: '-105' });
  });

  it('normalizes query payload aliases at the browser boundary', () => {
    expect(normalizeTrackPayload({ tracks: [{ flightId: 'f1', pilotUserId: 'p1', track: [[1, 2], [3, 4]] }] })[0]).toMatchObject({ id: 'f1', pilot: { id: 'p1' }, geometry: { type: 'LineString' } });
    expect(normalizeFlightListPayload({ items: [{ flightId: 'f1', pilotDisplayName: 'Pilot', launchName: 'Boulder' }], nextCursor: 'two' })).toMatchObject({ flights: [{ id: 'f1', location: 'Boulder' }], nextCursor: 'two' });
  });

  it('normalizes a viewport-only track into a selectable fallback card', () => {
    const [flight] = normalizeTrackPayload({ tracks: [{
      flightId: 'f2', pilotUserId: 'p2', pilotDisplayName: 'Map Pilot', pilotColor: '#f60',
      startedAt: '2026-08-15T15:00:00Z', durationSeconds: 7380, fivePointDistanceMeters: 32410,
      bounds: { west: -106, south: 39, east: -105, north: 40 },
      geometry: { type: 'MultiLineString', coordinates: [[[-106, 39], [-105, 40]]] },
    }] });
    expect(flight).toMatchObject({
      id: 'f2', href: '/flights/f2', pilot: { id: 'p2', displayName: 'Map Pilot', color: '#f60' },
      distanceLabel: '32.4 km', durationLabel: '2h 3m', location: 'Unknown launch',
    });
  });

  it('makes a truncated viewport result visible instead of silently appearing complete', () => {
    expect(trackStatusMessage([{}], true)).toBe('Some flights are hidden. Zoom in to see all flights in this area.');
    expect(trackStatusMessage([], false)).toBe('No flights in this map area.');
    expect(trackStatusMessage([{}], false)).toBe('');
  });

  it('keeps map selection and flight review as sibling interactive controls', async () => {
    const source = await readFile('public/scripts/app-ui/mapFlightBrowser.js', 'utf8');
    expect(source).toContain("select.className = 'flight-browser-card__select'; select.type = 'button'");
    expect(source).toContain('item.append(select, link)');
    expect(source).toContain("card.querySelector('.flight-browser-card__select')");
    expect(source).not.toContain("item.setAttribute('role', 'button')");
    expect(source).not.toContain('item.tabIndex = 0');
  });
});
