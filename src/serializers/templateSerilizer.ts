/** template to follow when creating a new serializer

import { UserRow } from '../db/types.js';

// Exported types are the shape inside the DTO / api responses

export type UserProfile = {
  id: string,
  email: string,
  displayName: string
  handedness: "Right" | "Left"
}

// Exported Functions transform database or service outputs to api response types

export function toUserProfile(user: UserRow): UserProfile {
  return {
    id: user.id,
    email: user.email ?? "",
    displayName: user.displayName ?? "",
    handedness: user.handedness === "Left" ? "Left" : "Right"
  }
}
   * 
 */
