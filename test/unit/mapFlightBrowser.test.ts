import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

// @ts-expect-error Browser assets remain JavaScript.
import { defaultPeriodAnchor, mapFlightListRequestUrl, mapFlightSelectionRequestUrl, mapTrackRequestUrl, normalizeFlightListPayload, normalizeTrackPayload, periodStateFromSearch, stepPeriod, trackStatusMessage } from '../../public/scripts/app-ui/mapFlightBrowser.js';

const bounds = { west: -106, south: 39, east: -105, north: 40 };

describe('flight map browser contracts', () => {
  it('uses full date anchors for day, month, and year', () => {
    const now = new Date(2026, 7, 15);
    expect(defaultPeriodAnchor('day', now)).toBe('2026-08-15');
    expect(defaultPeriodAnchor('month', now)).toBe('2026-08-01');
    expect(defaultPeriodAnchor('year', now)).toBe('2026-01-01');
    expect(periodStateFromSearch('?month=2026-07', now)).toEqual({ period: 'month', anchor: '2026-07-01' });
    expect(periodStateFromSearch('?period=custom&start=2026-06-01&end=2026-08-15', now)).toEqual({ period: 'custom', startDate: '2026-06-01', endDate: '2026-08-15' });
    expect(periodStateFromSearch('?period=custom&start=2026-02-30&end=2026-03-01', now, 'all-time')).toEqual({ period: 'custom', startDate: '2026-08-15', endDate: '2026-08-15' });
    expect(periodStateFromSearch('?period=day&anchor=2026-08-15', now, 'all-time')).toEqual({ period: 'all-time', anchor: '' });
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

  it('carries catalog and Unknown launch filters through both flight requests', () => {
    const period = { period: 'all-time', anchor: '' };
    const track = new URL(mapTrackRequestUrl('/v1/map-flights/tracks', { scope: 'personal', period, bounds, zoom: 8, launch: '42' }), 'https://example.test');
    const list = new URL(mapFlightListRequestUrl('/v1/map-flights', { scope: 'personal', period, geography: 'global', sort: 'latest', bounds, launch: 'unknown' }), 'https://example.test');
    expect(track.searchParams.get('launch')).toBe('42');
    expect(list.searchParams.get('launch')).toBe('unknown');
  });

  it('revalidates a selected flight against custom dates, launch, and map area', () => {
    const url = new URL(mapFlightSelectionRequestUrl('/v1/map-flights/{flightId}', '00000000-0000-4000-8000-000000000010', {
      scope: 'personal', period: { period: 'custom', startDate: '2026-06-01', endDate: '2026-08-15' },
      geography: 'map-area', bounds, launch: 'unknown',
    }), 'https://example.test');
    expect(url.pathname).toBe('/v1/map-flights/00000000-0000-4000-8000-000000000010');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ period: 'custom', start: '2026-06-01', end: '2026-08-15', geography: 'map-area', launch: 'unknown', west: '-106' });
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

  it('revalidates and reinserts an off-page selection after sorting', async () => {
    const source = await readFile('public/scripts/app-ui/mapFlightBrowser.js', 'utf8');
    expect(source).toContain("sort?.addEventListener('change', () => { syncUrl({ push: true }); void refreshListAndSelection(); })");
    expect(source).toContain('const refreshListAndSelection = async () => {');
    expect(source).toContain('if (selectedFlightId) await revalidateSelectedFlight();');
  });

  it('ignores transient replay camera moveend events', async () => {
    const source = await readFile('public/scripts/app-ui/mapFlightBrowser.js', 'utf8');
    expect(source).toContain("map.on?.('moveend', (event) => {");
    expect(source).toContain('if (isMapReplayCameraMoveEvent(event)) return;');
  });

  it('keeps searchable launch filtering distinct from informational marker selection', async () => {
    const source = await readFile('public/scripts/app-ui/mapFlightBrowser.js', 'utf8');
    expect(source).toContain('launchSelector = initializeLaunchSelector({');
    expect(source).toContain("launchFilter = String(launch.launchId);");
    expect(source).toContain("map.easeTo?.({ center: [Number(launch.longitude), Number(launch.latitude)], zoom: 12, duration: 500 });");
    expect(source).toContain("map.on?.('click', LAUNCH_MARKER_LAYER_ID, (event) => {");
    expect(source).toContain('if (Number.isSafeInteger(launchId) && launchId > 0) void selectLaunch(launchId);');
    expect(source).toContain('launchSelector?.refreshViewport();');
  });

  it('hydrates numeric launch-filter labels independently of the information panel', async () => {
    const source = await readFile('public/scripts/app-ui/mapFlightBrowser.js', 'utf8');
    expect(source).toContain('const hydrateLaunchFilter = async () => {');
    expect(source).toContain("String(launchFilter) === String(launchId)");
    expect(source).toContain('else void hydrateLaunchFilter();');
    expect(source).toContain('launchFilterDetailAbort?.abort();');
  });
});
