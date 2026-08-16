import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFlightMapService } from '../../src/services/flightMapService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

const viewerId = '00000000-0000-4000-8000-000000000001';
const followedId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const ownFlightId = '00000000-0000-4000-8000-000000000011';
const followedFlightId = '00000000-0000-4000-8000-000000000012';
const otherFlightId = '00000000-0000-4000-8000-000000000013';
const groupId = '00000000-0000-4000-8000-000000000101';
const unauthorizedGroupId = '00000000-0000-4000-8000-000000000102';

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE launches, arenas, users CASCADE');
  await database.pool.query(`
    INSERT INTO users (user_id, email) VALUES
      ($1, 'viewer@example.com'), ($2, 'followed@example.com'), ($3, 'other@example.com')
  `, [viewerId, followedId, otherId]);
  await database.pool.query(`
    INSERT INTO profiles (user_id, display_name, territory_color) VALUES
      ($1, 'Viewer', '#111111'), ($2, 'Followed', '#222222'), ($3, 'Other', '#333333')
  `, [viewerId, followedId, otherId]);
  await database.pool.query(`
    INSERT INTO pilot_follows (follower_user_id, followed_user_id) VALUES ($1, $2)
  `, [viewerId, followedId]);
  await database.pool.query(`
    INSERT INTO pilot_groups (group_id, owner_user_id, name) VALUES
      ($1, $3, 'Map Group'), ($2, $3, 'Unauthorized Group')
  `, [groupId, unauthorizedGroupId, otherId]);
  await database.pool.query(`
    INSERT INTO pilot_group_memberships (group_id, user_id, status, accepted_at) VALUES
      ($1, $2, 'accepted', now()), ($1, $3, 'accepted', now()),
      ($1, $4, 'pending', NULL), ($5, $3, 'accepted', now())
  `, [groupId, viewerId, otherId, followedId, unauthorizedGroupId]);
  await addFlight({
    id: ownFlightId,
    userId: viewerId,
    startedAt: '2026-08-01T05:00:00Z', // July 31 in America/Denver
    durationSeconds: 3_600,
    distance: 10_000,
    fullTrack: [[[-106, 39.5], [-103, 39.5]]],
    lodTrack: [[[-106, 39.5], [-103, 39.5]]],
  });
  await addFlight({
    id: followedFlightId,
    userId: followedId,
    startedAt: '2026-07-15T18:00:00Z',
    durationSeconds: 7_200,
    distance: 20_000,
    fullTrack: [[[-105, 39], [-104, 40]]],
    lodTrack: [[[-105, 39], [-104, 40]]],
  });
  await addFlight({
    id: otherFlightId,
    userId: otherId,
    startedAt: '2026-07-10T18:00:00Z',
    durationSeconds: 10_800,
    distance: 30_000,
    fullTrack: [[[-80, 30], [-79, 31]]],
    lodTrack: [[[-80, 30], [-79, 31]]],
  });
});
afterAll(async () => { await database?.pool.end(); });

async function addFlight(input: {
  id: string;
  userId: string;
  startedAt: string;
  durationSeconds: number;
  distance: number;
  fullTrack: number[][][];
  lodTrack: number[][][];
  bounds?: { west: number; south: number; east: number; north: number; crossesAntimeridian: boolean };
}) {
  const fileId = crypto.randomUUID();
  await database.pool.query(`
    INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key)
    VALUES ($1, $2, 'history.igc', 'text/plain', 1, $3)
  `, [fileId, input.userId, `test/${fileId}.igc`]);
  await database.pool.query(`
    INSERT INTO flights (
      flight_id, user_id, igc_file_id, content_hash, processing_status, processed_at,
      started_at, ended_at, duration_seconds, launch_latitude, launch_longitude, launch_timezone
    ) VALUES ($1, $2, $3, $4, 'completed', now(), $5, $5::timestamptz + ($6 * interval '1 second'), $6, 39, -105, 'America/Denver')
  `, [input.id, input.userId, fileId, fileId.replaceAll('-', '').padEnd(64, '0'), input.startedAt, input.durationSeconds]);
  await database.pool.query(`
    INSERT INTO flight_scores (
      flight_id, total_distance_meters, total_distance_calc_version, total_distance_metadata,
      five_point_distance_meters, five_point_distance_calc_version, five_point_distance_metadata
    ) VALUES ($1, $2, 1, '{"pointCount":2}', $2, 1, '{"pointIndices":[0,1]}')
  `, [input.id, input.distance]);
  const fullGeometry = JSON.stringify({ type: 'MultiLineString', coordinates: input.fullTrack });
  const storedBounds = input.bounds;
  await database.pool.query(`
    INSERT INTO flight_map_features (
      flight_id, projection_version, full_track, west, south, east, north,
      crosses_antimeridian, landing_latitude, landing_longitude, source_point_count
    ) VALUES (
      $1, 1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geometry(MultiLineString,4326),
      COALESCE($3, ST_XMin(Box3D(ST_GeomFromGeoJSON($2)))::double precision),
      COALESCE($4, ST_YMin(Box3D(ST_GeomFromGeoJSON($2)))::double precision),
      COALESCE($5, ST_XMax(Box3D(ST_GeomFromGeoJSON($2)))::double precision),
      COALESCE($6, ST_YMax(Box3D(ST_GeomFromGeoJSON($2)))::double precision),
      COALESCE($7, false), 40, -104, 2
    )
  `, [input.id, fullGeometry, storedBounds?.west ?? null, storedBounds?.south ?? null, storedBounds?.east ?? null, storedBounds?.north ?? null, storedBounds?.crossesAntimeridian ?? null]);
  await database.pool.query(`
    INSERT INTO flight_map_geometry_lods (
      flight_id, projection_version, min_zoom, max_zoom, tolerance_meters, geometry, point_count
    ) VALUES ($1, 1, 8, 10, 50, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geometry(MultiLineString,4326), 2)
  `, [input.id, JSON.stringify({ type: 'MultiLineString', coordinates: input.lodTrack })]);
}

describe('flight map service', () => {
  it('authorizes group scope and includes only accepted roster flights across list, tracks, and selection', async () => {
    const service = createFlightMapService(database.db);
    const filter = { viewerUserId: viewerId, scope: 'group' as const, groupId, period: 'all-time' as const };

    await expect(service.listFlights({ ...filter, geography: 'global', sort: 'latest' })).resolves.toMatchObject({
      items: [expect.objectContaining({ flightId: ownFlightId }), expect.objectContaining({ flightId: otherFlightId })],
    });
    await expect(service.getFlight({ ...filter, geography: 'global', flightId: followedFlightId })).resolves.toBeNull();
    await expect(service.getFlight({ ...filter, geography: 'global', flightId: otherFlightId })).resolves.toMatchObject({ flightId: otherFlightId });
    await expect(service.listViewportTracks({
      ...filter, viewport: { west: -107, south: 29, east: -78, north: 41 }, zoom: 8,
    })).resolves.toMatchObject({ tracks: [
      expect.objectContaining({ flightId: otherFlightId }),
      expect.objectContaining({ flightId: ownFlightId }),
    ] });

    await expect(service.listFlights({
      ...filter, groupId: unauthorizedGroupId, geography: 'global', sort: 'latest',
    })).resolves.toMatchObject({ items: [] });
  });

  it('lists completed historical flights by launch-local period, scope, distance, and stable cursor', async () => {
    const service = createFlightMapService(database.db);
    const first = await service.listFlights({
      viewerUserId: viewerId,
      scope: 'following',
      period: 'month',
      anchor: '2026-07-20',
      geography: 'global',
      sort: 'distance',
      limit: 1,
    });
    expect(first.items.map((flight) => flight.flightId)).toEqual([followedFlightId]);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.listFlights({
      viewerUserId: viewerId,
      scope: 'following',
      period: 'month',
      anchor: '2026-07-20',
      geography: 'global',
      sort: 'distance',
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    });
    expect(second.items.map((flight) => flight.flightId)).toEqual([ownFlightId]);
    expect(second.nextCursor).toBeNull();

    const personalDay = await service.listFlights({
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'day',
      anchor: '2026-07-31',
      geography: 'global',
      sort: 'latest',
    });
    expect(personalDay.items.map((flight) => flight.flightId)).toEqual([ownFlightId]);

    const all = await service.listFlights({
      viewerUserId: viewerId,
      scope: 'all',
      period: 'all-time',
      geography: 'global',
      sort: 'duration',
    });
    expect(all.items.map((flight) => flight.flightId)).toEqual([otherFlightId, followedFlightId, ownFlightId]);
  });

  it('uses full geometry for map-area eligibility and zoom-selected geometry for rendering', async () => {
    const service = createFlightMapService(database.db);
    const viewport = { west: -105.5, south: 38.5, east: -103.5, north: 40.5 };
    const area = await service.listFlights({
      viewerUserId: viewerId,
      scope: 'all',
      period: 'year',
      anchor: '2026-01-01',
      geography: 'map-area',
      viewport,
      sort: 'distance',
    });
    expect(area.items.map((flight) => flight.flightId)).toEqual([followedFlightId, ownFlightId]);

    const overview = await service.listViewportTracks({
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'all-time',
      viewport,
      zoom: 9.5,
    });
    expect(overview.tracks).toHaveLength(1);
    expect(overview.tracks[0]?.geometryMinZoom).toBe(8);

    const detail = await service.listViewportTracks({
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'all-time',
      viewport,
      zoom: 13,
    });
    expect(detail.tracks).toHaveLength(1);
    expect(detail.tracks[0]?.geometryMinZoom).toBeNull();
  });

  it('splits an antimeridian viewport and preserves exact crossing bounds', async () => {
    const crossingFlightId = '00000000-0000-4000-8000-000000000014';
    await addFlight({
      id: crossingFlightId,
      userId: viewerId,
      startedAt: '2026-07-20T18:00:00Z',
      durationSeconds: 1_800,
      distance: 5_000,
      fullTrack: [[[179, 10], [180, 10]], [[-180, 10], [-179, 10]]],
      lodTrack: [[[179, 10], [180, 10]], [[-180, 10], [-179, 10]]],
      bounds: { west: 179, south: 10, east: -179, north: 10, crossesAntimeridian: true },
    });
    const service = createFlightMapService(database.db);
    const page = await service.listFlights({
      viewerUserId: viewerId,
      scope: 'personal',
      period: 'all-time',
      geography: 'map-area',
      viewport: { west: 179, south: 9, east: -179, north: 11 },
      sort: 'distance',
    });
    expect(page.items.map((flight) => flight.flightId)).toEqual([crossingFlightId]);
    expect(page.items[0]?.bounds).toEqual({ west: 179, south: 10, east: -179, north: 10, crossesAntimeridian: true });
  });

  it('keeps summaries, custom dates, and selected-flight eligibility on one filter contract', async () => {
    await database.pool.query(`
      INSERT INTO launches (
        id, name, longitude, latitude, country, state, city, description,
        xc_by_month, timezone_offset, xc_by_year, rank, elevation,
        rank_1, rank_2, rank_3, rank_4, rank_5, rank_6, rank_7, rank_8,
        rank_9, rank_10, rank_11, rank_12, xcontest_launch_site
      ) VALUES (42, 'Known Launch', -105, 39, 'United States', 'Colorado', 'Boulder', '', '', 0, '', 0, 2000,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42)
    `);
    await database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_source, external_id)
      VALUES (9000, 'United States', 'United States', 'US',
        ST_Multi(ST_Transform(ST_MakeEnvelope(-110, 35, -100, 45, 4326), 6933))::geometry(MultiPolygon,6933),
        'country', 'test-country', 'US')
    `);
    const service = createFlightMapService(database.db);
    const filter = { viewerUserId: viewerId, scope: 'personal' as const, period: 'custom' as const, startDate: '2026-07-31', endDate: '2026-07-31', geography: 'global' as const };

    await expect(service.getPersonalSummary({ ...filter, launch: 'unknown' })).resolves.toMatchObject({
      totalFlights: 1, launchesVisited: 1,
    });
    await database.pool.query('UPDATE flights SET launch_id = 42, launch_match_version = 1 WHERE flight_id = $1', [ownFlightId]);

    await expect(service.getPersonalSummary(filter)).resolves.toEqual({
      totalFlights: 1, fivePointDistanceMeters: 10_000, airtimeSeconds: 3_600, launchesVisited: 1, countriesVisited: 1,
    });
    await expect(service.getFlight({ ...filter, flightId: ownFlightId })).resolves.toMatchObject({ flightId: ownFlightId, launchId: 42, launchName: 'Known Launch' });
    await expect(service.getFlight({ ...filter, flightId: ownFlightId, launch: 'unknown' })).resolves.toBeNull();
  });
});
