import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  DATABASE_ADMIN_URL: z.string().optional(),
  DATABASE_CA: z.string().optional(),
  DATABASE_USER: z.string().optional(),
  DATABASE_PASSWORD: z.string().optional(),
  DATABASE_HOST: z.string().optional(),
  DATABASE_PORT: z.coerce.number().optional(),
  DATABASE_NAME: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ISSUER: z.string(),
  JWT_AUDIENCE: z.string(),
  APPLE_CLIENT_IDS: z.string(),
  INVITE_BASE_URL: z.string(),
  PORT: z.coerce.number().default(3000),
  RELEASE_COMMIT: z.string().optional(),
  ENVIRONMENT: z.string().optional().default('dev'),
  BUCKET_SECRET: z.string(),
  BUCKET_ID: z.string(),
  BUCKET_NAME: z.string(),
  BUCKET_URL: z.string(),
});

const parsed = envSchema.parse(process.env);

export const config = {
  release: parsed.RELEASE_COMMIT,
  bucket: {
    bucketSecret: parsed.BUCKET_SECRET,
    bucketId: parsed.BUCKET_ID,
    bucketName: parsed.BUCKET_NAME,
    bucketURL: parsed.BUCKET_URL,
  },
  db: {
    url: parsed.DATABASE_URL,
    adminUrl: parsed.DATABASE_ADMIN_URL,
    user: parsed.DATABASE_USER,
    password: parsed.DATABASE_PASSWORD,
    host: parsed.DATABASE_HOST,
    port: parsed.DATABASE_PORT,
    database: parsed.DATABASE_NAME,
    ca: parsed.DATABASE_CA,
  },
  jwt: {
    secret: parsed.JWT_SECRET,
    refreshSecret: parsed.JWT_REFRESH_SECRET,
    issuer: parsed.JWT_ISSUER,
    audience: parsed.JWT_AUDIENCE,
  },
  appleClientIds: parsed.APPLE_CLIENT_IDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  inviteBaseUrl: parsed.INVITE_BASE_URL.replace(/\/+$/, ''),
  port: parsed.PORT,
  isProduction: parsed.ENVIRONMENT === 'production',
};
