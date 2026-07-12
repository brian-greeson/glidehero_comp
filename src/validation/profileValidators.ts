import z from 'zod';
import { parseOrThrow } from './validation.js';
import { UpdateProfileDTO } from '../dto/profileDTO.js';
import { ApiError } from '../domain/errors.js';

export const patchProfileSchema = z.object({
  id: z.uuid(),
  email: z.string().optional(),
  displayName: z.string().trim().min(1).max(32),
  handedness: z.enum(['Left', 'Right']).optional(),
  avatarUrl: z.url().optional(),
});

export function validateUpdateProfile(input: unknown): UpdateProfileDTO {
  const profileUpdate = parseOrThrow(patchProfileSchema, input);
  return profileUpdate;
}
