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
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: '/glidehero-dev/',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    })).toEqual({
      databaseUrl: 'postgres://localhost/glidehero',
      valkeyUrl: 'redis://localhost:6379',
      environment: 'development',
      isProduction: false,
      port: 3000,
      publicOrigin: 'https://glidehero.com',
      sessionCookieName: 'glidehero_session',
      sessionTtlSeconds: 604800,
      mapTilerApiKey: 'maptiler-test-key',
      mapTilerCredentials: 'maptiler-test-key_00112233445566778899aabbccddeeff',
      gridClaimCellSize: 500,
      kofiVerificationToken: 'kofi-test-token',
      adminEmails: [],
      thermalKkSourceHostname: 'glidehero.com',
      bucket: {
        bucketSecret: 'secret',
        bucketId: 'id',
        bucketName: 'glidehero-files',
        thermalBucketName: 'glidehero-thermal-tiles',
        bucketURL: 'https://s3.example.test',
        bucketFolder: 'glidehero-dev',
      },
    });
  });

  it('requires a database URL', () => {
    expect(() => parseConfig({})).toThrow();
  });

  it('requires a dedicated thermal tile bucket', () => {
    expect(() => parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    })).toThrow();
  });

  it('requires a MapTiler API key and credentials', () => {
    expect(() => parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
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
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
    })).toThrow();
  });

  it('uses the permanent 500-meter grid cell size', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
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
        BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
        BUCKET_URL: 'https://s3.example.test',
        BUCKET_FOLDER: 'glidehero-production',
        MAPTILER_API_KEY: 'maptiler-test-key',
        MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
        KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
      }),
    ).toMatchObject({
      environment: 'production',
      isProduction: true,
      publicOrigin: 'https://glidehero.com',
    });
  });

  it('normalizes an explicitly configured public origin', () => {
    const config = parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      PUBLIC_ORIGIN: 'https://glidehero.example/',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    });

    expect(config.publicOrigin).toBe('https://glidehero.example');
  });

  it('rejects a public origin containing a path', () => {
    expect(() => parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      PUBLIC_ORIGIN: 'https://glidehero.example/app',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
    })).toThrow('PUBLIC_ORIGIN must be an HTTP(S) origin');
  });

  it('accepts optional comma-separated admin emails', () => {
    const config = parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_TILES_NAME: 'glidehero-thermal-tiles',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
      MAPTILER_CREDENTIALS: 'maptiler-test-key_00112233445566778899aabbccddeeff',
      KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
      ADMIN_EMAILS: ' Admin@example.com, ,second@example.com,ADMIN@example.com ',
    });

    expect(config.adminEmails).toEqual(['admin@example.com', 'second@example.com']);
  });
});
