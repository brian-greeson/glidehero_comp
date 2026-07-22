import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { pilotFollows, profiles } from '../db/schema.js';

export type PilotSearchResult = {
  userId: string;
  displayName: string;
  isFollowing: boolean;
};

export class PilotNotFoundError extends Error {
  constructor() {
    super('Pilot not found.');
    this.name = 'PilotNotFoundError';
  }
}

export interface FollowService {
  follow(input: { followerUserId: string; followedUserId: string }): Promise<void>;
  unfollow(input: { followerUserId: string; followedUserId: string }): Promise<void>;
  isFollowing(input: { followerUserId: string; followedUserId: string }): Promise<boolean>;
  searchPilots(input: { viewerUserId: string; query: string }): Promise<PilotSearchResult[]>;
}

function escapedLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function createFollowService(database: Database): FollowService {
  return {
    async follow({ followerUserId, followedUserId }) {
      if (followerUserId === followedUserId) throw new Error('Pilots cannot follow themselves.');
      const [pilot] = await database.select({ userId: profiles.userId })
        .from(profiles)
        .where(eq(profiles.userId, followedUserId))
        .limit(1);
      if (!pilot) throw new PilotNotFoundError();
      await database.insert(pilotFollows).values({ followerUserId, followedUserId }).onConflictDoNothing();
    },

    async unfollow({ followerUserId, followedUserId }) {
      await database.delete(pilotFollows).where(and(
        eq(pilotFollows.followerUserId, followerUserId),
        eq(pilotFollows.followedUserId, followedUserId),
      ));
    },

    async isFollowing({ followerUserId, followedUserId }) {
      if (followerUserId === followedUserId) return false;
      const [row] = await database.select({ followerUserId: pilotFollows.followerUserId })
        .from(pilotFollows)
        .where(and(
          eq(pilotFollows.followerUserId, followerUserId),
          eq(pilotFollows.followedUserId, followedUserId),
        ))
        .limit(1);
      return Boolean(row);
    },

    async searchPilots({ viewerUserId, query }) {
      const normalized = query.trim().toLowerCase();
      if (!normalized) return [];
      const pattern = `%${escapedLike(normalized)}%`;
      const rows = await database.select({
        userId: profiles.userId,
        displayName: profiles.displayName,
        isFollowing: sql<boolean>`(${pilotFollows.followerUserId} IS NOT NULL)`,
      })
        .from(profiles)
        .leftJoin(pilotFollows, and(
          eq(pilotFollows.followedUserId, profiles.userId),
          eq(pilotFollows.followerUserId, viewerUserId),
        ))
        .where(and(
          ne(profiles.userId, viewerUserId),
          sql`lower(${profiles.displayName}) LIKE ${pattern} ESCAPE '\\'`,
        ))
        .orderBy(sql`lower(${profiles.displayName})`, profiles.userId)
        .limit(10);
      return rows.map((row) => ({ ...row, isFollowing: Boolean(row.isFollowing) }));
    },
  };
}
