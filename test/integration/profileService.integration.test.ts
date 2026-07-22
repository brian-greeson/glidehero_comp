import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { achievementRecordEvents, achievementRecords, achievements, flights, flightProgress, igcFiles, personalGridClaims, pilotFollows } from '../../src/db/schema.js';
import { createAuthService } from '../../src/services/authService.js';
import { createProfileService, normalizeTerritoryColor } from '../../src/services/profileService.js';
import { createUserAchievementProgressService } from '../../src/services/userAchievementProgressService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

async function rebuildProgress(userId: string, cellSize = 1_000): Promise<void> {
  const progress = createUserAchievementProgressService(database.db, { cellSize });
  await database.db.transaction(async (transaction) => {
    await progress.rebuildInTransaction(transaction, userId);
  });
}

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE arenas, users CASCADE');
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

  it('returns follower and following counts for current and public profiles', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({ email: 'counts-pilot@example.com', password: 'correct horse battery staple', displayName: 'Counts Pilot' });
    const follower = await auth.signup({ email: 'counts-follower@example.com', password: 'correct horse battery staple', displayName: 'Counts Follower' });
    const otherFollower = await auth.signup({ email: 'counts-other@example.com', password: 'correct horse battery staple', displayName: 'Counts Other' });
    await database.db.insert(pilotFollows).values([
      { followerUserId: follower.user.userId, followedUserId: pilot.user.userId },
      { followerUserId: otherFollower.user.userId, followedUserId: pilot.user.userId },
      { followerUserId: pilot.user.userId, followedUserId: follower.user.userId },
    ]);

    const profiles = createProfileService(database.db, { cellSize: 1_000 });
    await expect(profiles.getPilotProfile(pilot.user.userId)).resolves.toEqual(expect.objectContaining({
      followerCount: 2,
      followingCount: 1,
    }));
    await expect(profiles.getPilotProfile(follower.user.userId)).resolves.toEqual(expect.objectContaining({
      followerCount: 1,
      followingCount: 1,
    }));
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
      { claimUser: pilot.user.userId, claimFlight: firstFlight, x: 1, y: 2, claimTimestamp: new Date() },
      { claimUser: pilot.user.userId, claimFlight: secondFlight, x: 1, y: 2, claimTimestamp: new Date() },
      { claimUser: pilot.user.userId, claimFlight: secondFlight, x: 3, y: 4, claimTimestamp: new Date() },
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
    await rebuildProgress(pilot.user.userId);

    const summary = await profiles.getPilotProfile(pilot.user.userId);
    expect(summary).toEqual({
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
      followerCount: 0,
      followingCount: 0,
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
      currentArenaLeaderships: [],
    });
    const achievementsSummary = await profiles.getPilotAchievements(pilot.user.userId);
    expect(achievementsSummary?.achievementProgress.map((progress) => progress.key)).toEqual([
      'unique_cells', 'launches_visited', 'general_arenas_explored', 'general_coverage', 'states_flown_in', 'countries_flown_in',
    ]);
    expect(achievementsSummary?.achievementProgress[0]).toEqual(expect.objectContaining({ currentValue: 2, targetValue: 10, progressPercent: 20 }));
    await expect(profiles.getDashboardAchievementProgress(pilot.user.userId)).resolves.toEqual(
      achievementsSummary?.achievementProgress.slice(0, 3),
    );
    expect(achievementsSummary?.achievements).toHaveLength(3);

    const emptySummary = await profiles.getPilotProfile(emptyPilot.user.userId);
    expect(emptySummary).toEqual({
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
      followerCount: 0,
      followingCount: 0,
      recentFlights: [],
      currentArenaLeaderships: [],
    });
    expect((await profiles.getPilotAchievements(emptyPilot.user.userId))?.achievementProgress).toHaveLength(6);
    await expect(profiles.getPilotProfile('00000000-0000-4000-8000-000000000099')).resolves.toBeNull();
  });

  it('reads persisted current Arena leaderships with stable ordering and floored coverage', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'leadership-profile@example.com',
      password: 'correct horse battery staple',
      displayName: 'Leadership Pilot',
    });
    const jointPilot = await auth.signup({
      email: 'joint-leadership-profile@example.com',
      password: 'correct horse battery staple',
      displayName: 'Joint Pilot',
    });
    const profiles = createProfileService(database.db, { cellSize: 1_000 });
    const soleArena = crypto.randomUUID();
    const jointArena = crypto.randomUUID();
    const launchArena = crypto.randomUUID();
    const invalidArena = crypto.randomUUID();
    const shape = 'MULTIPOLYGON (((0 0, 1000 0, 1000 1000, 0 1000, 0 0)))';
    await database.pool.query(
      `INSERT INTO arenas
        (id, source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
       VALUES
        ($1, 101, 'Zeta State', 'United States', 'US', ST_GeomFromText($5, 6933), 'state', 'state-101', 1000),
        ($2, 102, 'Alpha General', 'United States', 'US', ST_GeomFromText($5, 6933), 'general', NULL, 1000),
        ($3, 103, 'Launch Excluded', 'United States', 'US', ST_GeomFromText($5, 6933), 'launch', NULL, 100),
        ($4, 104, 'Invalid Denominator', 'United States', 'US', ST_GeomFromText($5, 6933), 'country', 'country-104', 0)`,
      [soleArena, jointArena, launchArena, invalidArena, shape],
    );
    await database.pool.query(
      `INSERT INTO arena_leadership_states (arena_id, arena_type, leading_cell_count, next_rank_cell_count)
       VALUES ($1, 'state', 7, 0), ($2, 'general', 123, 121), ($3, 'country', 2, 1)`,
     [soleArena, jointArena, invalidArena],
    );
    await database.pool.query(
      `INSERT INTO arena_current_leaders
        (arena_id, user_id, cells_claimed, took_lead_at, decisive_cell_x, decisive_cell_y)
       VALUES
        ($1, $4, 7, '2026-07-19T12:00:00Z', 1, 1),
        ($2, $4, 123, '2026-07-20T12:00:00Z', 1000, 1),
        ($2, $5, 123, '2026-07-18T12:00:00Z', 2, 2),
        ($3, $4, 2, '2026-07-21T12:00:00Z', 3, 3)`,
      [soleArena, jointArena, invalidArena, pilot.user.userId, jointPilot.user.userId],
    );

    const profile = await profiles.getPilotProfile(pilot.user.userId);
    expect(profile?.currentArenaLeaderships).toEqual([
      expect.objectContaining({
        arenaId: invalidArena,
        arenaName: 'Invalid Denominator',
        arenaType: 'country',
        arenaPath: '/arena/us/invalid-denominator-104',
        status: 'sole',
        cellsClaimed: 2,
        coveragePercent: null,
        leadMarginCells: 1,
        leadingSince: 'Jul 21, 2026',
      }),
      expect.objectContaining({
        arenaId: jointArena,
        arenaName: 'Alpha General',
        arenaType: 'general',
        arenaPath: '/arena/us/alpha-general-102',
        status: 'joint',
        cellsClaimed: 123,
        coveragePercent: 12.3,
        leadMarginCells: 2,
        leadingSince: 'Jul 20, 2026',
      }),
      expect.objectContaining({
        arenaId: soleArena,
        arenaName: 'Zeta State',
        arenaType: 'state',
        arenaPath: '/arena/us/zeta-state-101',
        status: 'sole',
        cellsClaimed: 7,
        coveragePercent: null,
        leadMarginCells: 7,
        leadingSince: 'Jul 19, 2026',
      }),
    ]);
    expect(profile?.currentArenaLeaderships).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ arenaId: launchArena }),
    ]));
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

  it('builds ordered Arena milestone cards from distinct Personal cells and completed launch origins', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'arena-progress-cards@example.com', password: 'correct horse battery staple', displayName: 'Arena Pilot',
    });
    const createFlight = async (label: string) => {
      const [file] = await database.db.insert(igcFiles).values({
        userId: pilot.user.userId, originalFilename: `${label}.igc`, contentType: 'application/vnd.fai.igc',
        byteSize: 1, bucketKey: `profile-progress/${label}-${crypto.randomUUID()}.igc`,
      }).returning({ id: igcFiles.id });
      const [created] = await database.db.insert(flights).values({
        userId: pilot.user.userId, igcFileId: file!.id,
        contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'), processingStatus: 'completed',
        launchLatitude: 0, launchLongitude: 0, launchTimezone: 'UTC',
      }).returning({ id: flights.id });
      return created!.id;
    };
    const firstFlight = await createFlight('first');
    const secondFlight = await createFlight('second');
    await database.db.insert(personalGridClaims).values([
      { claimUser: pilot.user.userId, claimFlight: firstFlight, x: 0, y: 0, claimTimestamp: new Date() },
      { claimUser: pilot.user.userId, claimFlight: secondFlight, x: 0, y: 0, claimTimestamp: new Date() },
    ]);
    const insertArena = (sourceId: number, name: string, type: string, wkt: string, total: number | null) => database.pool.query(`
      INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
      VALUES ($1, $2, 'United States', 'US', ST_Multi(ST_GeomFromText($3, 6933)), $4, $5, $6)
    `, [sourceId, name, wkt, type, ['state', 'country'].includes(type) ? `${type}-${sourceId}` : null, total]);
    await insertArena(10, 'Launch', 'launch', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 1);
    await insertArena(11, 'Best General', 'general', 'POLYGON((0 0,2000 0,2000 1000,0 1000,0 0))', 2);
    await insertArena(12, 'Large General', 'general', 'POLYGON((0 0,2000 0,2000 2000,0 2000,0 0))', 4);
    await insertArena(13, 'Colorado', 'state', 'POLYGON((0 0,2000 0,2000 2000,0 2000,0 0))', null);
    await insertArena(14, 'United States', 'country', 'POLYGON((0 0,2000 0,2000 2000,0 2000,0 0))', null);
    await rebuildProgress(pilot.user.userId);

    const profileService = createProfileService(database.db, { cellSize: 1_000 });
    const profile = await profileService.getPilotAchievements(pilot.user.userId);

    expect(profile?.achievementProgress.map((progress) => progress.key)).toEqual([
      'unique_cells', 'launches_visited', 'general_arenas_explored', 'general_coverage', 'states_flown_in', 'countries_flown_in',
    ]);
    expect(profile?.achievementProgress).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'launches_visited', currentValue: 1, targetValue: 3 }),
      expect.objectContaining({ key: 'general_arenas_explored', currentValue: 2, targetValue: 5 }),
      expect.objectContaining({ key: 'general_coverage', currentValue: 50, targetValue: 75, arenaPath: '/arena/us/best-general-11' }),
      expect.objectContaining({ key: 'states_flown_in', currentValue: 1, targetValue: 3 }),
      expect.objectContaining({ key: 'countries_flown_in', currentValue: 1, targetValue: 3 }),
    ]));
    await expect(createProfileService(database.db, { cellSize: 1_000 }).getDashboardAchievementProgress(pilot.user.userId))
      .resolves.toEqual([
        expect.objectContaining({ key: 'general_coverage', progressPercent: 67 }),
        expect.objectContaining({ key: 'general_arenas_explored', progressPercent: 40 }),
        expect.objectContaining({ key: 'launches_visited', progressPercent: 33 }),
      ]);
  });

  it('returns the full achievement history and limits recent flights to 20', async () => {
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
    const achievementsProfile = await profiles.getPilotAchievements(pilot.user.userId);
    expect(achievementsProfile?.achievements).toHaveLength(55);
    expect(profile?.recentFlights).toHaveLength(20);
    expect(achievementsProfile?.achievements[0]?.title).toBe('55 Unique Cells');
    expect(profile?.recentFlights[0]?.flightId).toBe(flightIds[24]);
  });

  it('renders Release 2 catalog achievements and merges every record event into one history', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'release-two-achievements@example.com',
      password: 'correct horse battery staple',
    });
    const profiles = createProfileService(database.db, { cellSize: 1_000 });
    const earnedAt = (day: number) => new Date(Date.UTC(2026, 6, day, 12));
    await database.db.insert(achievements).values([
      { userId: pilot.user.userId, achievementType: 'special', achievementKey: 'first_flight_from_launch', earnedAt: earnedAt(1), details: {} },
      { userId: pilot.user.userId, achievementType: 'threshold', achievementKey: 'launches_visited_3', earnedAt: earnedAt(2), details: {} },
      { userId: pilot.user.userId, achievementType: 'special', achievementKey: 'complete_a_launch_arena', earnedAt: earnedAt(3), details: {} },
      { userId: pilot.user.userId, achievementType: 'special', achievementKey: 'first_cells_in_general_arena', earnedAt: earnedAt(4), details: {} },
      { userId: pilot.user.userId, achievementType: 'threshold', achievementKey: 'general_arenas_explored_1', earnedAt: earnedAt(5), details: {} },
      { userId: pilot.user.userId, achievementType: 'threshold', achievementKey: 'general_coverage_10', earnedAt: earnedAt(6), details: {} },
      { userId: pilot.user.userId, achievementType: 'threshold', achievementKey: 'states_flown_in_1', earnedAt: earnedAt(7), details: {} },
      { userId: pilot.user.userId, achievementType: 'threshold', achievementKey: 'countries_flown_in_1', earnedAt: earnedAt(8), details: {} },
      { userId: pilot.user.userId, achievementType: 'legacy', achievementKey: 'legacy:unknown', earnedAt: earnedAt(9), details: { secret: 'must not render' } },
      { userId: pilot.user.userId, achievementType: 'record', achievementKey: 'most_launches_tagged_one_flight', earnedAt: earnedAt(9), details: { value: 99, secret: 'malformed' } },
    ]);
    const [record] = await database.db.insert(achievementRecords).values({
      userId: pilot.user.userId,
      recordKey: 'most_launches_tagged_one_flight',
      bestValue: 3,
      earnedAt: earnedAt(10),
      details: { value: 3 },
    }).returning({ id: achievementRecords.id });
    if (!record) throw new Error('Record insert returned no row.');
    await database.db.insert(achievementRecordEvents).values([
      { recordId: record.id, userId: pilot.user.userId, value: 1, earnedAt: earnedAt(11), details: { value: 1 } },
      { recordId: record.id, userId: pilot.user.userId, value: 3, earnedAt: earnedAt(12), details: { value: 3, previousValue: 1, privateDetail: 'do not render' } },
    ]);

    const profile = await profiles.getPilotAchievements(pilot.user.userId);
    expect(profile?.achievementCount).toBe(12);
    expect(profile?.achievements).toHaveLength(12);
    expect(profile?.achievements[0]).toEqual(expect.objectContaining({
      id: expect.stringContaining('record-event:'),
      title: 'Most Launches Tagged During One Flight',
      typeLabel: 'Launch Arena personal best',
      badgeLabel: '3',
      description: 'Tagged 3 Launch Arenas during one flight, improving the previous best of 1.',
    }));
    expect(profile?.achievements[1]).toEqual(expect.objectContaining({
      title: 'Most Launches Tagged During One Flight',
      description: 'Tagged 1 Launch Arena during one flight, establishing an initial record.',
    }));
    expect(profile?.achievements.find((achievement) => achievement.title === '10% General Arena Coverage')).toEqual(expect.objectContaining({
      typeLabel: 'General Arena',
      badgeLabel: '10%',
    }));
    expect(profile?.achievements.find((achievement) => achievement.title === '1 Country Flown in')).toEqual(expect.objectContaining({
      typeLabel: 'Country',
      badgeLabel: '1',
    }));
    expect(profile?.achievements.find((achievement) => achievement.title === 'Progress Achievement')).toEqual(expect.objectContaining({
      title: 'Progress Achievement',
      description: 'A progression achievement earned during a flight.',
    }));
    expect(profile?.achievements.filter((achievement) => achievement.title === 'Progress Achievement')).toHaveLength(2);
    expect(profile?.achievements.some((achievement) => achievement.description.includes('privateDetail'))).toBe(false);
    expect(profile?.achievements.some((achievement) => achievement.description.includes('malformed'))).toBe(false);
    expect(profile?.achievements.some((achievement) => achievement.title.includes('most_launches'))).toBe(false);
  });

  it('renders Arena leadership achievements with the Arena name', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'arena-leadership-profile@example.com',
      password: 'correct horse battery staple',
    });
    await database.db.insert(achievements).values([
      {
        userId: pilot.user.userId,
        achievementType: 'special',
        achievementKey: 'took_lead_in_arena',
        earnedAt: new Date('2026-07-01T12:00:00Z'),
        details: { arenaId: crypto.randomUUID(), arenaName: 'Colorado' },
      },
      {
        userId: pilot.user.userId,
        achievementType: 'special',
        achievementKey: 'reclaimed_lead_in_arena',
        earnedAt: new Date('2026-07-02T12:00:00Z'),
        details: { arenaId: crypto.randomUUID(), arenaName: 'Colorado' },
      },
    ]);

    const profile = await createProfileService(database.db, { cellSize: 1_000 }).getPilotAchievements(pilot.user.userId);
    expect(profile?.achievements.map((achievement) => achievement.title)).toEqual([
      'Reclaimed the Lead in Colorado',
      'Took the Lead in Colorado',
    ]);
    expect(profile?.achievements[0]).toMatchObject({
      typeLabel: 'Arena Leadership',
      description: 'Reclaimed the Lead in Colorado.',
      earnedDate: 'Jul 2, 2026',
      earnedTimestamp: 'Jul 2, 2026, 12:00:00 PM UTC',
    });
    expect(profile?.achievements[1]).toMatchObject({
      earnedDate: 'Jul 1, 2026',
      earnedTimestamp: 'Jul 1, 2026, 12:00:00 PM UTC',
    });
  });

  it('returns one mixed ordinary and record-event history globally in newest-first order', async () => {
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const pilot = await auth.signup({
      email: 'release-two-mixed-history@example.com',
      password: 'correct horse battery staple',
    });
    const profiles = createProfileService(database.db, { cellSize: 1_000 });
    const ordinaryIds: string[] = [];
    const eventIds: string[] = [];
    const allIds: string[] = [];
    const earnedAt = (index: number) => new Date(Date.UTC(2026, 6, 1, 0, index));
    const ordinaryRows = Array.from({ length: 30 }, (_, index) => {
      const id = crypto.randomUUID();
      ordinaryIds.push(id);
      allIds[index * 2] = id;
      return {
        id,
        userId: pilot.user.userId,
        achievementType: 'legacy',
        achievementKey: `mixed-legacy-${index}`,
        earnedAt: earnedAt(index * 2),
        details: {},
      };
    });
    await database.db.insert(achievements).values(ordinaryRows);
    const [record] = await database.db.insert(achievementRecords).values({
      userId: pilot.user.userId,
      recordKey: 'most_launches_tagged_one_flight',
      bestValue: 30,
      earnedAt: earnedAt(59),
      details: { value: 30 },
    }).returning({ id: achievementRecords.id });
    if (!record) throw new Error('Record insert returned no row.');
    await database.db.insert(achievementRecordEvents).values(Array.from({ length: 30 }, (_, index) => {
      const id = crypto.randomUUID();
      eventIds.push(id);
      allIds[index * 2 + 1] = `record-event:${id}`;
      return {
        id,
        recordId: record.id,
        userId: pilot.user.userId,
        value: index + 1,
        earnedAt: earnedAt(index * 2 + 1),
        details: index === 0 ? { value: 1 } : { value: index + 1, previousValue: index },
      };
    }));

    const profile = await profiles.getPilotAchievements(pilot.user.userId);
    expect(profile?.achievementCount).toBe(60);
    expect(profile?.achievements).toHaveLength(60);
    const expectedIds = [...allIds].reverse();
    expect(profile?.achievements.map((achievement) => achievement.id)).toEqual(expectedIds);
    expect(profile?.achievements.at(-1)?.id).toBe(allIds[0]);
    expect(profile?.achievements.some((achievement) => achievement.id.startsWith('record-event:'))).toBe(true);
    expect(profile?.achievements.some((achievement) => ordinaryIds.includes(achievement.id))).toBe(true);
  });
});
