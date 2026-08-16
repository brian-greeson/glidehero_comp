import { describe, expect, it, vi } from 'vitest';
import { FlightMapInputError } from '../../src/services/flightMapService.js';
import { createLaunchMapService } from '../../src/services/launchMapService.js';

const viewerUserId = '00000000-0000-4000-8000-000000000001';

function databaseWithRows(rows: unknown[]) {
  return { execute: vi.fn(async () => ({ rows })) };
}

describe('launch map viewport markers', () => {
  it('requires a valid group ID for group scope', async () => {
    const database = databaseWithRows([]);
    const service = createLaunchMapService(database as never);
    const base = { viewport: { west: -106, south: 39, east: -104, north: 41 }, viewerUserId, period: 'all-time' as const };

    await expect(service.listViewportMarkers({ ...base, scope: 'group' } as never)).rejects.toThrow('Group ID is required for group scope.');
    await expect(service.listViewportMarkers({ ...base, scope: 'group', groupId: 'invalid' })).rejects.toThrow('Group ID is invalid.');
    expect(database.execute).not.toHaveBeenCalled();
  });

  it('maps catalog launches in an ordinary viewport', async () => {
    const database = databaseWithRows([{
      launchId: '42',
      name: 'Boulder Launch',
      longitude: '-105.25',
      latitude: '40.02',
      matchingFlightCount: '2',
    }]);
    const service = createLaunchMapService(database as never);

    await expect(service.listViewportMarkers({
      viewport: { west: -106, south: 39, east: -104, north: 41 }, viewerUserId, scope: 'personal', period: 'all-time',
    })).resolves.toEqual([{
      launchId: 42,
      name: 'Boulder Launch',
      longitude: -105.25,
      latitude: 40.02,
      visited: true,
    }]);
    expect(database.execute).toHaveBeenCalledOnce();
  });

  it('accepts an antimeridian-crossing viewport and rejects invalid bounds before querying', async () => {
    const database = databaseWithRows([]);
    const service = createLaunchMapService(database as never);

    await expect(service.listViewportMarkers({
      viewport: { west: 179, south: -10, east: -179, north: 10 }, viewerUserId, scope: 'all', period: 'all-time',
    })).resolves.toEqual([]);
    await expect(service.listViewportMarkers({
      viewport: { west: -181, south: -10, east: -179, north: 10 }, viewerUserId, scope: 'all', period: 'all-time',
    })).rejects.toThrow(FlightMapInputError);
    expect(database.execute).toHaveBeenCalledTimes(1);
  });
});

describe('launch map options', () => {
  it('maps catalog launch options for an ordinary viewport', async () => {
    const database = databaseWithRows([{
      launchId: '42',
      name: 'Boulder Launch',
      state: 'Colorado',
      country: 'United States',
      longitude: '-105.25',
      latitude: '40.02',
    }]);
    const service = createLaunchMapService(database as never);

    await expect(service.listLaunchOptions({
      viewport: { west: -106, south: 39, east: -104, north: 41 },
    })).resolves.toEqual([{
      launchId: 42,
      name: 'Boulder Launch',
      state: 'Colorado',
      country: 'United States',
      longitude: -105.25,
      latitude: 40.02,
    }]);
    expect(database.execute).toHaveBeenCalledOnce();
  });

  it('accepts antimeridian bounds and rejects invalid bounds before querying', async () => {
    const database = databaseWithRows([]);
    const service = createLaunchMapService(database as never);

    await expect(service.listLaunchOptions({
      viewport: { west: 179, south: -10, east: -179, north: 10 },
    })).resolves.toEqual([]);
    await expect(service.listLaunchOptions({
      viewport: { west: -181, south: -10, east: -179, north: 10 },
    })).rejects.toThrow(FlightMapInputError);
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it('trims valid global searches and rejects searches outside the 2-100 character contract', async () => {
    const database = databaseWithRows([]);
    const service = createLaunchMapService(database as never);

    await expect(service.listLaunchOptions({ query: '  Co  ' })).resolves.toEqual([]);
    await expect(service.listLaunchOptions({ query: 'x' })).rejects.toThrow('Launch search must contain between 2 and 100 characters.');
    await expect(service.listLaunchOptions({ query: `ab${'c'.repeat(99)}` })).rejects.toThrow('Launch search must contain between 2 and 100 characters.');
    expect(database.execute).toHaveBeenCalledTimes(1);
  });
});

describe('launch map detail', () => {
  it('returns catalog information and filtered visit state', async () => {
    const database = databaseWithRows([{
      launchId: 42,
      name: 'Boulder Launch',
      longitude: -105.25,
      latitude: 40.02,
      city: 'Boulder',
      state: 'Colorado',
      country: 'United States of America',
      elevationMeters: '2180',
      description: 'A catalog description.',
      matchingFlightCount: '3',
    }]);
    const service = createLaunchMapService(database as never);

    await expect(service.getLaunchDetail({
      launchId: 42,
      viewerUserId,
      scope: 'personal',
      period: 'month',
      anchor: '2026-08-15',
      launch: 42,
    })).resolves.toEqual({
      launchId: 42,
      name: 'Boulder Launch',
      longitude: -105.25,
      latitude: 40.02,
      city: 'Boulder',
      state: 'Colorado',
      country: 'United States of America',
      elevationMeters: 2180,
      description: 'A catalog description.',
      matchingFlightCount: 3,
      visited: true,
    });
    expect(database.execute).toHaveBeenCalledWith(expect.objectContaining({ queryChunks: expect.any(Array) }));
  });

  it('returns null for a missing catalog launch', async () => {
    const service = createLaunchMapService(databaseWithRows([]) as never);
    await expect(service.getLaunchDetail({
      launchId: 404,
      viewerUserId,
      scope: 'all',
      period: 'all-time',
    })).resolves.toBeNull();
  });

  it('supports missing descriptions and an unvisited launch', async () => {
    const service = createLaunchMapService(databaseWithRows([{
      launchId: 7,
      name: 'Quiet Launch',
      longitude: 10,
      latitude: 20,
      city: '',
      state: '',
      country: 'Example',
      elevationMeters: 0,
      description: null,
      matchingFlightCount: 0,
    }]) as never);
    await expect(service.getLaunchDetail({
      launchId: 7,
      viewerUserId,
      scope: 'following',
      period: 'year',
      anchor: '2026-01-01',
    })).resolves.toMatchObject({ description: null, matchingFlightCount: 0, visited: false });
  });

  it('validates launch, viewer, scope, period, and anchor before querying', async () => {
    const database = databaseWithRows([]);
    const service = createLaunchMapService(database as never);
    const valid = { launchId: 1, viewerUserId, scope: 'personal' as const, period: 'month' as const, anchor: '2026-08-01' };

    await expect(service.getLaunchDetail({ ...valid, launchId: 0 })).rejects.toThrow('Launch ID is invalid.');
    await expect(service.getLaunchDetail({ ...valid, viewerUserId: 'invalid' })).rejects.toThrow('Viewer user ID is invalid.');
    await expect(service.getLaunchDetail({ ...valid, scope: 'invalid' as never })).rejects.toThrow('Flight map scope is invalid.');
    await expect(service.getLaunchDetail({ ...valid, period: 'invalid' as never })).rejects.toThrow('Flight map period is invalid.');
    await expect(service.getLaunchDetail({ ...valid, anchor: '2026-02-30' })).rejects.toThrow('Flight map anchor date is invalid.');
    expect(database.execute).not.toHaveBeenCalled();
  });
});
