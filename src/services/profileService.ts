import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { notFound } from '../domain/errors.js';
import { InsertProfile } from '../db/types.js';
import { ProfileDTO, UpdateProfileDTO } from '../dto/profileDTO.js';
import { toProfileDTO } from '../serializers/profileSerializer.js';
import { getProfileById, getProfileByUserId, updateProfileByUserId } from '../db/profileModel.js';

export async function getProfile(input: {
  profileId?: string;
  userId?: string;
}): Promise<ProfileDTO> {
  if (input.profileId) {
    return toProfileDTO(await getProfileById(input.profileId));
  }
  if (input.userId) {
    return toProfileDTO(await getProfileByUserId(input.userId));
  }

  throw notFound('Player profile was not found.');
}

export async function updateProfile(userId: string, input: UpdateProfileDTO): Promise<ProfileDTO> {
  const set: InsertProfile = {
    updatedAt: new Date(),
    displayName: input.displayName,
  };

  const profile = await updateProfileByUserId(userId, set);

  return toProfileDTO(profile);
}
