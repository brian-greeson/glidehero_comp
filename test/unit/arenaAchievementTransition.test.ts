import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  batch: vi.fn(async (_database: unknown, inputs: Array<{ key: string }>) => ({
    newlyEarned: inputs.map((input) => input.key),
    alreadyEarned: 0,
  })),
  record: vi.fn(async () => ({
    key: 'most_launches_tagged_one_flight', value: 2, newRecord: true, previousValue: null,
  })),
}));

vi.mock('../../src/services/achievementService.js', () => ({
  awardAchievementsInBatch: mocks.batch,
  awardAchievementRecordInTransaction: mocks.record,
}));

import {
  evaluateArenaAchievementTransitionInTransaction,
  type ArenaAchievementSnapshot,
} from '../../src/services/arenaAchievementService.js';

function row(id: string, arenaType: 'launch' | 'general' | 'state' | 'country', claimedCells: number, visited = false, firstFromLaunch = false, tagged = false) {
  return { id, arenaType, claimableCellCount: arenaType === 'launch' || arenaType === 'general' ? 10 : null, claimedCells, visited, firstFromLaunch, tagged };
}

function snapshot(rows: ReturnType<typeof row>[]): ArenaAchievementSnapshot {
  return { rows, lifetimeUniqueCellCount: 0 };
}

describe('Arena achievement transitions', () => {
  it('attempts only thresholds crossed by the before/after snapshots in deterministic order', async () => {
    mocks.batch.mockClear();
    mocks.record.mockClear();
    const before = snapshot([
      row('launch-a', 'launch', 0, true), row('launch-b', 'launch', 0, true), row('launch-c', 'launch', 0, true),
      row('general-a', 'general', 1), row('state-a', 'state', 1),
    ]);
    const after = snapshot([
      row('launch-e', 'launch', 0, true), row('launch-d', 'launch', 0, true), row('launch-c', 'launch', 0, true),
      row('launch-b', 'launch', 0, true), row('launch-a', 'launch', 0, true),
      row('general-a', 'general', 1), row('general-b', 'general', 1), row('general-c', 'general', 1), row('general-d', 'general', 1), row('general-e', 'general', 1),
      row('state-a', 'state', 1), row('state-b', 'state', 1), row('state-c', 'state', 1),
    ]);

    const result = await evaluateArenaAchievementTransitionInTransaction({} as never, {
      userId: 'user-1', sourceFlightId: 'flight-1', cellSize: 1_000, earnedAt: new Date('2026-07-22T00:00:00Z'),
    }, before, after);

    const inputs = mocks.batch.mock.calls[0]?.[1] as Array<{ key: string; value?: number }>;
    expect(inputs.map((input) => input.key)).toEqual([
      'launches_visited_5', 'general_arenas_explored_5', 'states_flown_in_3',
    ]);
    expect(inputs.map((input) => input.value)).toEqual([5, 5, 3]);
    expect(result.snapshot).toBe(after);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('treats first-flight-from-launch as a source-flight transition only once', async () => {
    mocks.batch.mockClear();
    const before = snapshot([row('launch-a', 'launch', 0, false)]);
    const after = snapshot([row('launch-a', 'launch', 0, true, true)]);
    await evaluateArenaAchievementTransitionInTransaction({} as never, {
      userId: 'user-1', sourceFlightId: 'flight-1', cellSize: 1_000, earnedAt: new Date(),
    }, before, after);
    expect((mocks.batch.mock.calls[0]?.[1] as Array<{ key: string }>).map((input) => input.key)).toContain('first_flight_from_launch');

    mocks.batch.mockClear();
    const revisited = snapshot([row('launch-a', 'launch', 0, true, true)]);
    await evaluateArenaAchievementTransitionInTransaction({} as never, {
      userId: 'user-1', sourceFlightId: 'flight-2', cellSize: 1_000, earnedAt: new Date(),
    }, revisited, revisited);
    expect(mocks.batch.mock.calls[0]?.[1]).toEqual([]);
  });

  it('always sends after-flight launch tags through the strict-best record API', async () => {
    mocks.batch.mockClear();
    mocks.record.mockClear();
    const before = snapshot([row('launch-a', 'launch', 0, true)]);
    const after = snapshot([row('launch-a', 'launch', 0, true, false, true), row('launch-b', 'launch', 0, true, false, true)]);
    await evaluateArenaAchievementTransitionInTransaction({} as never, {
      userId: 'user-1', sourceFlightId: 'flight-2', cellSize: 1_000, earnedAt: new Date(),
    }, before, after);
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      key: 'most_launches_tagged_one_flight', value: 2, sourceFlightId: 'flight-2',
    }));
  });
});
