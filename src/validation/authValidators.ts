import z from 'zod';

export const authAppleExchangeSchema = z.object({
  identityToken: z.string().min(1),
  authorizationCode: z.string().min(1),
  name: z.string().optional(),
});

export const passwordLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(3).max(64),
});

export const passwordSignupSchema = z.object({
  email: z.email(),
  password: z.string().min(3).max(64),
  displayName: z.string().trim().min(1).max(32).optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});
