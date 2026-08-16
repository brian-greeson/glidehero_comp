import { describe, expect, it, vi } from 'vitest';
import {
  createFlightMapService,
  decodeFlightMapCursor,
  encodeFlightMapCursor,
  FlightMapInputError,
  validateFlightMapViewport,
} from '../../src/services/flightMapService.js';

const viewerUserId = '00000000-0000-4000-8000-000000000001';
const flightId = '00000000-0000-4000-8000-000000000010';

function databaseWithRows(rows: unknown[]) {
  return {
    execute: vi.fn(async () => ({ rows })),
  };
}

describe('flight map service input contracts', () => {
  it('requires a valid group ID for group scope', async () => {
    const database = databaseWithRows([]);
    const service = createFlightMapService(database as never);
    const base = { viewerUserId, period: 'all-time' as const, geography: 'global' as const, sort: 'latest' as const };

    await expect(service.listFlights({ ...base, scope: 'group', groupId: 'invalid' })).rejects.toThrow('Group ID is invalid.');
    await expect(service.listFlights({ ...base, scope: 'group' } as never)).rejects.toThrow('Group ID is required for group scope.');
    await expect(service.listFlights({ ...base, scope: 'following', groupId: viewerUserId } as never)).rejects.toThrow('Group ID is only valid for group scope.');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('accepts ordinary and antimeridian-crossing viewports', () => {
    expect(validateFlightMapViewport({ west: -106, south: 39, east: -104, north: 41 })).toEqual({
      west: -106,
      south: 39,
      east: -104,
      north: 41,
    });
    expect(validateFlightMapViewport({ west: 179, south: -10, east: -179, north: 10 })).toEqual({
      west: 179,
      south: -10,
      east: -179,
      north: 10,
    });
  });

  it('rejects invalid viewport, period, anchor, and map-area inputs before querying', async () => {
    expect(() => validateFlightMapViewport({ west: -181, south: 39, east: -104, north: 41 })).toThrow(FlightMapInputError);
    expect(() => validateFlightMapViewport({ west: -106, south: 41, east: -104, north: 41 })).toThrow(FlightMapInputError);
    expect(() => validateFlightMapViewport({ west: -106, south: 39, east: -106, north: 41 })).toThrow(FlightMapInputError);

    const database = databaseWithRows([]);
    const service = createFlightMapService(database as never);
    await expect(service.listFlights({
      viewerUserId,
      scope: 'following',
      period: 'month',
      anchor: '2026-02-30',
      geography: 'global',
      sort: 'distance',
    })).rejects.toThrow('Flight map anchor date is invalid.');
    await expect(service.listFlights({
      viewerUserId,
      scope: 'following',
      period: 'all-time',
      anchor: '2026-08-01',
      geography: 'global',
      sort: 'distance',
    })).rejects.toThrow('All-time does not accept date values.');
    await expect(service.listFlights({
      viewerUserId,
      scope: 'following',
      period: 'month',
      anchor: '2026-08-01',
      geography: 'map-area',
      sort: 'distance',
    })).rejects.toThrow('Map-area requires a viewport.');
    await expect(service.listFlights({
      viewerUserId,
      scope: 'personal',
      period: 'custom',
      startDate: '2026-08-10',
      endDate: '2026-08-01',
      geography: 'global',
      sort: 'latest',
    })).rejects.toThrow('Flight map date range is reversed.');
    expect(database.execute).not.toHaveBeenCalled();
  });
});

describe('flight map cursors', () => {
  it('round trips a stable sort cursor and rejects using it with another sort', () => {
    const encoded = encodeFlightMapCursor({
      v: 1,
      sort: 'distance',
      value: 12_345,
      startedAt: '2026-08-01T12:00:00.000Z',
      flightId,
    });
    expect(decodeFlightMapCursor(encoded, 'distance')).toEqual({
      v: 1,
      sort: 'distance',
      value: 12_345,
      startedAt: '2026-08-01T12:00:00.000Z',
      flightId,
    });
    expect(() => decodeFlightMapCursor(encoded, 'latest')).toThrow('Flight map cursor is invalid.');
    expect(() => decodeFlightMapCursor('not-json', 'distance')).toThrow('Flight map cursor is invalid.');
  });
});

describe('flight map read mapping', () => {
  it('selects viewport tracks and reports a capped result as truncated', async () => {
    const geometry = { type: 'MultiLineString' as const, coordinates: [[[-105, 39], [-104, 40]]] };
    const row = {
      flightId,
      pilotUserId: viewerUserId,
      pilotDisplayName: 'Pilot',
      pilotColor: '#1769AA',
      startedAt: '2026-08-01T12:00:00Z',
      durationSeconds: '7200',
      fivePointDistanceMeters: '32000.5',
      west: '-105',
      south: '39',
      east: '-104',
      north: '40',
      crossesAntimeridian: false,
      geometry: JSON.stringify(geometry),
      geometryMinZoom: '8',
    };
    const database = databaseWithRows([row, { ...row, flightId: '00000000-0000-4000-8000-000000000011' }]);
    const service = createFlightMapService(database as never);
    const page = await service.listViewportTracks({
      viewerUserId,
      scope: 'personal',
      period: 'month',
      anchor: '2026-08-15',
      viewport: { west: -106, south: 38, east: -103, north: 41 },
      zoom: 9.5,
      limit: 1,
    });
    expect(page).toEqual({
      truncated: true,
      tracks: [{
        flightId,
        pilotUserId: viewerUserId,
        pilotDisplayName: 'Pilot',
        pilotColor: '#1769AA',
        startedAt: '2026-08-01T12:00:00.000Z',
        durationSeconds: 7200,
        fivePointDistanceMeters: 32000.5,
        bounds: { west: -105, south: 39, east: -104, north: 40, crossesAntimeridian: false },
        geometry,
        geometryMinZoom: 8,
      }],
    });
  });

  it('returns comprehensive completed-flight rows and a load-more cursor', async () => {
    const row = {
      flightId,
      pilotUserId: viewerUserId,
      pilotDisplayName: 'Pilot',
      pilotColor: '#1769AA',
      startedAt: new Date('2026-08-01T12:00:00Z'),
      launchTimezone: 'America/Denver',
      launchId: null,
      launchName: null,
      durationSeconds: 7200,
      fivePointDistanceMeters: 32000,
      launchLatitude: 39,
      launchLongitude: -105,
      landingLatitude: 40,
      landingLongitude: -104,
      west: -105,
      south: 39,
      east: -104,
      north: 40,
      crossesAntimeridian: false,
      sortValue: 32000,
    };
    const nextFlightId = '00000000-0000-4000-8000-000000000011';
    const database = databaseWithRows([row, { ...row, flightId: nextFlightId }]);
    const service = createFlightMapService(database as never);
    const page = await service.listFlights({
      viewerUserId,
      scope: 'following',
      period: 'all-time',
      geography: 'global',
      sort: 'distance',
      limit: 1,
    });
    expect(page.items).toEqual([{
      flightId,
      pilotUserId: viewerUserId,
      pilotDisplayName: 'Pilot',
      pilotColor: '#1769AA',
      startedAt: '2026-08-01T12:00:00.000Z',
      launchTimezone: 'America/Denver',
      launchId: null,
      launchName: null,
      durationSeconds: 7200,
      fivePointDistanceMeters: 32000,
      launchLatitude: 39,
      launchLongitude: -105,
      landingLatitude: 40,
      landingLongitude: -104,
      bounds: { west: -105, south: 39, east: -104, north: 40, crossesAntimeridian: false },
    }]);
    expect(decodeFlightMapCursor(page.nextCursor ?? undefined, 'distance')).toEqual({
      v: 1,
      sort: 'distance',
      value: 32000,
      startedAt: '2026-08-01T12:00:00.000Z',
      flightId,
    });
  });

  it('maps personal summaries', async () => {
    const summaryDatabase = databaseWithRows([{
      totalFlights: '4', fivePointDistanceMeters: '12345.5', airtimeSeconds: '9876', launchesVisited: '2', countriesVisited: '3',
    }]);
    const summary = await createFlightMapService(summaryDatabase as never).getPersonalSummary({
      viewerUserId, scope: 'personal', period: 'all-time', geography: 'global',
    });
    expect(summary).toEqual({ totalFlights: 4, fivePointDistanceMeters: 12345.5, airtimeSeconds: 9876, launchesVisited: 2, countriesVisited: 3 });

  });
});
