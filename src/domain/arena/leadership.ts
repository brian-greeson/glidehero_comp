export const eligibleArenaTypes = ['general', 'state', 'country'] as const;

export type EligibleArenaType = (typeof eligibleArenaTypes)[number];

export const arenaLeadershipEventTypes = ['took', 'reclaimed', 'lost'] as const;

export type ArenaLeadershipEventType = (typeof arenaLeadershipEventTypes)[number];

export type ArenaLeadershipClaim = {
  arenaId: string;
  userId: string;
  claimTimestamp: Date;
  sourceFlightId: string;
  competitionMonth: string;
  cellSize: number;
  cellX: number;
  cellY: number;
};

export type ArenaLeadershipReplayEvent = ArenaLeadershipClaim & {
  eventType: ArenaLeadershipEventType;
  eventKey: string;
};

export type ArenaLeadershipCurrentLeader = ArenaLeadershipClaim & {
  cellsClaimed: number;
  tookLeadAt: Date;
};

export type ArenaLeadershipReplayResult = {
  leadingCellCount: number;
  nextRankCellCount: number;
  currentLeaders: ArenaLeadershipCurrentLeader[];
  events: ArenaLeadershipReplayEvent[];
};

export function isEligibleArenaType(value: string): value is EligibleArenaType {
  return (eligibleArenaTypes as readonly string[]).includes(value);
}

export function compareArenaLeadershipClaims(left: ArenaLeadershipClaim, right: ArenaLeadershipClaim): number {
  const timestampDifference = left.claimTimestamp.getTime() - right.claimTimestamp.getTime();
  if (timestampDifference !== 0) return timestampDifference;
  const flightDifference = left.sourceFlightId.localeCompare(right.sourceFlightId);
  if (flightDifference !== 0) return flightDifference;
  const monthDifference = left.competitionMonth.localeCompare(right.competitionMonth);
  if (monthDifference !== 0) return monthDifference;
  const cellSizeDifference = left.cellSize - right.cellSize;
  if (cellSizeDifference !== 0) return cellSizeDifference;
  const xDifference = left.cellX - right.cellX;
  if (xDifference !== 0) return xDifference;
  const yDifference = left.cellY - right.cellY;
  if (yDifference !== 0) return yDifference;
  return left.userId.localeCompare(right.userId);
}

export function arenaLeadershipEventKey(event: ArenaLeadershipClaim, eventType: ArenaLeadershipEventType): string {
  return [
    event.arenaId,
    event.userId,
    eventType,
    event.claimTimestamp.toISOString(),
    event.sourceFlightId,
    event.competitionMonth,
    event.cellSize,
    event.cellX,
    event.cellY,
  ].join(':');
}

/** Replay the rank-one membership transitions from each pilot's first claim of a cell. */
export function replayArenaLeadership(claims: readonly ArenaLeadershipClaim[]): ArenaLeadershipReplayResult {
  const firstClaims = new Map<string, ArenaLeadershipClaim>();
  for (const claim of claims) {
    const key = `${claim.arenaId}:${claim.userId}:${claim.cellSize}:${claim.cellX}:${claim.cellY}`;
    const existing = firstClaims.get(key);
    if (!existing || compareArenaLeadershipClaims(claim, existing) < 0) firstClaims.set(key, claim);
  }
  const orderedClaims = [...firstClaims.values()].sort(compareArenaLeadershipClaims);
  const totals = new Map<string, number>();
  const leaders = new Map<string, ArenaLeadershipCurrentLeader>();
  const endedTenures = new Set<string>();
  const events: ArenaLeadershipReplayEvent[] = [];
  let maximum = 0;
  let leaderIds = new Set<string>();

  for (const claim of orderedClaims) {
    const previousMaximum = maximum;
    const previousLeaders = leaderIds;
    const nextCells = (totals.get(claim.userId) ?? 0) + 1;
    totals.set(claim.userId, nextCells);
    const nextMaximum = Math.max(previousMaximum, nextCells);
    maximum = nextMaximum;
    const nextLeaders = nextCells > previousMaximum
      ? new Set([claim.userId])
      : nextCells === previousMaximum
        ? new Set([...previousLeaders, claim.userId])
        : new Set(previousLeaders);

    for (const userId of [...previousLeaders].sort()) {
      if (nextLeaders.has(userId)) continue;
      const lost: ArenaLeadershipReplayEvent = {
        ...claim,
        userId,
        eventType: 'lost',
        eventKey: arenaLeadershipEventKey({ ...claim, userId }, 'lost'),
      };
      events.push(lost);
      leaders.delete(userId);
      endedTenures.add(userId);
    }

    if (!previousLeaders.has(claim.userId) && nextLeaders.has(claim.userId)) {
      const entryType: 'took' | 'reclaimed' = endedTenures.has(claim.userId) ? 'reclaimed' : 'took';
      const entry: ArenaLeadershipReplayEvent = {
        ...claim,
        eventType: entryType,
        eventKey: arenaLeadershipEventKey(claim, entryType),
      };
      events.push(entry);
      leaders.set(claim.userId, { ...claim, cellsClaimed: nextCells, tookLeadAt: claim.claimTimestamp });
    } else if (nextLeaders.has(claim.userId)) {
      const current = leaders.get(claim.userId);
      if (current) leaders.set(claim.userId, { ...current, cellsClaimed: nextCells });
    }
    leaderIds = nextLeaders;
  }

  const leaderCount = maximum;
  const lowerCounts = [...totals.values()].filter((cells) => cells < leaderCount);
  const nextRankCellCount = lowerCounts.length === 0 ? 0 : Math.max(...lowerCounts);
  return {
    leadingCellCount: leaderCount,
    nextRankCellCount,
    currentLeaders: [...leaders.values()].sort((left, right) => left.userId.localeCompare(right.userId)),
    events,
  };
}
