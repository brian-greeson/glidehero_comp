import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';

describe('parseConfig', () => {
  it('accepts the minimal local environment', () => {
    expect(parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: '/glidehero-dev/',
      MAPTILER_API_KEY: 'maptiler-test-key',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    })).toEqual({
      databaseUrl: 'postgres://localhost/glidehero',
      valkeyUrl: 'redis://localhost:6379',
      environment: 'development',
      isProduction: false,
      port: 3000,
      sessionCookieName: 'glidehero_session',
      sessionTtlSeconds: 604800,
      mapTilerApiKey: 'maptiler-test-key',
      gridClaimCellSize: 500,
      kofiVerificationToken: 'kofi-test-token',
      adminEmails: [],
      bucket: {
        bucketSecret: 'secret',
        bucketId: 'id',
        bucketName: 'glidehero-files',
        bucketURL: 'https://s3.example.test',
        bucketFolder: 'glidehero-dev',
      },
    });
  });

  it('requires a database URL', () => {
    expect(() => parseConfig({})).toThrow();
  });

  it('requires a MapTiler API key', () => {
    expect(() => parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    })).toThrow();
  });

  it('requires a Ko-fi verification token', () => {
    expect(() => parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
    })).toThrow();
  });

  it('uses the permanent 500-meter grid cell size', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    };

    expect(parseConfig(env).gridClaimCellSize).toBe(500);
    expect(parseConfig({ ...env, UNUSED_GRID_SETTING: '250' }).gridClaimCellSize).toBe(500);
  });

  it('enables secure production behavior', () => {
    expect(
      parseConfig({
        DATABASE_URL: 'postgres://db/glidehero',
        VALKEY_URL: 'rediss://default:secret@valkey.example.test:25061',
        ENVIRONMENT: 'production',
        BUCKET_SECRET: 'secret',
        BUCKET_ID: 'id',
        BUCKET_NAME: 'glidehero-files',
        BUCKET_URL: 'https://s3.example.test',
        BUCKET_FOLDER: 'glidehero-production',
        MAPTILER_API_KEY: 'maptiler-test-key',
        KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
      }),
    ).toMatchObject({ environment: 'production', isProduction: true });
  });

  it('accepts optional comma-separated admin emails', () => {
    const config = parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
      ADMIN_EMAILS: ' Admin@example.com, ,second@example.com,ADMIN@example.com ',
    });

    expect(config.adminEmails).toEqual(['admin@example.com', 'second@example.com']);
  });
});
