export type Handedness = 'Left' | 'Right';

export type ProfileDTO = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  enableDebug?: boolean;
};

export type UpdateProfileDTO = {
  id: string;
  displayName: string;
  avatarUrl?: string;
};
