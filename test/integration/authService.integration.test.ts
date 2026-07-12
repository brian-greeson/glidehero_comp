import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

describe('authService', () => {
  it('creates a normalized account, credential, profile, and session atomically', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const result = await auth.signup({
      email: '  Pilot@Example.com ',
      password: 'correct horse battery staple',
      displayName: 'Sky Pilot',
    });

    expect(result.user).toMatchObject({ email: 'pilot@example.com', displayName: 'Sky Pilot' });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const stored = await database.pool.query<{
      email: string;
      password_hash: string;
      token_hash: string;
    }>(
      `SELECT u.email, p.password_hash, s.token_hash
       FROM users u
       JOIN user_passwords p ON p.user_id = u.user_id
       JOIN app_sessions s ON s.user_id = u.user_id`,
    );
    expect(stored.rows[0]?.email).toBe('pilot@example.com');
    expect(stored.rows[0]?.password_hash).not.toContain('correct horse battery staple');
    expect(stored.rows[0]?.token_hash).toBe(
      createHash('sha256').update(result.token).digest('hex'),
    );
  });

  it('rejects duplicate normalized email addresses without partial records', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    await auth.signup({ email: 'pilot@example.com', password: 'correct horse battery staple' });
    await expect(
      auth.signup({ email: 'PILOT@example.com', password: 'another secure password' }),
    ).rejects.toMatchObject({ code: 'duplicate_email' });

    const counts = await database.pool.query<{
      users: number;
      passwords: number;
      profiles: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM user_passwords) AS passwords,
         (SELECT count(*)::int FROM profiles) AS profiles,
         (SELECT count(*)::int FROM app_sessions) AS sessions`,
    );
    expect(counts.rows[0]).toEqual({ users: 1, passwords: 1, profiles: 1, sessions: 1 });
  });

  it('uses a generic failure for bad credentials and updates last login on success', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const signup = await auth.signup({
      email: 'pilot@example.com',
      password: 'correct horse battery staple',
    });
    const oldLastLogin = new Date('2000-01-01T00:00:00.000Z');
    await database.pool.query('UPDATE users SET last_login = $1 WHERE user_id = $2', [
      oldLastLogin,
      signup.user.userId,
    ]);

    await expect(
      auth.login({ email: 'missing@example.com', password: 'incorrect password' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'invalid_credentials' }));
    await expect(
      auth.login({ email: 'pilot@example.com', password: 'incorrect password' }),
    ).rejects.toEqual(expect.objectContaining({ code: 'invalid_credentials' }));
    await expect(
      auth.login({ email: ' PILOT@example.com ', password: 'correct horse battery staple' }),
    ).resolves.toMatchObject({ user: { email: 'pilot@example.com' } });

    const stored = await database.pool.query<{ last_login: Date }>(
      'SELECT last_login FROM users WHERE user_id = $1',
      [signup.user.userId],
    );
    expect(stored.rows[0]?.last_login.getTime()).toBeGreaterThan(oldLastLogin.getTime());
  });

  it('resolves and revokes an opaque browser session', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const session = await auth.signup({
      email: 'pilot@example.com',
      password: 'correct horse battery staple',
    });
    await expect(auth.authenticate(session.token)).resolves.toMatchObject({
      email: 'pilot@example.com',
    });
    await auth.logout(session.token);
    await expect(auth.authenticate(session.token)).resolves.toBeNull();
  });

  it('does not authenticate an expired browser session', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: -1 });
    const session = await auth.signup({
      email: 'pilot@example.com',
      password: 'correct horse battery staple',
    });

    await expect(auth.authenticate(session.token)).resolves.toBeNull();
  });
});
