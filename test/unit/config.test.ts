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
      GRID_CLAIM_CELL_SIZE: '1000',
    })).toEqual({
      databaseUrl: 'postgres://localhost/glidehero',
      valkeyUrl: 'redis://localhost:6379',
      environment: 'development',
      isProduction: false,
      port: 3000,
      sessionCookieName: 'glidehero_session',
      sessionTtlSeconds: 604800,
      mapTilerApiKey: 'maptiler-test-key',
      gridClaimCellSize: 1000,
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
      GRID_CLAIM_CELL_SIZE: '1000',
    })).toThrow();
  });

  it('requires a positive integer grid claim cell size', () => {
    const env = {
      DATABASE_URL: 'postgres://localhost/glidehero',
      VALKEY_URL: 'redis://localhost:6379',
      BUCKET_SECRET: 'secret',
      BUCKET_ID: 'id',
      BUCKET_NAME: 'glidehero-files',
      BUCKET_URL: 'https://s3.example.test',
      BUCKET_FOLDER: 'glidehero-dev',
      MAPTILER_API_KEY: 'maptiler-test-key',
    };

    expect(() => parseConfig(env)).toThrow();
    expect(() => parseConfig({ ...env, GRID_CLAIM_CELL_SIZE: '0' })).toThrow();
    expect(() => parseConfig({ ...env, GRID_CLAIM_CELL_SIZE: '10.5' })).toThrow();
    expect(parseConfig({ ...env, GRID_CLAIM_CELL_SIZE: '250' }).gridClaimCellSize).toBe(250);
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
        GRID_CLAIM_CELL_SIZE: '1000',
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
      GRID_CLAIM_CELL_SIZE: '1000',
      ADMIN_EMAILS: ' Admin@example.com, ,second@example.com,ADMIN@example.com ',
    });

    expect(config.adminEmails).toEqual(['admin@example.com', 'second@example.com']);
  });
});
