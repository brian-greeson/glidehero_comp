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
        startedAt: new Date(`2026-07-${19 + index}T12:00:00Z`),
        distanceMeters: index === 1 ? 1_500 : 2_500,
        durationSeconds: index === 1 ? 3_661 : 125,
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
        evaluatedAt: new Date('2026-07-22T12:00:00Z'), updatedAt: new Date('2026-07-22T12:00:00Z'),
      },
      {
        flightId: secondFlight, userId: pilot.user.userId, directCellCount: 6, enclosedCellCount: 2,
        newPersonalCellCount: 1, personalCellTotalAfter: 2,
        evaluatedAt: new Date('2026-07-20T12:00:00Z'), updatedAt: new Date('2026-07-20T12:00:00Z'),
      },
    ]);
    await database.db.insert(achievements).values([
      {
        userId: pilot.user.userId, achievementType: 'unique_cells_milestone', achievementKey: 'unique-cells:10',
        sourceFlightId: firstFlight,
        earnedAt: new Date('2026-07-23T12:00:00Z'), details: { milestone: 10, previousTotal: 9, newTotal: 10, newCells: 1 },
      },
      {
        userId: pilot.user.userId, achievementType: 'personal_best_total_cells', achievementKey: 'personal-best-total-cells:' + secondFlight,
        sourceFlightId: secondFlight,
        earnedAt: new Date('2026-07-22T12:00:00Z'), details: { previousRecord: null, newRecord: 1, directCells: 1, enclosedCells: 0, totalCells: 1 },
      },
      {
        userId: pilot.user.userId, achievementType: 'personal_best_enclosed_cells', achievementKey: 'personal-best-enclosed-cells:' + secondFlight,
        sourceFlightId: null, earnedAt: new Date('2026-07-21T12:00:00Z'),
        details: { previousRecord: 1, newRecord: 2, directCells: 6, enclosedCells: 2, totalCells: 8 },
      },
    ]);

    await expect(profiles.getPilotProfile(pilot.user.userId)).resolves.toEqual({
      userId: pilot.user.userId,
      displayName: 'Summary Pilot',
      territoryColor: '#1769AA',
      lifetimeUniqueCellCount: 2,
      nextUniqueCellMilestone: 10,
      uniqueCellsToNextMilestone: 8,
      nextUniqueCellMilestoneProgressPercent: 20,
      completedFlightCount: 2,
      lifetimeDirectCellCount: 10,
      lifetimeEnclosedCellCount: 3,
      currentTotalCellRecord: 8,
      currentEnclosedCellRecord: 2,
      achievementCount: 3,
      achievements: [
        expect.objectContaining({
          achievementType: 'unique_cells_milestone',
          title: '10 Unique Cells',
          description: 'Reached 10 unique Personal Map cells, adding 1 new cell to a total of 10.',
          sourceFlightId: firstFlight,
        }),
        expect.objectContaining({
          achievementType: 'personal_best_total_cells',
          title: 'New Flight Cell Record',
          description: 'Established an initial total-cell record of 1 cell (1 direct and 0 enclosed).',
          sourceFlightId: secondFlight,
        }),
        expect.objectContaining({
          achievementType: 'personal_best_enclosed_cells',
          title: 'New Enclosed Cell Record',
          description: 'Improved the enclosed-cell record from 1 to 2 cells (6 direct and 2 enclosed).',
          sourceFlightId: null,
        }),
      ],
      recentFlights: [
        expect.objectContaining({
          flightId: secondFlight,
          flightDate: 'Jul 21, 2026',
          distance: '2.5 km',
          duration: '2m 05s',
          directCellCount: 6,
          enclosedCellCount: 2,
          totalCellCount: 8,
          newPersonalCellCount: 1,
        }),
        expect.objectContaining({
          flightId: firstFlight,
          flightDate: 'Jul 20, 2026',
          distance: '1.5 km',
          duration: '1h 01m',
          directCellCount: 4,
          enclosedCellCount: 1,
          totalCellCount: 5,
          newPersonalCellCount: 5,
        }),
      ],
    });
    await expect(profiles.getPilotProfile(emptyPilot.user.userId)).resolves.toEqual({
      userId: emptyPilot.user.userId,
      displayName: 'Empty Pilot',
      territoryColor: '#1769AA',
      lifetimeUniqueCellCount: 0,
      nextUniqueCellMilestone: 10,
      uniqueCellsToNextMilestone: 10,
      nextUniqueCellMilestoneProgressPercent: 0,
      completedFlightCount: 0,
      lifetimeDirectCellCount: 0,
      lifetimeEnclosedCellCount: 0,
      currentTotalCellRecord: null,
      currentEnclosedCellRecord: null,
      achievementCount: 0,
      achievements: [],
      recentFlights: [],
    });
    await expect(profiles.getPilotProfile('00000000-0000-4000-8000-000000000099')).resolves.toBeNull();
  });

  it('computes the next unique-cell milestone for zero, exact-threshold, and recurring totals', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const profiles = createProfileService(database.db, { cellSize: 1_000 });

    const createPilotWithClaims = async (email: string, claimCount: number) => {
      const pilot = await auth.signup({
        email,
        password: 'correct horse battery staple',
      });
      if (claimCount === 0) return pilot.user.userId;

      const [igcFile] = await database.db.insert(igcFiles).values({
        userId: pilot.user.userId,
        originalFilename: `${email}.igc`,
        contentType: 'application/vnd.fai.igc',
        byteSize: 1,
        bucketKey: `milestone/${crypto.randomUUID()}.igc`,
      }).returning({ id: igcFiles.id });
      if (!igcFile) throw new Error('IGC file insert returned no row.');
      const [flight] = await database.db.insert(flights).values({
        userId: pilot.user.userId,
        igcFileId: igcFile.id,
        contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        processingStatus: 'completed',
      }).returning({ id: flights.id });
      if (!flight) throw new Error('Flight insert returned no row.');

      await database.db.insert(personalGridClaims).values(Array.from({ length: claimCount }, (_, index) => ({
        claimUser: pilot.user.userId,
        claimFlight: flight.id,
        cellSize: 1_000,
        x: index,
        y: 0,
        claimTimestamp: new Date(),
      })));
      return pilot.user.userId;
    };

    const emptyPilotId = await createPilotWithClaims('milestone-empty@example.com', 0);
    const exactThresholdPilotId = await createPilotWithClaims('milestone-exact@example.com', 10);
    const recurringPilotId = await createPilotWithClaims('milestone-recurring@example.com', 1_001);

    await expect(profiles.getPilotProfile(emptyPilotId)).resolves.toEqual(expect.objectContaining({
      lifetimeUniqueCellCount: 0,
      nextUniqueCellMilestone: 10,
      uniqueCellsToNextMilestone: 10,
      nextUniqueCellMilestoneProgressPercent: 0,
    }));
    await expect(profiles.getPilotProfile(exactThresholdPilotId)).resolves.toEqual(expect.objectContaining({
      lifetimeUniqueCellCount: 10,
      nextUniqueCellMilestone: 25,
      uniqueCellsToNextMilestone: 15,
      nextUniqueCellMilestoneProgressPercent: 40,
    }));
    await expect(profiles.getPilotProfile(recurringPilotId)).resolves.toEqual(expect.objectContaining({
      lifetimeUniqueCellCount: 1_001,
      nextUniqueCellMilestone: 2_000,
      uniqueCellsToNextMilestone: 999,
      nextUniqueCellMilestoneProgressPercent: 50,
    }));
  });

  it('limits profile history to the latest 50 achievements and 20 flights', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'history-limits@example.com',
      password: 'correct horse battery staple',
      displayName: 'History Pilot',
    });
    const profiles = createProfileService(database.db, { cellSize: 1_000 });
    const flightIds: string[] = [];

    for (let index = 0; index < 25; index += 1) {
      const [igcFile] = await database.db.insert(igcFiles).values({
        userId: pilot.user.userId,
        originalFilename: `history-${index}.igc`,
        contentType: 'application/vnd.fai.igc',
        byteSize: 1,
        bucketKey: `history/${index}-${crypto.randomUUID()}.igc`,
      }).returning({ id: igcFiles.id });
      const [flight] = await database.db.insert(flights).values({
        userId: pilot.user.userId,
        igcFileId: igcFile!.id,
        contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        processingStatus: 'completed',
        launchTimezone: 'UTC',
        startedAt: new Date(Date.UTC(2026, 0, index + 1)),
        distanceMeters: 1_000,
        durationSeconds: 60,
      }).returning({ id: flights.id });
      flightIds.push(flight!.id);
    }

    await database.db.insert(flightProgress).values(flightIds.map((flightId, index) => ({
      flightId,
      userId: pilot.user.userId,
      directCellCount: index + 1,
      enclosedCellCount: 0,
      newPersonalCellCount: index + 1,
      personalCellTotalAfter: index + 1,
      evaluatedAt: new Date(Date.UTC(2026, 0, index + 1)),
      updatedAt: new Date(Date.UTC(2026, 0, index + 1)),
    })));
    await database.db.insert(achievements).values(Array.from({ length: 55 }, (_, index) => ({
      userId: pilot.user.userId,
      achievementType: 'unique_cells_milestone',
      achievementKey: `unique-cells:limit-${index}`,
      earnedAt: new Date(Date.UTC(2026, 0, index + 1)),
      details: { milestone: index + 1, previousTotal: index, newTotal: index + 1, newCells: 1 },
    })));

    const profile = await profiles.getPilotProfile(pilot.user.userId);
    expect(profile?.achievements).toHaveLength(50);
    expect(profile?.recentFlights).toHaveLength(20);
    expect(profile?.achievements[0]?.title).toBe('55 Unique Cells');
    expect(profile?.recentFlights[0]?.flightId).toBe(flightIds[24]);
  });
});
