import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createFollowService, PilotNotFoundError } from '../../src/services/followService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database?.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

describe('followService', () => {
  it('follows and unfollows idempotently, rejects self-follow, and searches literal names', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const viewer = await auth.signup({ email: 'viewer@example.com', password: 'correct horse battery staple', displayName: 'Viewer' });
    const percent = await auth.signup({ email: 'percent@example.com', password: 'correct horse battery staple', displayName: 'A% Pilot' });
    const underscore = await auth.signup({ email: 'underscore@example.com', password: 'correct horse battery staple', displayName: 'A_Pilot' });
    for (let index = 1; index <= 11; index += 1) {
      await auth.signup({
        email: `target-${index}@example.com`,
        password: 'correct horse battery staple',
        displayName: `Target Pilot ${index}`,
      });
    }
    const service = createFollowService(database.db);

    await service.follow({ followerUserId: viewer.user.userId, followedUserId: percent.user.userId });
    await service.follow({ followerUserId: viewer.user.userId, followedUserId: percent.user.userId });
    expect(await service.isFollowing({ followerUserId: viewer.user.userId, followedUserId: percent.user.userId })).toBe(true);
    expect(await service.searchPilots({ viewerUserId: viewer.user.userId, query: '%' })).toEqual([
      expect.objectContaining({ userId: percent.user.userId, isFollowing: true }),
    ]);
    expect(await service.searchPilots({ viewerUserId: viewer.user.userId, query: '_' })).toEqual([
      expect.objectContaining({ userId: underscore.user.userId, isFollowing: false }),
    ]);
    expect(await service.searchPilots({ viewerUserId: viewer.user.userId, query: '  A% PILOT  ' })).toEqual([
      expect.objectContaining({ userId: percent.user.userId, isFollowing: true }),
    ]);
    expect(await service.searchPilots({ viewerUserId: viewer.user.userId, query: ' viewer ' })).toEqual([]);
    expect((await service.searchPilots({ viewerUserId: viewer.user.userId, query: 'TARGET' }))).toHaveLength(10);
    await service.unfollow({ followerUserId: viewer.user.userId, followedUserId: percent.user.userId });
    await service.unfollow({ followerUserId: viewer.user.userId, followedUserId: percent.user.userId });
    expect(await service.isFollowing({ followerUserId: viewer.user.userId, followedUserId: percent.user.userId })).toBe(false);
    await expect(service.follow({ followerUserId: viewer.user.userId, followedUserId: viewer.user.userId })).rejects.toThrow();
    await expect(service.follow({
      followerUserId: viewer.user.userId,
      followedUserId: '00000000-0000-4000-8000-000000000404',
    })).rejects.toBeInstanceOf(PilotNotFoundError);
  });
});
