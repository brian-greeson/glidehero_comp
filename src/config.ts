import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ENVIRONMENT: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_]+$/)
    .default('glidehero_session'),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 60 * 60),
  BUCKET_SECRET: z.string(),
  BUCKET_ID: z.string(),
  BUCKET_NAME: z.string(),
  BUCKET_URL: z.string(),
  MAPTILER_API_KEY: z.string().min(1),
  GRID_CLAIM_CELL_SIZE: z.coerce.number().int().min(1),
});

export type AppConfig = {
  databaseUrl: string;
  environment: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  sessionCookieName: string;
  sessionTtlSeconds: number;
  mapTilerApiKey: string;
  gridClaimCellSize: number;
  bucket: {
    bucketSecret: string;
    bucketId: string;
    bucketName: string;
    bucketURL: string;
  };
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
    mapTilerApiKey: parsed.MAPTILER_API_KEY,
    gridClaimCellSize: parsed.GRID_CLAIM_CELL_SIZE,
    bucket: {
      bucketSecret: parsed.BUCKET_SECRET,
      bucketId: parsed.BUCKET_ID,
      bucketName: parsed.BUCKET_NAME,
      bucketURL: parsed.BUCKET_URL,
    },
  };
}
