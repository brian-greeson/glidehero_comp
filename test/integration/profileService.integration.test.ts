import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createProfileService, normalizeTerritoryColor } from '../../src/services/profileService.js';
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

describe('profileService', () => {
  it('normalizes a trimmed six-digit hex color and rejects other values', () => {
    expect(normalizeTerritoryColor('  #a1B2c3  ')).toBe('#A1B2C3');
    expect(normalizeTerritoryColor('#ABC')).toBeNull();
    expect(normalizeTerritoryColor('A1B2C3')).toBeNull();
    expect(normalizeTerritoryColor('#A1B2CG')).toBeNull();
    expect(normalizeTerritoryColor(undefined)).toBeNull();
  });

  it('persists the chosen color only for the requested pilot', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const firstPilot = await auth.signup({
      email: 'first@example.com',
      password: 'correct horse battery staple',
    });
    const secondPilot = await auth.signup({
      email: 'second@example.com',
      password: 'correct horse battery staple',
    });
    const profiles = createProfileService(database.db);
    const oldUpdatedAt = new Date('2000-01-01T00:00:00.000Z');
    await database.pool.query('UPDATE profiles SET updated_at = $1 WHERE user_id = $2', [
      oldUpdatedAt,
      firstPilot.user.userId,
    ]);

    await profiles.updateTerritoryColor({
      userId: firstPilot.user.userId,
      territoryColor: '#a1b2c3',
    });

    const stored = await database.pool.query<{
      user_id: string;
      territory_color: string;
      updated_at: Date;
    }>(
      'SELECT user_id, territory_color, updated_at FROM profiles ORDER BY user_id',
    );
    expect(stored.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: firstPilot.user.userId, territory_color: '#A1B2C3' }),
      expect.objectContaining({ user_id: secondPilot.user.userId, territory_color: '#1769AA' }),
    ]));
    expect(stored.rows.find((profile) => profile.user_id === firstPilot.user.userId)?.updated_at.getTime())
      .toBeGreaterThan(oldUpdatedAt.getTime());
  });
});
