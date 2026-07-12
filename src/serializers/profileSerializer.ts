import { ProfileRow } from '../db/types.js';
import { ProfileDTO } from '../dto/profileDTO.js';

export function toProfileDTO(profile: ProfileRow): ProfileDTO {
  return {
    id: profile.id,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl ?? undefined,
  };
}
