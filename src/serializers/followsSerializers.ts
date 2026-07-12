import { ProfileFollowRow } from '../db/types.js';
import { FollowProfileDTO } from '../dto/followsDTO.js';

export function serializeProfileFollows(follows: ProfileFollowRow[]): FollowProfileDTO[] {
  return follows.map((follow) => serializeProfileFollow(follow));
}
export function serializeProfileFollow(follow: ProfileFollowRow): FollowProfileDTO {
  const { sourceProfileId, followedProfileId, createdAt } = follow;
  return {
    sourceProfileId,
    followedProfileId,
    createdAt,
  };
}
