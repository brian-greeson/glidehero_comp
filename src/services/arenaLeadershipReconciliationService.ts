import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AchievementKey } from '../domain/achievement/catalog.js';
import {
  arenaLeadershipEventKey,
  compareArenaLeadershipClaims,
  replayArenaLeadership,
  type ArenaLeadershipClaim,
  type ArenaLeadershipCurrentLeader,
  type ArenaLeadershipReplayEvent,
  type ArenaLeadershipReplayResult,
  type EligibleArenaType,
} from '../domain/arena/leadership.js';
import { awardAchievement } from './achievementService.js';
import { arenaCellOwnershipPredicateSql } from './arenaGeometrySql.js';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ArenaLeadershipTransaction = Pick<DatabaseTransaction, 'execute' | 'insert' | 'select'>;

type StoredArena = { arenaId: string; arenaName: string; arenaType: EligibleArenaType };
type StoredClaim = ArenaLeadershipClaim;
type StoredState = {
  arenaId: string;
  leadingCellCount: number;
  nextRankCellCount: number;
  lastReconciliationKey: string | null;
  lastClaimTimestamp: Date | string | null;
  lastClaimSourceFlightId: string | null;
};
type StoredLeader = {
  userId: string;
  cellsClaimed: number;
  tookLeadAt: Date | string;
  sourceFlightId: string;
  cellX: number;
  cellY: number;
  competitionMonth: string;
};

export type ArenaLeadershipReconciliationSummary = {
  arenaId: string;
  arenaType: EligibleArenaType;
  leadingCellCount: number;
  nextRankCellCount: number;
  currentLeaderUserIds: string[];
  eventCount: number;
  reconciliationKey: string;
};

export type ArenaLeadershipReconciliationResult = {
  arenas: ArenaLeadershipReconciliationSummary[];
  eventsBuilt: number;
  achievements: {
    newlyEarned: AchievementKey[];
    alreadyEarned: number;
  };
  /** Qualifying transitions, exposed for deterministic batch backfills. */
  qualifyingEvents?: Array<StoredArena & { event: ArenaLeadershipReplayResult['events'][number] }>;
};

export interface ArenaLeadershipReconciliationService {
  reconcile(input: { arenaIds: string[]; awardAchievements?: boolean }): Promise<ArenaLeadershipReconciliationResult>;
  reconcileInTransaction(
    transaction: ArenaLeadershipTransaction,
    input: { arenaIds: string[]; awardAchievements?: boolean },
  ): Promise<ArenaLeadershipReconciliationResult>;
  applyFlightInTransaction?(
    transaction: ArenaLeadershipTransaction,
    input: { arenaIds: string[]; flightId: string; awardAchievements?: boolean },
  ): Promise<ArenaLeadershipReconciliationResult>;
}

function emptyResult(): ArenaLeadershipReconciliationResult {
  return { arenas: [], eventsBuilt: 0, achievements: { newlyEarned: [], alreadyEarned: 0 }, qualifyingEvents: [] };
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function sameMembers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function reconciliationKey(arenaId: string, claims: readonly ArenaLeadershipClaim[], replay: ArenaLeadershipReplayResult): string {
  const input = [
    arenaId,
    ...claims.map((claim) => [
      claim.userId,
      claim.claimTimestamp.toISOString(),
      claim.sourceFlightId,
      claim.competitionMonth,
      claim.cellX,
      claim.cellY,
    ].join('|')),
    ...replay.events.map((event) => event.eventKey),
  ].join('\n');
  return createHash('sha256').update(input).digest('hex');
}

function incrementalKey(previousKey: string | null, claims: readonly ArenaLeadershipClaim[], events: readonly ArenaLeadershipReplayEvent[]): string {
  return createHash('sha256').update([
    previousKey ?? '',
    ...claims.map((claim) => `${claim.claimTimestamp.toISOString()}|${claim.sourceFlightId}|${claim.cellX}|${claim.cellY}`),
    ...events.map((event) => event.eventKey),
  ].join('\n')).digest('hex');
}

function claimsForArena(rows: StoredClaim[], arenaId: string): ArenaLeadershipClaim[] {
  return rows.filter((row) => row.arenaId === arenaId);
}

function normalizedClaim(claim: StoredClaim): ArenaLeadershipClaim {
  return { ...claim, claimTimestamp: new Date(claim.claimTimestamp) };
}

async function lockArenas(transaction: ArenaLeadershipTransaction, ids: readonly string[]): Promise<void> {
  for (const arenaId of ids) {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${arenaId}::text, 0))`);
  }
}

async function awardEvents(
  transaction: ArenaLeadershipTransaction,
  qualifyingEvents: Array<StoredArena & { event: ArenaLeadershipReplayEvent }>,
  enabled: boolean,
): Promise<{ newlyEarned: AchievementKey[]; alreadyEarned: number }> {
  const newlyEarned: AchievementKey[] = [];
  let alreadyEarned = 0;
  if (!enabled) return { newlyEarned, alreadyEarned };
  for (const { arenaId, arenaName, event } of qualifyingEvents) {
    const key: AchievementKey = event.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena';
    const award = await awardAchievement(transaction, {
      userId: event.userId,
      key,
      earnedAt: event.claimTimestamp,
      sourceFlightId: event.sourceFlightId,
      details: { arenaId, arenaName },
    });
    if (award.newlyEarned) newlyEarned.push(award.key);
    else alreadyEarned += 1;
  }
  return { newlyEarned, alreadyEarned };
}

function sortQualifyingEvents(events: Array<StoredArena & { event: ArenaLeadershipReplayEvent }>): void {
  events.sort((left, right) => {
    const timestampDifference = left.event.claimTimestamp.getTime() - right.event.claimTimestamp.getTime();
    if (timestampDifference !== 0) return timestampDifference;
    const arenaDifference = left.arenaId.localeCompare(right.arenaId);
    if (arenaDifference !== 0) return arenaDifference;
    return left.event.eventKey.localeCompare(right.event.eventKey);
  });
}

export function createArenaLeadershipReconciliationService(database: Database, options: { cellSize: number }): ArenaLeadershipReconciliationService {
  async function reconcileInTransaction(
    transaction: ArenaLeadershipTransaction,
    input: { arenaIds: string[]; awardAchievements?: boolean },
  ): Promise<ArenaLeadershipReconciliationResult> {
    const ids = sortedUnique(input.arenaIds);
    if (ids.length === 0) return emptyResult();
    await lockArenas(transaction, ids);

    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const arenaResult = await transaction.execute<StoredArena>(sql`
      SELECT id AS "arenaId", name AS "arenaName", arena_type AS "arenaType"
      FROM arenas
      WHERE id IN (${idList})
        AND arena_type IN ('general', 'state', 'country')
      ORDER BY id
    `);
    const arenas = arenaResult.rows;
    if (arenas.length === 0) return emptyResult();

    const arenaIdList = sql.join(arenas.map((arena) => sql`${arena.arenaId}`), sql`, `);
    const claimResult = await transaction.execute<StoredClaim>(sql`
      SELECT DISTINCT ON (arena.id, claim.claim_user, claim.x, claim.y)
        arena.id AS "arenaId",
        claim.claim_user AS "userId",
        claim.claim_timestamp AS "claimTimestamp",
        claim.claim_flight AS "sourceFlightId",
        claim.competition_month AS "competitionMonth",
        claim.x AS "cellX",
        claim.y AS "cellY"
      FROM arenas arena
      INNER JOIN competition_grid_claims claim ON ${arenaCellOwnershipPredicateSql({
        arenaId: sql`arena.id`,
        arenaType: sql`arena.arena_type`,
        externalId: sql`arena.external_id`,
        area: sql`arena.area`,
        cellCenter: sql`ST_SetSRID(ST_MakePoint((claim.x + 0.5) * ${options.cellSize}, (claim.y + 0.5) * ${options.cellSize}), 6933)`,
      })}
      WHERE arena.id IN (${arenaIdList})
      ORDER BY
        arena.id,
        claim.claim_user,
        claim.x,
        claim.y,
        claim.claim_timestamp,
        claim.claim_flight,
        claim.competition_month
    `);

    const summaries: ArenaLeadershipReconciliationSummary[] = [];
    const qualifyingEvents: Array<StoredArena & { event: ArenaLeadershipReplayEvent }> = [];
    let eventsBuilt = 0;
    for (const arena of arenas) {
      const claims = claimsForArena(claimResult.rows, arena.arenaId).map(normalizedClaim);
      const replay = replayArenaLeadership(claims);
      const key = reconciliationKey(arena.arenaId, claims, replay);
      const lastClaim = [...claims].sort(compareArenaLeadershipClaims).at(-1);

      await transaction.execute(sql`
        INSERT INTO arena_leadership_states (
          arena_id, arena_type, leading_cell_count, next_rank_cell_count,
          last_reconciled_at, last_reconciliation_key,
          last_claim_timestamp, last_claim_source_flight_id
        ) VALUES (
          ${arena.arenaId}, ${arena.arenaType}, ${replay.leadingCellCount}, ${replay.nextRankCellCount},
          now(), ${key}, ${lastClaim?.claimTimestamp ?? null}, ${lastClaim?.sourceFlightId ?? null}
        )
        ON CONFLICT (arena_id) DO UPDATE SET
          arena_type = EXCLUDED.arena_type,
          leading_cell_count = EXCLUDED.leading_cell_count,
          next_rank_cell_count = EXCLUDED.next_rank_cell_count,
          last_reconciled_at = EXCLUDED.last_reconciled_at,
          last_reconciliation_key = EXCLUDED.last_reconciliation_key,
          last_claim_timestamp = EXCLUDED.last_claim_timestamp,
          last_claim_source_flight_id = EXCLUDED.last_claim_source_flight_id
      `);
      await transaction.execute(sql`DELETE FROM arena_current_leaders WHERE arena_id = ${arena.arenaId}`);
      await transaction.execute(sql`DELETE FROM arena_leadership_events WHERE arena_id = ${arena.arenaId}`);

      if (replay.currentLeaders.length > 0) {
        await transaction.execute(sql`
          INSERT INTO arena_current_leaders (
            arena_id, user_id, cells_claimed, took_lead_at,
            decisive_source_flight_id, decisive_cell_x, decisive_cell_y
          ) VALUES ${sql.join(replay.currentLeaders.map((leader) => sql`(
            ${arena.arenaId}, ${leader.userId}, ${leader.cellsClaimed}, ${leader.tookLeadAt},
            ${leader.sourceFlightId}, ${leader.cellX}, ${leader.cellY}
          )`), sql`, `)}
        `);
      }
      if (replay.events.length > 0) {
        await transaction.execute(sql`
          INSERT INTO arena_leadership_events (
            event_key, arena_id, user_id, event_type, claim_timestamp,
            source_flight_id, cell_x, cell_y
          ) VALUES ${sql.join(replay.events.map((event) => sql`(
            ${event.eventKey}, ${arena.arenaId}, ${event.userId}, ${event.eventType}, ${event.claimTimestamp},
            ${event.sourceFlightId}, ${event.cellX}, ${event.cellY}
          )`), sql`, `)}
        `);
      }
      for (const event of replay.events) {
        if (event.eventType === 'took' || event.eventType === 'reclaimed') qualifyingEvents.push({ ...arena, event });
      }
      eventsBuilt += replay.events.length;
      summaries.push({
        arenaId: arena.arenaId,
        arenaType: arena.arenaType,
        leadingCellCount: replay.leadingCellCount,
        nextRankCellCount: replay.nextRankCellCount,
        currentLeaderUserIds: replay.currentLeaders.map((leader) => leader.userId),
        eventCount: replay.events.length,
        reconciliationKey: key,
      });
    }
    sortQualifyingEvents(qualifyingEvents);
    const achievements = await awardEvents(transaction, qualifyingEvents, input.awardAchievements !== false);
    return {
      arenas: summaries,
      eventsBuilt,
      achievements,
      ...(input.awardAchievements === false ? { qualifyingEvents } : {}),
    };
  }

  async function applyFlightInTransaction(
    transaction: ArenaLeadershipTransaction,
    input: { arenaIds: string[]; flightId: string; awardAchievements?: boolean },
  ): Promise<ArenaLeadershipReconciliationResult> {
    const ids = sortedUnique(input.arenaIds);
    if (ids.length === 0) return emptyResult();
    await lockArenas(transaction, ids);
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const arenaResult = await transaction.execute<StoredArena>(sql`
      SELECT id AS "arenaId", name AS "arenaName", arena_type AS "arenaType"
      FROM arenas
      WHERE id IN (${idList}) AND arena_type IN ('general', 'state', 'country')
      ORDER BY id
    `);
    const arenas = arenaResult.rows;
    if (arenas.length === 0) return emptyResult();

    const stateResult = await transaction.execute<StoredState>(sql`
      SELECT arena_id AS "arenaId", leading_cell_count AS "leadingCellCount",
        next_rank_cell_count AS "nextRankCellCount", last_reconciliation_key AS "lastReconciliationKey",
        last_claim_timestamp AS "lastClaimTimestamp", last_claim_source_flight_id AS "lastClaimSourceFlightId"
      FROM arena_leadership_states
      WHERE arena_id IN (${sql.join(arenas.map((arena) => sql`${arena.arenaId}`), sql`, `)})
    `);
    const stateByArena = new Map(stateResult.rows.map((state) => [state.arenaId, state]));
    const claimResult = await transaction.execute<StoredClaim>(sql`
      WITH flight_claims AS (
        SELECT DISTINCT ON (claim.claim_user, claim.x, claim.y)
          claim.claim_user, claim.claim_timestamp, claim.claim_flight,
          claim.competition_month, claim.x, claim.y
        FROM competition_grid_claims claim
        WHERE claim.claim_flight = ${input.flightId}
        ORDER BY claim.claim_user, claim.x, claim.y,
          claim.claim_timestamp, claim.competition_month
      )
      SELECT arena.id AS "arenaId", claim.claim_user AS "userId",
        claim.claim_timestamp AS "claimTimestamp", claim.claim_flight AS "sourceFlightId",
        claim.competition_month AS "competitionMonth",
        claim.x AS "cellX", claim.y AS "cellY"
      FROM arenas arena
      INNER JOIN flight_claims claim ON ${arenaCellOwnershipPredicateSql({
        arenaId: sql`arena.id`,
        arenaType: sql`arena.arena_type`,
        externalId: sql`arena.external_id`,
        area: sql`arena.area`,
        cellCenter: sql`ST_SetSRID(ST_MakePoint((claim.x + 0.5) * ${options.cellSize}, (claim.y + 0.5) * ${options.cellSize}), 6933)`,
      })}
      WHERE arena.id IN (${sql.join(arenas.map((arena) => sql`${arena.arenaId}`), sql`, `)})
        AND NOT EXISTS (
          SELECT 1
          FROM competition_grid_claims previous
          WHERE previous.claim_user = claim.claim_user
            AND previous.x = claim.x AND previous.y = claim.y
            AND previous.claim_flight <> ${input.flightId}
            AND (
              previous.claim_timestamp < claim.claim_timestamp
              OR (previous.claim_timestamp = claim.claim_timestamp AND previous.claim_flight::text < ${input.flightId})
            )
        )
    `);
    const normalizedClaims = claimResult.rows.map(normalizedClaim);
    const fallbackIds: string[] = [];
    const incrementalArenas: StoredArena[] = [];
    for (const arena of arenas) {
      const state = stateByArena.get(arena.arenaId);
      const claims = claimsForArena(normalizedClaims, arena.arenaId).sort(compareArenaLeadershipClaims);
      if (claims.length === 0) continue;
      const cursorTimestamp = state?.lastClaimTimestamp ? new Date(state.lastClaimTimestamp) : null;
      const cursorFlightId = state?.lastClaimSourceFlightId ?? null;
      const first = claims[0]!;
      const precedesCursor = cursorTimestamp && (
        first.claimTimestamp.getTime() < cursorTimestamp.getTime()
        || (first.claimTimestamp.getTime() === cursorTimestamp.getTime() && first.sourceFlightId <= (cursorFlightId ?? ''))
      );
      if (!state || (state.leadingCellCount > 0 && (!cursorTimestamp || !cursorFlightId)) || precedesCursor) fallbackIds.push(arena.arenaId);
      else incrementalArenas.push(arena);
    }

    const fallback = fallbackIds.length > 0
      ? await reconcileInTransaction(transaction, { arenaIds: fallbackIds, awardAchievements: false })
      : emptyResult();
    const summaries = [...fallback.arenas];
    const qualifyingEvents = [...(fallback.qualifyingEvents ?? [])];
    let eventsBuilt = fallback.eventsBuilt;

    const incrementalUserIds = [...new Set(normalizedClaims
      .filter((claim) => incrementalArenas.some((arena) => arena.arenaId === claim.arenaId))
      .map((claim) => claim.userId))];
    const incrementalTotals = new Map<string, number>();
    if (incrementalArenas.length > 0 && incrementalUserIds.length > 0) {
      const incrementalArenaIds = sql.join(incrementalArenas.map((arena) => sql`${arena.arenaId}`), sql`, `);
      const incrementalUsers = sql.join(incrementalUserIds.map((userId) => sql`${userId}`), sql`, `);
      const totalsResult = await transaction.execute<{ arenaId: string; userId: string; count: number | string }>(sql`
        SELECT arena.id AS "arenaId", claim.claim_user AS "userId", COUNT(DISTINCT (claim.x, claim.y))::integer AS count
        FROM competition_grid_claims claim
        INNER JOIN arenas arena ON arena.id IN (${incrementalArenaIds})
          AND ${arenaCellOwnershipPredicateSql({
            arenaId: sql`arena.id`,
            arenaType: sql`arena.arena_type`,
            externalId: sql`arena.external_id`,
            area: sql`arena.area`,
            cellCenter: sql`ST_SetSRID(ST_MakePoint((claim.x + 0.5) * ${options.cellSize}, (claim.y + 0.5) * ${options.cellSize}), 6933)`,
          })}
        WHERE claim.claim_user IN (${incrementalUsers})
        GROUP BY arena.id, claim.claim_user
      `);
      for (const row of totalsResult.rows) incrementalTotals.set(`${row.arenaId}:${row.userId}`, Number(row.count));
    }

    for (const arena of incrementalArenas) {
      const state = stateByArena.get(arena.arenaId)!;
      const claims = claimsForArena(normalizedClaims, arena.arenaId).sort(compareArenaLeadershipClaims);
      const storedLeaders = await transaction.execute<StoredLeader>(sql`
        SELECT user_id AS "userId", cells_claimed AS "cellsClaimed", took_lead_at AS "tookLeadAt",
          decisive_source_flight_id AS "sourceFlightId",
          decisive_cell_x AS "cellX", decisive_cell_y AS "cellY", ''::text AS "competitionMonth"
        FROM arena_current_leaders WHERE arena_id = ${arena.arenaId}
      `);
      const leaders = new Map<string, ArenaLeadershipCurrentLeader>(storedLeaders.rows.map((leader) => [leader.userId, {
        arenaId: arena.arenaId,
        userId: leader.userId,
        cellsClaimed: Number(leader.cellsClaimed),
        tookLeadAt: new Date(leader.tookLeadAt),
        claimTimestamp: new Date(leader.tookLeadAt),
        sourceFlightId: leader.sourceFlightId,
        competitionMonth: leader.competitionMonth,
        cellX: leader.cellX,
        cellY: leader.cellY,
      }]));
      const initialLeaderIds = new Set(leaders.keys());
      let leaderIds = new Set(initialLeaderIds);
      let maximum = Number(state.leadingCellCount);
      const totals = new Map<string, number>();
      const newCounts = new Map<string, number>();
      for (const claim of claims) newCounts.set(claim.userId, (newCounts.get(claim.userId) ?? 0) + 1);
      for (const [userId, added] of newCounts) {
        totals.set(userId, (incrementalTotals.get(`${arena.arenaId}:${userId}`) ?? 0) - added);
      }
      const endedTenures = new Map<string, boolean>();
      const events: ArenaLeadershipReplayEvent[] = [];
      for (const claim of claims) {
        const previousLeaders = leaderIds;
        const previousMaximum = maximum;
        const nextCells = (totals.get(claim.userId) ?? 0) + 1;
        totals.set(claim.userId, nextCells);
        maximum = Math.max(previousMaximum, nextCells);
        const nextLeaders = nextCells > previousMaximum
          ? new Set([claim.userId])
          : nextCells === previousMaximum
            ? new Set([...previousLeaders, claim.userId])
            : new Set(previousLeaders);
        for (const userId of [...previousLeaders].sort()) {
          if (nextLeaders.has(userId)) continue;
          const lostClaim = { ...claim, userId };
          events.push({ ...lostClaim, eventType: 'lost', eventKey: arenaLeadershipEventKey(lostClaim, 'lost') });
          leaders.delete(userId);
          endedTenures.set(userId, true);
        }
        if (!previousLeaders.has(claim.userId) && nextLeaders.has(claim.userId)) {
          if (!endedTenures.has(claim.userId)) {
            const ended = await transaction.execute<{ ended: boolean }>(sql`
              SELECT EXISTS (
                SELECT 1 FROM arena_leadership_events
                WHERE arena_id = ${arena.arenaId} AND user_id = ${claim.userId} AND event_type = 'lost'
              ) AS ended
            `);
            endedTenures.set(claim.userId, Boolean(ended.rows[0]?.ended));
          }
          const eventType = endedTenures.get(claim.userId) ? 'reclaimed' : 'took';
          events.push({ ...claim, eventType, eventKey: arenaLeadershipEventKey(claim, eventType) });
          leaders.set(claim.userId, { ...claim, cellsClaimed: nextCells, tookLeadAt: claim.claimTimestamp });
        } else if (nextLeaders.has(claim.userId)) {
          const current = leaders.get(claim.userId);
          if (current) leaders.set(claim.userId, { ...current, cellsClaimed: nextCells });
        }
        leaderIds = nextLeaders;
      }

      let nextRankCellCount = Number(state.nextRankCellCount);
      if (!sameMembers(initialLeaderIds, leaderIds)) {
        const rankResult = await transaction.execute<{ count: number | string }>(sql`
          WITH pilot_cells AS (
            SELECT DISTINCT claim.claim_user, claim.x, claim.y
            FROM competition_grid_claims claim
            INNER JOIN arenas arena ON arena.id = ${arena.arenaId}
              AND ${arenaCellOwnershipPredicateSql({
                arenaId: sql`arena.id`,
                arenaType: sql`arena.arena_type`,
                externalId: sql`arena.external_id`,
                area: sql`arena.area`,
                cellCenter: sql`ST_SetSRID(ST_MakePoint((claim.x + 0.5) * ${options.cellSize}, (claim.y + 0.5) * ${options.cellSize}), 6933)`,
              })}
            WHERE TRUE
          ), totals AS (
            SELECT claim_user, COUNT(*)::integer AS cells FROM pilot_cells GROUP BY claim_user
          )
          SELECT COALESCE(MAX(cells) FILTER (WHERE cells < ${maximum}), 0)::integer AS count FROM totals
        `);
        nextRankCellCount = Number(rankResult.rows[0]?.count ?? 0);
      } else {
        for (const [userId, total] of totals) {
          if (!leaderIds.has(userId)) nextRankCellCount = Math.max(nextRankCellCount, total);
        }
      }
      const key = incrementalKey(state.lastReconciliationKey, claims, events);
      const lastClaim = claims.at(-1)!;
      await transaction.execute(sql`
        UPDATE arena_leadership_states SET
          leading_cell_count = ${maximum}, next_rank_cell_count = ${nextRankCellCount},
          last_reconciled_at = now(), last_reconciliation_key = ${key},
          last_claim_timestamp = ${lastClaim.claimTimestamp}, last_claim_source_flight_id = ${lastClaim.sourceFlightId}
        WHERE arena_id = ${arena.arenaId}
      `);
      await transaction.execute(sql`DELETE FROM arena_current_leaders WHERE arena_id = ${arena.arenaId}`);
      if (leaders.size > 0) {
        await transaction.execute(sql`
          INSERT INTO arena_current_leaders (
            arena_id, user_id, cells_claimed, took_lead_at,
            decisive_source_flight_id, decisive_cell_x, decisive_cell_y
          ) VALUES ${sql.join([...leaders.values()].map((leader) => sql`(
            ${arena.arenaId}, ${leader.userId}, ${leader.cellsClaimed}, ${leader.tookLeadAt},
            ${leader.sourceFlightId}, ${leader.cellX}, ${leader.cellY}
          )`), sql`, `)}
        `);
      }
      if (events.length > 0) {
        await transaction.execute(sql`
          INSERT INTO arena_leadership_events (
            event_key, arena_id, user_id, event_type, claim_timestamp,
            source_flight_id, cell_x, cell_y
          ) VALUES ${sql.join(events.map((event) => sql`(
            ${event.eventKey}, ${arena.arenaId}, ${event.userId}, ${event.eventType}, ${event.claimTimestamp},
            ${event.sourceFlightId}, ${event.cellX}, ${event.cellY}
          )`), sql`, `)} ON CONFLICT (event_key) DO NOTHING
        `);
      }
      const arenaQualifying = events
        .filter((event) => event.eventType === 'took' || event.eventType === 'reclaimed')
        .map((event) => ({ ...arena, event }));
      qualifyingEvents.push(...arenaQualifying);
      eventsBuilt += events.length;
      summaries.push({
        arenaId: arena.arenaId,
        arenaType: arena.arenaType,
        leadingCellCount: maximum,
        nextRankCellCount,
        currentLeaderUserIds: [...leaders.keys()].sort(),
        eventCount: events.length,
        reconciliationKey: key,
      });
    }
    sortQualifyingEvents(qualifyingEvents);
    const achievements = await awardEvents(transaction, qualifyingEvents, input.awardAchievements !== false);
    summaries.sort((left, right) => left.arenaId.localeCompare(right.arenaId));
    return {
      arenas: summaries,
      eventsBuilt,
      achievements,
      ...(input.awardAchievements === false ? { qualifyingEvents } : {}),
    };
  }

  return {
    reconcileInTransaction,
    applyFlightInTransaction,
    reconcile(input) {
      return database.transaction((transaction) => reconcileInTransaction(transaction, input));
    },
  };
}
