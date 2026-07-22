import { describe, expect, it } from 'vitest';
import {
  arenaLeadershipEventTypes,
  eligibleArenaTypes,
  isEligibleArenaType,
  replayArenaLeadership,
  type ArenaLeadershipClaim,
} from '../../src/domain/arena/leadership.js';

describe('Arena leadership domain rules', () => {
  it('limits leadership to non-Launch Arenas and the three persisted transition kinds', () => {
    expect(eligibleArenaTypes).toEqual(['general', 'state', 'country']);
    expect(arenaLeadershipEventTypes).toEqual(['took', 'reclaimed', 'lost']);
    expect(isEligibleArenaType('general')).toBe(true);
    expect(isEligibleArenaType('state')).toBe(true);
    expect(isEligibleArenaType('country')).toBe(true);
    expect(isEligibleArenaType('launch')).toBe(false);
  });
});

const pilotA = '00000000-0000-0000-0000-000000000001';
const pilotB = '00000000-0000-0000-0000-000000000002';
const flightA = '10000000-0000-0000-0000-000000000001';
const flightB = '10000000-0000-0000-0000-000000000002';
const arenaId = '20000000-0000-0000-0000-000000000001';

function claim(input: Omit<Partial<ArenaLeadershipClaim>, 'claimTimestamp'> & {
  userId: string;
  cellX: number;
  claimTimestamp?: string | Date;
}): ArenaLeadershipClaim {
  return {
    arenaId,
    userId: input.userId,
    claimTimestamp: new Date(input.claimTimestamp ?? '2026-01-01T00:00:00.000Z'),
    sourceFlightId: input.sourceFlightId ?? flightA,
    competitionMonth: input.competitionMonth ?? '2026-01-01',
    cellX: input.cellX,
    cellY: input.cellY ?? 0,
  };
}

describe('Arena leadership replay', () => {
  it('records sole leader, tie entry, tie break, loss, and reclaim without resetting a continuing leader', () => {
    const result = replayArenaLeadership([
      claim({ userId: pilotA, cellX: 1 }),
      claim({ userId: pilotB, cellX: 2, claimTimestamp: '2026-01-02T00:00:00.000Z' }),
      claim({ userId: pilotA, cellX: 3, claimTimestamp: '2026-01-03T00:00:00.000Z' }),
      claim({ userId: pilotB, cellX: 4, claimTimestamp: '2026-01-04T00:00:00.000Z' }),
      claim({ userId: pilotB, cellX: 5, claimTimestamp: '2026-01-05T00:00:00.000Z' }),
      claim({ userId: pilotA, cellX: 6, claimTimestamp: '2026-01-06T00:00:00.000Z', sourceFlightId: flightB }),
      claim({ userId: pilotA, cellX: 7, claimTimestamp: '2026-01-07T00:00:00.000Z', sourceFlightId: flightB }),
    ]);

    expect(result.leadingCellCount).toBe(4);
    expect(result.nextRankCellCount).toBe(3);
    expect(result.events.map((event) => `${event.eventType}:${event.userId}`)).toEqual([
      `took:${pilotA}`,
      `took:${pilotB}`,
      `lost:${pilotB}`,
      `reclaimed:${pilotB}`,
      `lost:${pilotA}`,
      `reclaimed:${pilotA}`,
      `lost:${pilotB}`,
    ]);
    expect(result.currentLeaders).toHaveLength(1);
    expect(result.currentLeaders[0]).toMatchObject({ userId: pilotA, cellsClaimed: 4, cellX: 6 });
    expect(result.currentLeaders[0]?.tookLeadAt).toEqual(new Date('2026-01-06T00:00:00.000Z'));
  });

  it('deduplicates repeat pilot cells and sorts out-of-order and equal-timestamp claims deterministically', () => {
    const repeated = claim({ userId: pilotA, cellX: 1, claimTimestamp: '2026-01-02T00:00:00.000Z', sourceFlightId: flightB });
    const earliest = claim({ userId: pilotA, cellX: 1, claimTimestamp: '2026-01-01T00:00:00.000Z', sourceFlightId: flightA });
    const claims = [
      claim({ userId: pilotB, cellX: 3, claimTimestamp: '2026-01-01T00:00:00.000Z', sourceFlightId: flightB }),
      repeated,
      earliest,
      claim({ userId: pilotA, cellX: 2, claimTimestamp: '2026-01-01T00:00:00.000Z', sourceFlightId: flightA }),
    ];
    const result = replayArenaLeadership(claims);
    expect(result.leadingCellCount).toBe(2);
    expect(result.nextRankCellCount).toBe(1);
    expect(result.currentLeaders[0]?.tookLeadAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(result.events.filter((event) => event.eventType === 'took')).toHaveLength(1);
  });

  it('returns an empty snapshot for an empty Arena', () => {
    expect(replayArenaLeadership([])).toEqual({
      leadingCellCount: 0,
      nextRankCellCount: 0,
      currentLeaders: [],
      events: [],
    });
  });
});
