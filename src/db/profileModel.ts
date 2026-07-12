import { and, eq, isNull } from 'drizzle-orm';
import { invalidRequest } from '../domain/errors.js';
import { db } from './client.js';
import { profiles } from './schema.js';
import { InsertProfile } from './types.js';

export const profileColumns = {
  id: true,
  userId: true,
  displayName: true,
  handedness: true,
  avatarUrl: true,
} as const;

export async function getProfileByUserId(userId: string) {
  const profile = await db.query.profiles.findFirst({
    where: {
      userId,
      deletedAt: { isNull: true },
    },
  });

  if (!profile) {
    throw invalidRequest('Player profile was not found.');
  }

  return profile;
}

export async function getProfileById(profileId: string) {
  const profile = await db.query.profiles.findFirst({
    where: {
      id: profileId,
      deletedAt: { isNull: true },
    },
  });
  if (!profile) {
    throw invalidRequest('Player profile was not found.');
  }

  return profile;
}

export async function updateProfileByUserId(userId: string, set: InsertProfile) {
  const [profile] = await db
    .update(profiles)
    .set(set)
    .where(and(eq(profiles.userId, userId), isNull(profiles.deletedAt)))
    .returning();
  if (!profile) {
    throw invalidRequest('Unable to update profile');
  }

  return profile;
}
