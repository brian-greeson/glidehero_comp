import { and, eq } from 'drizzle-orm';
import { serverError } from '../domain/errors.js';
import { db } from './client.js';
import { profileFollows } from './schema.js';
import type { ProfileFollowRow } from './types.js';

export type ProfileFollowInput = {
  sourceProfileId: string;
  followedProfileId: string;
};

export async function getProfilesFollowedBySourceProfileId(sourceProfileId: string) {
  const follows = await db.query.profileFollows.findMany({ where: { sourceProfileId } });
  return follows;
}

export async function createFollow(input: ProfileFollowInput): Promise<ProfileFollowRow> {
  const [follow] = await db.insert(profileFollows).values(input).returning();
  if (!follow) {
    throw serverError('unable to create follow');
  }

  return follow;
}

export async function removeFollow(input: ProfileFollowInput): Promise<void> {
  await db
    .delete(profileFollows)
    .where(
      and(
        eq(profileFollows.sourceProfileId, input.sourceProfileId),
        eq(profileFollows.followedProfileId, input.followedProfileId),
      ),
    );
}
