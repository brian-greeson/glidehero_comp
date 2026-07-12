import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config.js';

describe('parseConfig', () => {
  it('accepts the minimal local environment', () => {
    expect(parseConfig({ DATABASE_URL: 'postgres://localhost/glidehero' })).toEqual({
      databaseUrl: 'postgres://localhost/glidehero',
      environment: 'development',
      isProduction: false,
      port: 3000,
      sessionCookieName: 'glidehero_session',
      sessionTtlSeconds: 604800,
    });
  });

  it('requires a database URL', () => {
    expect(() => parseConfig({})).toThrow();
  });

  it('enables secure production behavior', () => {
    expect(
      parseConfig({ DATABASE_URL: 'postgres://db/glidehero', ENVIRONMENT: 'production' }),
    ).toMatchObject({ environment: 'production', isProduction: true });
  });
});
