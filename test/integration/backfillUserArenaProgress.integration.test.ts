import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  flights,
  igcFiles,
  personalGridClaims,
  userAchievementProgress,
  userArenaProgress,
  users,
} from '../../src/db/schema.js';
import { runUserArenaProgressBackfill } from '../../src/scripts/backfillUserArenaProgress.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

describe('user Arena progress backfill', () => {
  it('dry-runs without writes, applies canonical rows and summary, and is rerunnable', async () => {
    const [user] = await database.db.insert(users).values({ email: `arena-backfill-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const userId = user!.id;
    const file = (await database.db.insert(igcFiles).values({
      userId,
      originalFilename: 'arena-backfill.igc',
      contentType: 'application/octet-stream',
      byteSize: 1,
      bucketKey: `arena-backfill/${crypto.randomUUID()}`,
    }).returning({ id: igcFiles.id }))[0]!;
    const flight = (await database.db.insert(flights).values({
      userId,
      igcFileId: file.id,
      contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
      processingStatus: 'completed',
      launchLatitude: 0,
      launchLongitude: 0,
      launchTimezone: 'UTC',
    }).returning({ id: flights.id }))[0]!;
    const [launch, general] = await Promise.all([
      database.pool.query<{ id: string }>(`INSERT INTO arenas
        (source_id, name, country, country_code, area, arena_type, claimable_cell_count)
        VALUES (1, 'Launch', 'Testland', 'TT', ST_SetSRID(ST_Multi(ST_GeomFromText('POLYGON((-500 -500,500 -500,500 500,-500 500,-500 -500))', 6933)), 6933), 'launch', 1)
        RETURNING id`),
      database.pool.query<{ id: string }>(`INSERT INTO arenas
        (source_id, name, country, country_code, area, arena_type, claimable_cell_count)
        VALUES (2, 'General', 'Testland', 'TT', ST_SetSRID(ST_Multi(ST_GeomFromText('POLYGON((0 0,500 0,500 500,0 500,0 0))', 6933)), 6933), 'general', 1)
        RETURNING id`),
    ]);
    await database.db.insert(personalGridClaims).values({
      claimUser: userId,
      claimFlight: flight.id,
      x: 0,
      y: 0,
      claimTimestamp: new Date(),
    });

    const dry = await runUserArenaProgressBackfill(database.db, { apply: false });
    expect(dry.usersInspected).toBe(1);
    expect(dry.arenaProgressRowsInserted).toBe(2);
    expect(dry.achievementProgressRowsInserted).toBe(1);
    expect(await database.db.select().from(userArenaProgress)).toHaveLength(0);
    expect(await database.db.select().from(userAchievementProgress)).toHaveLength(0);

    const applied = await runUserArenaProgressBackfill(database.db, { apply: true });
    expect(applied.arenaProgressRowsInserted).toBe(2);
    expect(applied.achievementProgressRowsInserted).toBe(1);
    expect(await database.db.select().from(userArenaProgress)).toHaveLength(2);
    expect((await database.db.select().from(userAchievementProgress)).at(0)).toMatchObject({
      userId,
      lifetimeUniqueCellCount: 1,
      launchArenasVisited: 1,
      generalArenasExplored: 1,
      projectionVersion: 2,
    });

    await database.db.update(userAchievementProgress)
      .set({ projectionVersion: 1 })
      .where(eq(userAchievementProgress.userId, userId));
    const rerun = await runUserArenaProgressBackfill(database.db, { apply: true });
    expect(rerun.arenaProgressRowsInserted).toBe(0);
    expect(rerun.arenaProgressRowsDeleted).toBe(0);
    expect(rerun.achievementProgressRowsUpdated).toBe(1);
    expect(rerun.usersWithChanges).toBe(1);
    expect(await database.db.select().from(userArenaProgress)).toHaveLength(2);
    expect(await database.db.select().from(userAchievementProgress).where(eq(userAchievementProgress.userId, userId))).toEqual([
      expect.objectContaining({ projectionVersion: 2 }),
    ]);
    expect([launch.rows[0]!.id, general.rows[0]!.id]).toHaveLength(2);
  });
});
