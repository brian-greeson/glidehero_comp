import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { profiles, userAchievementProgress, users } from '../../src/db/schema.js';
import { runUserAchievementProgressBackfill } from '../../src/scripts/backfillUserAchievementProgress.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createProfile(label: string): Promise<string> {
  const [user] = await database.db.insert(users).values({ email: `progress-backfill-${label}-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  if (!user) throw new Error('user insert failed');
  await database.db.insert(profiles).values({ userId: user.id, displayName: label });
  return user.id;
}

describe('user achievement progress backfill', () => {
  it('batches users, rolls dry-run back, applies idempotent projections, and logs each batch', async () => {
    const first = await createProfile('first');
    const second = await createProfile('second');
    const third = await createProfile('third');
    const dryLog: string[] = [];
    const dry = await runUserAchievementProgressBackfill(database.db, {
      apply: false,
      batchSize: 2,
      logger: { log: (line) => dryLog.push(line), error: () => undefined },
    });
    expect(dry.usersInspected).toBe(3);
    expect(dryLog.some((line) => line.includes('Processing batch 1 / 2'))).toBe(true);
    expect(dryLog.some((line) => line.includes('Completed batch 2 / 2'))).toBe(true);
    expect(await database.db.select().from(userAchievementProgress)).toHaveLength(0);

    const applied = await runUserAchievementProgressBackfill(database.db, { apply: true, batchSize: 2 });
    expect(applied.failures).toBe(0);
    expect(applied.projectionsInserted).toBe(3);
    expect(await database.db.select().from(userAchievementProgress)).toHaveLength(3);

    const rerun = await runUserAchievementProgressBackfill(database.db, { apply: true, batchSize: 2 });
    expect(rerun.projectionsInserted).toBe(0);
    expect(rerun.projectionsUpdated).toBe(3);
    expect(await database.db.select().from(userAchievementProgress).where(eq(userAchievementProgress.userId, first))).toHaveLength(1);
    expect(await database.db.select().from(userAchievementProgress).where(eq(userAchievementProgress.userId, second))).toHaveLength(1);
    expect(await database.db.select().from(userAchievementProgress).where(eq(userAchievementProgress.userId, third))).toHaveLength(1);
  });
});
