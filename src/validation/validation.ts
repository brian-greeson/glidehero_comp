import { z } from 'zod';
import { ApiError, type ApiErrorCode } from '../domain/errors.js';
import type { NotificationPreferences } from '../domain/types.js';
import { secsPerDay } from '../utils/general.js';

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: ApiErrorCode = 'invalid_request',
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  console.log('validation issues: ', parsed.error.issues);
  throw new ApiError(422, code, 'Request validation failed.', {
    issues: parsed.error.issues,
  });
}
