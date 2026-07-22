import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { achievementRecordEvents, achievementRecords, achievements, activities, activityReactions, arenaLeadershipEvents, arenaLeadershipStates, arenas, flightProgress, flights, igcFiles, profiles } from '../../src/db/schema.js';
import { createAuthService } from '../../src/services/authService.js';
import { createFollowService } from '../../src/services/followService.js';
import { ActivityCursorError, createActivityService } from '../../src/services/activityService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database?.pool.query('TRUNCATE TABLE users, arenas CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

describe('activityService.listFeed', () => {
  async function createFlight(userId: string, input: {
    startedAt: Date;
    launchTimezone: string;
    launchLatitude: number;
    launchLongitude: number;
    durationSeconds: number;
    distanceMeters: number;
    directCellCount: number;
    enclosedCellCount: number;
  }) {
    if (!database) throw new Error('Test database was not initialized.');
    const [igc] = await database.db.insert(igcFiles).values({
      userId,
      originalFilename: `${crypto.randomUUID()}.igc`,
      contentType: 'application/octet-stream',
      byteSize: 1,
      bucketKey: `activity/${crypto.randomUUID()}`,
    }).returning({ id: igcFiles.id });
    if (!igc) throw new Error('IGC insert returned no row.');
    const [flight] = await database.db.insert(flights).values({
      userId,
      igcFileId: igc.id,
      contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
      processingStatus: 'completed',
      ...input,
    }).returning({ id: flights.id });
    if (!flight) throw new Error('Flight insert returned no row.');
    await database.db.insert(flightProgress).values({
      flightId: flight.id,
      userId,
      directCellCount: input.directCellCount,
      enclosedCellCount: input.enclosedCellCount,
      newPersonalCellCount: 0,
      personalCellTotalAfter: input.directCellCount + input.enclosedCellCount,
    });
    return flight.id;
  }

  it('joins a current flight summary, launch Arena, and launch-time-zone date in one feed read', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({ email: 'flight-summary@example.com', password: 'correct horse battery staple', displayName: 'Summary Pilot' });
    // Two overlapping polygons prove deterministic source_id selection.
    await database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type)
      VALUES
        (1002, 'Later Site', 'United States', 'US', ST_Multi(ST_GeomFromText('POLYGON((-20000000 -10000000,20000000 -10000000,20000000 10000000,-20000000 10000000,-20000000 -10000000))', 6933)), 'launch'),
        (1001, 'Early Site', 'United States', 'US', ST_Multi(ST_GeomFromText('POLYGON((-20000000 -10000000,20000000 -10000000,20000000 10000000,-20000000 10000000,-20000000 -10000000))', 6933)), 'launch')
    `);
    const flightId = await createFlight(pilot.user.userId, {
      startedAt: new Date('2026-07-20T01:30:00Z'), launchTimezone: 'America/Denver',
      launchLatitude: 39.7392, launchLongitude: -104.9903,
      durationSeconds: 3_661, distanceMeters: 1_500, directCellCount: 4, enclosedCellCount: 3,
    });
    await database.db.insert(activities).values({ actorUserId: pilot.user.userId, activityType: 'flight', sourceFlightId: flightId, publishedAt: new Date('2026-07-21T00:00:00Z') });
    const item = (await createActivityService(database.db).listFeed({ viewerUserId: pilot.user.userId })).items[0];
    expect(item).toMatchObject({
      flightDate: 'Jul 19, 2026', duration: '1h 01m', distance: '1.5 km', totalCellCount: 7,
      location: 'Early Site', launchArenaName: 'Early Site', launchArenaPath: '/arena/us/early-site-1001',
    });
  });

  it('loads and groups every accomplishment for a flight in bounded batches', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({ email: 'accomplishments@example.com', password: 'correct horse battery staple', displayName: 'Accomplishment Pilot' });
    const flightId = await createFlight(pilot.user.userId, {
      startedAt: new Date('2026-07-21T12:00:00Z'), launchTimezone: 'UTC', launchLatitude: 0, launchLongitude: 0,
      durationSeconds: 60, distanceMeters: 1000, directCellCount: 3, enclosedCellCount: 2,
    });
    const arenaIds = (await database.pool.query<{ id: string }>(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type)
      VALUES
        (2001, 'North Basin', 'United States', 'US', ST_Multi(ST_GeomFromText('POLYGON((-20000000 -10000000,20000000 -10000000,20000000 10000000,-20000000 10000000,-20000000 -10000000))', 6933)), 'general'),
        (2002, 'South Basin', 'United States', 'US', ST_Multi(ST_GeomFromText('POLYGON((-20000000 -10000000,20000000 -10000000,20000000 10000000,-20000000 10000000,-20000000 -10000000))', 6933)), 'general')
      RETURNING id
    `)).rows.map((row) => row.id);
    await database.db.insert(arenaLeadershipStates).values(arenaIds.map((arenaId) => ({ arenaId, arenaType: 'general' as const })));
    await database.db.insert(activities).values({ actorUserId: pilot.user.userId, activityType: 'flight', sourceFlightId: flightId, publishedAt: new Date('2026-07-21T13:00:00Z') });
    await database.db.insert(achievements).values([
      { userId: pilot.user.userId, achievementType: 'unique_cells_milestone', achievementKey: `unique-cells:${flightId}`, sourceFlightId: flightId, earnedAt: new Date('2026-07-21T12:01:00Z'), details: { milestone: 10, newCells: 5, newTotal: 10 } },
      { userId: pilot.user.userId, achievementType: 'personal_best_total_cells', achievementKey: `personal-best-total-cells:${flightId}`, sourceFlightId: flightId, earnedAt: new Date('2026-07-21T12:02:00Z'), details: { previousRecord: 3, newRecord: 5, directCells: 3, enclosedCells: 2 } },
      { userId: pilot.user.userId, achievementType: 'personal_best_enclosed_cells', achievementKey: `personal-best-enclosed-cells:${flightId}`, sourceFlightId: flightId, earnedAt: new Date('2026-07-21T12:03:00Z'), details: { previousRecord: 1, newRecord: 2, directCells: 3, enclosedCells: 2 } },
      { userId: pilot.user.userId, achievementType: 'special', achievementKey: 'took_lead_in_arena', sourceFlightId: flightId, earnedAt: new Date('2026-07-21T12:04:00Z'), details: { arenaId: arenaIds[0], arenaName: 'North Basin' } },
    ]);
    const [record] = await database.db.insert(achievementRecords).values({ userId: pilot.user.userId, recordKey: 'most_launches_tagged_one_flight', bestValue: 4, sourceFlightId: flightId, earnedAt: new Date('2026-07-21T12:05:00Z'), details: { value: 4 } }).returning({ id: achievementRecords.id });
    if (!record) throw new Error('Record insert failed.');
    await database.db.insert(achievementRecordEvents).values({ recordId: record.id, userId: pilot.user.userId, sourceFlightId: flightId, value: 4, earnedAt: new Date('2026-07-21T12:05:00Z'), details: { previousValue: 2, value: 4 } });
    await database.db.insert(arenaLeadershipEvents).values([
      { eventKey: `took:${flightId}:north`, arenaId: arenaIds[0]!, userId: pilot.user.userId, eventType: 'took', claimTimestamp: new Date('2026-07-21T12:06:00Z'), sourceFlightId: flightId, cellX: 1, cellY: 1 },
      { eventKey: `reclaimed:${flightId}:south`, arenaId: arenaIds[1]!, userId: pilot.user.userId, eventType: 'reclaimed', claimTimestamp: new Date('2026-07-21T12:07:00Z'), sourceFlightId: flightId, cellX: 2, cellY: 2 },
      { eventKey: `lost:${flightId}:north`, arenaId: arenaIds[0]!, userId: pilot.user.userId, eventType: 'lost', claimTimestamp: new Date('2026-07-21T12:08:00Z'), sourceFlightId: flightId, cellX: 3, cellY: 3 },
    ]);

    const item = (await createActivityService(database.db).listFeed({ viewerUserId: pilot.user.userId })).items[0];
    expect(item?.accomplishments).toHaveLength(6);
    expect(item?.accomplishments.map((accomplishment) => accomplishment.title)).toEqual([
      '10 Unique Cells', 'New Flight Cell Record', 'New Enclosed Cell Record', 'Most Launches Tagged During One Flight', 'Took the Lead in North Basin', 'Reclaimed the Lead in South Basin',
    ]);
    expect(item?.accomplishments.find((accomplishment) => accomplishment.title === 'Took the Lead in North Basin')).toMatchObject({ arenaPath: '/arena/us/north-basin-2001' });
    expect(item?.accomplishments.find((accomplishment) => accomplishment.title === 'Reclaimed the Lead in South Basin')).toMatchObject({ arenaPath: '/arena/us/south-basin-2002' });
    expect(item?.accomplishments.some((accomplishment) => accomplishment.title === 'Progress Achievement')).toBe(false);
  });

  it('keeps a flight card with no accomplishments', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({ email: 'no-accomplishments@example.com', password: 'correct horse battery staple', displayName: 'No Accomplishments' });
    const flightId = await createFlight(pilot.user.userId, {
      startedAt: new Date('2026-07-21T12:00:00Z'), launchTimezone: 'UTC', launchLatitude: 0, launchLongitude: 0,
      durationSeconds: 1, distanceMeters: 0, directCellCount: 0, enclosedCellCount: 0,
    });
    await database.db.insert(activities).values({ actorUserId: pilot.user.userId, activityType: 'flight', sourceFlightId: flightId, publishedAt: new Date('2026-07-21T13:00:00Z') });
    expect((await createActivityService(database.db).listFeed({ viewerUserId: pilot.user.userId })).items[0]?.accomplishments).toEqual([]);
  });

  it('rounds coordinate fallback to four decimals and tolerates absent coordinates', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({ email: 'flight-location@example.com', password: 'correct horse battery staple', displayName: 'Location Pilot' });
    const flightId = await createFlight(pilot.user.userId, {
      startedAt: new Date('2026-07-20T12:00:00Z'), launchTimezone: 'UTC',
      launchLatitude: 12.345678, launchLongitude: -98.765432,
      durationSeconds: 1, distanceMeters: 0, directCellCount: 0, enclosedCellCount: 0,
    });
    await database.db.insert(activities).values({ actorUserId: pilot.user.userId, activityType: 'flight', sourceFlightId: flightId, publishedAt: new Date('2026-07-21T00:00:00Z') });
    const item = (await createActivityService(database.db).listFeed({ viewerUserId: pilot.user.userId })).items[0];
    expect(item?.location).toBe('12.3457, -98.7654');
  });

  it('includes own and currently followed activity, including activity published before following', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const viewer = await auth.signup({ email: 'viewer@example.com', password: 'correct horse battery staple', displayName: 'Viewer' });
    const followed = await auth.signup({ email: 'followed@example.com', password: 'correct horse battery staple', displayName: 'Followed Pilot' });
    const unrelated = await auth.signup({ email: 'unrelated@example.com', password: 'correct horse battery staple', displayName: 'Unrelated Pilot' });
    const activityService = createActivityService(database.db);
    const followService = createFollowService(database.db);
    const publishedAt = new Date('2026-07-20T00:00:00.000Z');
    const [prior] = await database.db.insert(activities).values({ actorUserId: followed.user.userId, activityType: 'competition', publishedAt }).returning({ id: activities.id });
    await database.db.insert(activities).values({ actorUserId: viewer.user.userId, activityType: 'competition', publishedAt: new Date('2026-07-21T00:00:00.000Z') });
    await database.db.insert(activities).values({ actorUserId: unrelated.user.userId, activityType: 'competition', publishedAt: new Date('2026-07-22T00:00:00.000Z') });
    expect((await activityService.listFeed({ viewerUserId: viewer.user.userId })).items.map((item) => item.actorUserId)).toEqual([viewer.user.userId]);

    await followService.follow({ followerUserId: viewer.user.userId, followedUserId: followed.user.userId });
    const followedPage = await activityService.listFeed({ viewerUserId: viewer.user.userId });
    expect(followedPage.items.map((item) => item.actorUserId)).toEqual([viewer.user.userId, followed.user.userId]);
    expect(followedPage.items.find((item) => item.id === prior?.id)?.actorDisplayName).toBe('Followed Pilot');
    await followService.unfollow({ followerUserId: viewer.user.userId, followedUserId: followed.user.userId });
    expect((await activityService.listFeed({ viewerUserId: viewer.user.userId })).items.map((item) => item.actorUserId)).toEqual([viewer.user.userId]);
  });

  it('uses stable published_at/id keyset pages and validates limits and cursors', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const viewer = await auth.signup({ email: 'viewer-page@example.com', password: 'correct horse battery staple', displayName: 'Viewer Page' });
    const activityService = createActivityService(database.db);
    const tie = new Date('2026-07-20T00:00:00.000Z');
    const ids = [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ];
    await database.db.insert(activities).values(ids.map((id) => ({ id, actorUserId: viewer.user.userId, activityType: 'competition', publishedAt: tie })));
    const first = await activityService.listFeed({ viewerUserId: viewer.user.userId, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([ids[0], ids[1]]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await activityService.listFeed({ viewerUserId: viewer.user.userId, limit: 2, before: first.nextCursor ?? undefined });
    expect(second.items.map((item) => item.id)).toEqual([ids[2]]);
    expect(second.nextCursor).toBeNull();
    expect((await activityService.listFeed({ viewerUserId: viewer.user.userId, limit: 20, before: first.nextCursor ?? undefined })).items.map((item) => item.id)).toEqual([ids[2]]);
    await expect(activityService.listFeed({ viewerUserId: viewer.user.userId, limit: 0 })).rejects.toThrow('Activity limit is invalid.');
    await expect(activityService.listFeed({ viewerUserId: viewer.user.userId, limit: 21 })).rejects.toThrow('Activity limit is invalid.');
    await expect(activityService.listFeed({ viewerUserId: viewer.user.userId, before: 'not-a-cursor' })).rejects.toBeInstanceOf(ActivityCursorError);
  });

  it('joins current profile display names on each read', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({ email: 'rename@example.com', password: 'correct horse battery staple', displayName: 'Original Name' });
    const activityService = createActivityService(database.db);
    await database.db.insert(activities).values({ actorUserId: pilot.user.userId, activityType: 'competition', publishedAt: new Date('2026-07-20T00:00:00.000Z') });
    await database.db.update(profiles).set({ displayName: 'Current Name' }).where(eq(profiles.userId, pilot.user.userId));
    expect((await activityService.listFeed({ viewerUserId: pilot.user.userId })).items[0]?.actorDisplayName).toBe('Current Name');
  });
});

describe('activityService.toggleThermal', () => {
  it('atomically toggles a reaction and reports the bounded count', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const owner = await auth.signup({ email: 'thermal-owner@example.com', password: 'correct horse battery staple', displayName: 'Thermal Owner' });
    const reactor = await auth.signup({ email: 'thermal-reactor@example.com', password: 'correct horse battery staple', displayName: 'Thermal Reactor' });
    const [activity] = await database.db.insert(activities).values({ actorUserId: owner.user.userId, activityType: 'competition', publishedAt: new Date() }).returning({ id: activities.id });
    if (!activity) throw new Error('Activity insert returned no row.');
    const service = createActivityService(database.db);
    await expect(service.toggleThermal({ viewerUserId: reactor.user.userId, activityId: '00000000-0000-4000-8000-000000000099' })).rejects.toThrow('Activity not found.');
    await expect(service.toggleThermal({ viewerUserId: owner.user.userId, activityId: activity.id })).rejects.toThrow('own activity');
    await expect(service.toggleThermal({ viewerUserId: reactor.user.userId, activityId: activity.id })).resolves.toEqual({ reacted: true, totalCount: 1 });
    await expect(service.toggleThermal({ viewerUserId: reactor.user.userId, activityId: activity.id })).resolves.toEqual({ reacted: false, totalCount: 0 });
    const concurrent = await Promise.all([
      service.toggleThermal({ viewerUserId: reactor.user.userId, activityId: activity.id }),
      service.toggleThermal({ viewerUserId: reactor.user.userId, activityId: activity.id }),
    ]);
    expect(concurrent.map((result) => result.totalCount).sort()).toEqual([0, 1]);
    expect((await database.db.select().from(activityReactions)).length).toBe(0);
  });

  it('includes Thermal counts and viewer state in the feed and cascades activity deletion', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const owner = await auth.signup({ email: 'thermal-feed-owner@example.com', password: 'correct horse battery staple', displayName: 'Feed Owner' });
    const reactor = await auth.signup({ email: 'thermal-feed-reactor@example.com', password: 'correct horse battery staple', displayName: 'Feed Reactor' });
    const [activity] = await database.db.insert(activities).values({ actorUserId: owner.user.userId, activityType: 'competition', publishedAt: new Date() }).returning({ id: activities.id });
    if (!activity) throw new Error('Activity insert returned no row.');
    const service = createActivityService(database.db);
    await service.toggleThermal({ viewerUserId: reactor.user.userId, activityId: activity.id });
    await createFollowService(database.db).follow({ followerUserId: reactor.user.userId, followedUserId: owner.user.userId });
    expect((await service.listFeed({ viewerUserId: reactor.user.userId })).items[0]).toMatchObject({ thermalCount: 1, viewerHasReacted: true });
    expect((await service.listFeed({ viewerUserId: owner.user.userId })).items[0]).toMatchObject({ thermalCount: 1, viewerHasReacted: false });
    await database.db.delete(activities).where(eq(activities.id, activity.id));
    expect(await database.db.select().from(activityReactions)).toEqual([]);
  });
});
