import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { achievements, flights, flightProgress, igcFiles, personalGridClaims } from '../../src/db/schema.js';
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
    const profiles = createProfileService(database.db, { cellSize: 1_000 });
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

  it('aggregates the requested pilot profile and returns empty numeric values safely', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'profile-summary@example.com',
      password: 'correct horse battery staple',
      displayName: 'Summary Pilot',
    });
    const emptyPilot = await auth.signup({
      email: 'empty-summary@example.com',
      password: 'correct horse battery staple',
      displayName: 'Empty Pilot',
    });
    const profiles = createProfileService(database.db, { cellSize: 1_000 });
    const createFlight = async (index: number) => {
      const [igcFile] = await database.db.insert(igcFiles).values({
        userId: pilot.user.userId,
        originalFilename: `summary-${index}.igc`,
        contentType: 'application/vnd.fai.igc',
        byteSize: 1,
        bucketKey: `summary/${index}-${crypto.randomUUID()}.igc`,
      }).returning({ id: igcFiles.id });
      if (!igcFile) throw new Error('IGC file insert returned no row.');
      const [flight] = await database.db.insert(flights).values({
        userId: pilot.user.userId,
        igcFileId: igcFile.id,
        contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        processingStatus: 'completed',
        launchTimezone: 'UTC',
      }).returning({ id: flights.id });
      if (!flight) throw new Error('Flight insert returned no row.');
      return flight.id;
    };
    const firstFlight = await createFlight(1);
    const secondFlight = await createFlight(2);

    await database.db.insert(personalGridClaims).values([
      { claimUser: pilot.user.userId, claimFlight: firstFlight, cellSize: 1_000, x: 1, y: 2, claimTimestamp: new Date() },
      { claimUser: pilot.user.userId, claimFlight: secondFlight, cellSize: 1_000, x: 1, y: 2, claimTimestamp: new Date() },
      { claimUser: pilot.user.userId, claimFlight: secondFlight, cellSize: 1_000, x: 3, y: 4, claimTimestamp: new Date() },
      { claimUser: pilot.user.userId, claimFlight: secondFlight, cellSize: 2_000, x: 99, y: 99, claimTimestamp: new Date() },
    ]);
    await database.db.insert(flightProgress).values([
      {
        flightId: firstFlight, userId: pilot.user.userId, directCellCount: 4, enclosedCellCount: 1,
        newPersonalCellCount: 5, personalCellTotalAfter: 1,
      },
      {
        flightId: secondFlight, userId: pilot.user.userId, directCellCount: 6, enclosedCellCount: 2,
        newPersonalCellCount: 1, personalCellTotalAfter: 2,
      },
    ]);
    await database.db.insert(achievements).values([
      { userId: pilot.user.userId, achievementType: 'unique_cells_milestone', achievementKey: 'unique-cells:10', earnedAt: new Date(), details: { milestone: 10 } },
      { userId: pilot.user.userId, achievementType: 'personal_best_total_cells', achievementKey: 'personal-best-total-cells:' + secondFlight, earnedAt: new Date(), details: { newRecord: 8 } },
    ]);

    await expect(profiles.getPilotProfile(pilot.user.userId)).resolves.toEqual({
      userId: pilot.user.userId,
      displayName: 'Summary Pilot',
      territoryColor: '#1769AA',
      lifetimeUniqueCellCount: 2,
      completedFlightCount: 2,
      lifetimeDirectCellCount: 10,
      lifetimeEnclosedCellCount: 3,
      currentTotalCellRecord: 8,
      currentEnclosedCellRecord: 2,
      achievementCount: 2,
    });
    await expect(profiles.getPilotProfile(emptyPilot.user.userId)).resolves.toEqual({
      userId: emptyPilot.user.userId,
      displayName: 'Empty Pilot',
      territoryColor: '#1769AA',
      lifetimeUniqueCellCount: 0,
      completedFlightCount: 0,
      lifetimeDirectCellCount: 0,
      lifetimeEnclosedCellCount: 0,
      currentTotalCellRecord: null,
      currentEnclosedCellRecord: null,
      achievementCount: 0,
    });
    await expect(profiles.getPilotProfile('00000000-0000-4000-8000-000000000099')).resolves.toBeNull();
  });
});
