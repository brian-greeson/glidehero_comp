import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';

describe('parseConfig', () => {
  it('accepts the minimal local environment', () => {
    expect(parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      MAPTILER_API_KEY: 'maptiler-test-key',
    })).toEqual({
      databaseUrl: 'postgres://localhost/glidehero',
      environment: 'development',
      isProduction: false,
      port: 3000,
      sessionCookieName: 'glidehero_session',
      sessionTtlSeconds: 604800,
      mapTilerApiKey: 'maptiler-test-key',
      bucket: {
        bucketSecret: 'secret',
        bucketId: 'id',
        bucketName: 'glidehero-files',
        bucketURL: 'https://s3.example.test',
      },
    });
  });

  it('requires a database URL', () => {
    expect(() => parseConfig({})).toThrow();
  });

  it('requires a MapTiler API key', () => {
    expect(() => parseConfig({
      DATABASE_URL: 'postgres://localhost/glidehero',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
    })).toThrow();
  });

  it('enables secure production behavior', () => {
    expect(
      parseConfig({
        DATABASE_URL: 'postgres://db/glidehero',
        ENVIRONMENT: 'production',
        BUCKET_SECRET: 'secret',
        BUCKET_ID: 'id',
        BUCKET_NAME: 'glidehero-files',
        BUCKET_URL: 'https://s3.example.test',
        MAPTILER_API_KEY: 'maptiler-test-key',
      }),
    ).toMatchObject({ environment: 'production', isProduction: true });
  });
});
