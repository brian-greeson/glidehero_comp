import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { flights, igcFiles, personalGridClaims, userAchievementProgress, users } from '../../src/db/schema.js';
import { createUserAchievementProgressService, USER_ACHIEVEMENT_PROGRESS_COMPLETE_VERSION } from '../../src/services/userAchievementProgressService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { if (database) await database.pool.query('TRUNCATE TABLE arenas, users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createFlight(userId: string, longitude: number, status: 'completed' | 'processing' = 'completed') {
  const [file] = await database.db.insert(igcFiles).values({
    userId, originalFilename: 'progress.igc', contentType: 'application/octet-stream', byteSize: 1,
    bucketKey: `progress/${crypto.randomUUID()}`,
  }).returning({ id: igcFiles.id });
  const [flight] = await database.db.insert(flights).values({
    userId, igcFileId: file!.id, contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: status, launchLatitude: 0, launchLongitude: longitude, launchTimezone: 'UTC',
  }).returning({ id: flights.id });
  return flight!.id;
}

async function createArena(sourceId: number, type: 'launch' | 'general' | 'state' | 'country', total: number | null, wkt: string, externalId: string | null = null) {
  const result = await database.pool.query<{ id: string }>(`INSERT INTO arenas
    (source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
    VALUES ($1, $2, 'United States', 'US', ST_Multi(ST_GeomFromText($3, 6933)), $4, $5, $6)
    RETURNING id`, [sourceId, `${type}-${sourceId}`, wkt, type, externalId, total]);
  return result.rows[0]!.id;
}

describe('userAchievementProgressService', () => {
  it('initializes new users as complete v2 and preserves v1 for incremental writes', async () => {
    const [user] = await database.db.insert(users).values({ email: `version-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const service = createUserAchievementProgressService(database.db, { cellSize: 1_000 });
    const initialized = await database.db.transaction((tx) => service.initializeInTransaction(tx, user!.id));
    expect(initialized.projectionVersion).toBe(USER_ACHIEVEMENT_PROGRESS_COMPLETE_VERSION);
    await database.db.update(userAchievementProgress).set({ projectionVersion: 1 }).where(eq(userAchievementProgress.userId, user!.id));
    const snapshot = { lifetimeUniqueCellCount: 1, launchArenasVisited: 0, generalArenasExplored: 0, statesFlownIn: 0, countriesFlownIn: 0, bestGeneralArenaId: null, bestGeneralClaimedCellCount: 0, bestGeneralClaimableCellCount: 0 };
    await database.db.transaction((tx) => service.upsertInTransaction(tx, user!.id, snapshot));
    await expect(service.get(user!.id)).resolves.toMatchObject({ projectionVersion: 1 });
  });

  it('inserts incremental projections as v1 and explicitly promotes authoritative snapshots', async () => {
    const [user] = await database.db.insert(users).values({ email: `promotion-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const service = createUserAchievementProgressService(database.db, { cellSize: 1_000 });
    const snapshot = { lifetimeUniqueCellCount: 0, launchArenasVisited: 0, generalArenasExplored: 0, statesFlownIn: 0, countriesFlownIn: 0, bestGeneralArenaId: null, bestGeneralClaimedCellCount: 0, bestGeneralClaimableCellCount: 0 };
    await database.db.transaction((tx) => service.upsertInTransaction(tx, user!.id, snapshot));
    await expect(service.get(user!.id)).resolves.toMatchObject({ projectionVersion: 1 });
    const arenaSnapshot = { rows: [], lifetimeUniqueCellCount: 0 };
    await database.db.transaction((tx) => service.upsertFromArenaSnapshotInTransaction(tx, user!.id, arenaSnapshot, { promoteToComplete: true }));
    await expect(service.get(user!.id)).resolves.toMatchObject({ projectionVersion: USER_ACHIEVEMENT_PROGRESS_COMPLETE_VERSION });
  });

  it('calculates authoritative progress and persists an idempotent projection', async () => {
    const [user] = await database.db.insert(users).values({ email: `progress-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const userId = user!.id;
    const flightId = await createFlight(userId, 0);
    await createFlight(userId, 10, 'processing');
    await createArena(1, 'launch', 1, 'POLYGON((-1000 -1000,1000 -1000,1000 1000,-1000 1000,-1000 -1000))');
    const generalId = await createArena(2, 'general', 2, 'POLYGON((0 0,2000 0,2000 1000,0 1000,0 0))');
    await createArena(3, 'general', 4, 'POLYGON((0 0,2000 0,2000 2000,0 2000,0 0))');
    await createArena(4, 'state', null, 'POLYGON((0 0,2000 0,2000 1000,0 1000,0 0))', 'state-4');
    await createArena(5, 'country', null, 'POLYGON((0 0,2000 0,2000 1000,0 1000,0 0))', 'country-5');
    await database.db.insert(personalGridClaims).values([
      { claimUser: userId, claimFlight: flightId, x: 0, y: 0, claimTimestamp: new Date() },
      { claimUser: userId, claimFlight: flightId, x: 1, y: 0, claimTimestamp: new Date() },
    ]);

    const service = createUserAchievementProgressService(database.db, { cellSize: 1_000 });
    await expect(service.get(userId)).resolves.toBeNull();
    await expect(service.calculate(userId)).resolves.toMatchObject({
      lifetimeUniqueCellCount: 2,
      launchArenasVisited: 1,
      generalArenasExplored: 2,
      statesFlownIn: 1,
      countriesFlownIn: 1,
      bestGeneralArenaId: generalId,
      bestGeneralClaimedCellCount: 2,
      bestGeneralClaimableCellCount: 2,
    });

    const rebuilt = await database.db.transaction((tx) => service.rebuildInTransaction(tx, userId));
    expect(rebuilt).toMatchObject({ userId, bestGeneralArenaId: generalId });
    expect(rebuilt.projectionVersion).toBe(1);
    await expect(service.get(userId)).resolves.toMatchObject({ userId, lifetimeUniqueCellCount: 2, bestGeneralArenaId: generalId });
    const second = await database.db.transaction((tx) => service.rebuildInTransaction(tx, userId));
    expect(second.bestGeneralArenaId).toBe(generalId);
  });

  it('rebuilds every user, including legacy users without a projection row', async () => {
    const [user] = await database.db.insert(users).values({ email: `legacy-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const userId = user!.id;
    const service = createUserAchievementProgressService(database.db, { cellSize: 1_000 });

    await database.db.transaction((tx) => service.rebuildAllInTransaction(tx));

    await expect(service.get(userId)).resolves.toMatchObject({
      userId,
      lifetimeUniqueCellCount: 0,
      launchArenasVisited: 0,
    });
  });

  it('preserves lifetime cells when the Arena catalog is empty', async () => {
    const [user] = await database.db.insert(users).values({ email: `empty-catalog-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const userId = user!.id;
    const flightId = await createFlight(userId, 0);
    await database.db.insert(personalGridClaims).values({
      claimUser: userId,
      claimFlight: flightId,
      x: 12,
      y: -3,
      claimTimestamp: new Date(),
    });
    const service = createUserAchievementProgressService(database.db, { cellSize: 1_000 });

    await expect(service.calculate(userId)).resolves.toMatchObject({
      lifetimeUniqueCellCount: 1,
      launchArenasVisited: 0,
      generalArenasExplored: 0,
    });
  });
});
