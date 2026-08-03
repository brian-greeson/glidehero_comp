import { z } from 'zod';

const publicOriginSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && url.pathname === '/'
    && !url.search
    && !url.hash
    && !url.username
    && !url.password;
}, 'PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, a path, query, or fragment.');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  VALKEY_URL: z.string().url(),
  ENVIRONMENT: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  PUBLIC_ORIGIN: publicOriginSchema.default('https://glidehero.com'),
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
  BUCKET_TILES_NAME: z.string().trim().min(1),
  BUCKET_URL: z.string(),
  BUCKET_FOLDER: z
    .string()
    .trim()
    .transform((folder) => folder.replace(/^\/+|\/+$/g, ''))
    .pipe(z.string().min(1)),
  MAPTILER_API_KEY: z.string().min(1),
  MAPTILER_CREDENTIALS: z.string().min(1),
  KOFI_VERIFICATION_TOKEN: z.string().min(1),
  ADMIN_EMAILS: z.string().optional(),
  THERMAL_KK_SOURCE_HOSTNAME: z.string().trim().min(1).default('glidehero.com'),
});

export type AppConfig = {
  databaseUrl: string;
  valkeyUrl: string;
  environment: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  publicOrigin: string;
  sessionCookieName: string;
  sessionTtlSeconds: number;
  mapTilerApiKey: string;
  mapTilerCredentials: string;
  gridClaimCellSize: number;
  kofiVerificationToken: string;
  adminEmails: string[];
  thermalKkSourceHostname: string;
  bucket: {
    bucketSecret: string;
    bucketId: string;
    bucketName: string;
    thermalBucketName: string;
    bucketURL: string;
    bucketFolder: string;
  };
};

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    valkeyUrl: parsed.VALKEY_URL,
    environment: parsed.ENVIRONMENT,
    isProduction: parsed.ENVIRONMENT === 'production',
    port: parsed.PORT,
    publicOrigin: parsed.PUBLIC_ORIGIN.replace(/\/$/, ''),
    sessionCookieName: parsed.SESSION_COOKIE_NAME,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    mapTilerApiKey: parsed.MAPTILER_API_KEY,
    mapTilerCredentials: parsed.MAPTILER_CREDENTIALS,
    gridClaimCellSize: 500,
    kofiVerificationToken: parsed.KOFI_VERIFICATION_TOKEN,
    adminEmails: [
      ...new Set(
        (parsed.ADMIN_EMAILS ?? '')
          .split(',')
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    thermalKkSourceHostname: parsed.THERMAL_KK_SOURCE_HOSTNAME,
    bucket: {
      bucketSecret: parsed.BUCKET_SECRET,
      bucketId: parsed.BUCKET_ID,
      bucketName: parsed.BUCKET_NAME,
      thermalBucketName: parsed.BUCKET_TILES_NAME,
      bucketURL: parsed.BUCKET_URL,
      bucketFolder: parsed.BUCKET_FOLDER,
    },
  };
}
