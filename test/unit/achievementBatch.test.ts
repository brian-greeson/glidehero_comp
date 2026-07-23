import { describe, expect, it, vi } from 'vitest';
import { awardAchievementsInBatch } from '../../src/services/achievementService.js';

function fakeDatabase(inserted: Array<{ userId: string; key: string }>) {
  const returning = vi.fn(async () => inserted);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  return { database: { insert } as never, insert, values, onConflictDoNothing, returning };
}

describe('batched ordinary achievement persistence', () => {
  it('validates, deduplicates user/key pairs, and reports only returned canonical keys', async () => {
    const fake = fakeDatabase([{ userId: 'user-1', key: 'launches_visited_3' }]);
    const result = await awardAchievementsInBatch(fake.database, [
      { userId: 'user-1', key: 'launches_visited_3', value: 3, details: { visitedLaunches: 3 } },
      { userId: 'user-1', key: 'launches_visited_3', value: 5 },
      { userId: 'user-1', key: 'first_flight_from_launch' },
      { userId: 'user-2', key: 'launches_visited_3', value: 3 },
    ]);

    expect(fake.insert).toHaveBeenCalledTimes(1);
    const rows = (fake.values.mock.calls[0] as unknown[] | undefined)?.[0] as unknown as Array<{ userId: string; achievementKey: string; details: Record<string, unknown> }>;
    expect(rows.map((row) => `${row.userId}:${row.achievementKey}`)).toEqual([
      'user-1:launches_visited_3', 'user-1:first_flight_from_launch', 'user-2:launches_visited_3',
    ]);
    expect(rows[0]?.details).toMatchObject({ visitedLaunches: 3, value: 3, threshold: 3, category: 'launch', kind: 'threshold' });
    expect(result).toEqual({ newlyEarned: ['launches_visited_3'], alreadyEarned: 2 });
  });

  it('validates every catalog value before writing', async () => {
    const fake = fakeDatabase([]);
    await expect(awardAchievementsInBatch(fake.database, [
      { userId: 'user-1', key: 'launches_visited_3', value: 2 },
    ])).rejects.toThrow('below its threshold');
    expect(fake.insert).not.toHaveBeenCalled();
  });
});
