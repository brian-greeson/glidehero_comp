import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLaunchMapService } from '../../src/services/launchMapService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

const viewerId = '00000000-0000-4000-8000-000000000001';
const followedId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE launches, users CASCADE');
  await database.pool.query(`
    INSERT INTO launches (
      id, name, longitude, latitude, country, state, city, description,
      xc_by_month, timezone_offset, xc_by_year, rank, elevation,
      rank_1, rank_2, rank_3, rank_4, rank_5, rank_6, rank_7, rank_8,
      rank_9, rank_10, rank_11, rank_12, xcontest_launch_site
    ) VALUES
      (1, 'East Dateline', 179.5, 5, 'Fiji', '', 'East', 'Dateline launch', '', 0, '', 0, 100,
       0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
      (2, 'West Dateline', -179.5, 5, 'Fiji', '', 'West', '   ', '', 0, '', 0, 200,
       0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2),
      (3, 'Greenwich', 0, 5, 'United Kingdom', 'England', 'London', 'Prime meridian launch', '', 0, '', 0, 50,
       0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3)
  `);
  await database.pool.query(`
    INSERT INTO users (user_id, email) VALUES
      ($1, 'viewer@example.com'), ($2, 'followed@example.com'), ($3, 'other@example.com')
  `, [viewerId, followedId, otherId]);
  await database.pool.query(`
    INSERT INTO pilot_follows (follower_user_id, followed_user_id) VALUES ($1, $2)
  `, [viewerId, followedId]);
  await addFlight('00000000-0000-4000-8000-000000000011', viewerId, '2026-08-05T12:00:00Z', 1);
  await addFlight('00000000-0000-4000-8000-000000000012', followedId, '2026-07-05T12:00:00Z', 1);
  await addFlight('00000000-0000-4000-8000-000000000013', otherId, '2026-08-10T12:00:00Z', 1);
});
afterAll(async () => { await database?.pool.end(); });

async function addFlight(id: string, userId: string, startedAt: string, launchId: number): Promise<void> {
  const fileId = crypto.randomUUID();
  await database.pool.query(`
    INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key)
    VALUES ($1, $2, 'history.igc', 'text/plain', 1, $3)
  `, [fileId, userId, `launch-map/${fileId}.igc`]);
  await database.pool.query(`
    INSERT INTO flights (
      flight_id, user_id, igc_file_id, content_hash, processing_status, processed_at,
      started_at, launch_latitude, launch_longitude, launch_timezone, launch_id, launch_match_version
    ) VALUES ($1, $2, $3, $4, 'completed', now(), $5, 5, 179.5, 'UTC', $6, 1)
  `, [id, userId, fileId, fileId.replaceAll('-', '').padEnd(64, '0'), startedAt, launchId]);
}

describe('launch map service integration', () => {
  it('lists catalog markers in ordinary and antimeridian-crossing viewports', async () => {
    const service = createLaunchMapService(database.db);
    const ordinary = await service.listViewportMarkers({
      viewport: { west: -1, south: 0, east: 1, north: 10 },
      viewerUserId: viewerId, scope: 'personal', period: 'all-time',
    });
    expect(ordinary.map(({ launchId }) => launchId)).toEqual([3]);
    expect(ordinary[0]?.visited).toBe(false);

    const crossing = await service.listViewportMarkers({
      viewport: { west: 179, south: 0, east: -179, north: 10 },
      viewerUserId: viewerId, scope: 'following', period: 'all-time',
    });
    expect(crossing.map(({ launchId }) => launchId)).toEqual([1, 2]);
    expect(crossing.map(({ visited }) => visited)).toEqual([true, false]);
  });

  it('counts visits under scope and launch-local time filters', async () => {
    const service = createLaunchMapService(database.db);
    const personalAugust = await service.getLaunchDetail({
      launchId: 1,
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'month',
      anchor: '2026-08-15',
    });
    expect(personalAugust).toMatchObject({ matchingFlightCount: 1, visited: true });

    const followingAllTime = await service.getLaunchDetail({
      launchId: 1,
      viewerUserId: viewerId,
      scope: 'following',
      period: 'all-time',
    });
    expect(followingAllTime).toMatchObject({ matchingFlightCount: 2, visited: true });

    const excludedByLaunchFilter = await service.getLaunchDetail({
      launchId: 1,
      viewerUserId: viewerId,
      scope: 'following',
      period: 'all-time',
      launch: 2,
    });
    expect(excludedByLaunchFilter).toMatchObject({ matchingFlightCount: 0, visited: false });

    const allAugust = await service.getLaunchDetail({
      launchId: 1,
      viewerUserId: viewerId,
      scope: 'all',
      period: 'month',
      anchor: '2026-08-01',
    });
    expect(allAugust).toMatchObject({ matchingFlightCount: 2, visited: true });
  });

  it('returns null for a missing launch and null for a blank catalog description', async () => {
    const service = createLaunchMapService(database.db);
    await expect(service.getLaunchDetail({
      launchId: 999,
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'all-time',
    })).resolves.toBeNull();
    await expect(service.getLaunchDetail({
      launchId: 2,
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'all-time',
    })).resolves.toMatchObject({ description: null, matchingFlightCount: 0, visited: false });
  });
});
