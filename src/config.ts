import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENVIRONMENT: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default('glidehero_session'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
});

export type AppConfig = {
  databaseUrl: string;
  environment: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  sessionCookieName: string;
  sessionTtlSeconds: number;
};

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    environment: parsed.ENVIRONMENT,
    isProduction: parsed.ENVIRONMENT === 'production',
    port: parsed.PORT,
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
  };
}
