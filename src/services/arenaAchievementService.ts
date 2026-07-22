import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AchievementKey } from '../domain/achievement/catalog.js';
import { awardAchievement, awardAchievementRecordInTransaction, type AchievementAwardResult, type AchievementRecordResult } from './achievementService.js';
import { arenaCellOwnershipPredicateSql, claimCellCenterSql } from './arenaGeometrySql.js';
import {
  generalCoverageMilestones,
  generalExplorationMilestones,
  launchVisitMilestones,
  regionalMilestones,
} from '../domain/achievement/progress.js';

type ArenaAchievementDatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ArenaAchievementTransaction = Pick<ArenaAchievementDatabaseTransaction, 'execute' | 'insert' | 'select'>;

export type ArenaAchievementEvaluation = {
  newlyEarned: AchievementKey[];
  alreadyEarned: number;
  record: AchievementRecordResult | null;
};

/** Optional historical cutoff used by the one-time Arena achievement backfill. */
export type ArenaAchievementEvaluationInput = {
  userId: string;
  sourceFlightId: string;
  cellSize: number;
  earnedAt: Date;
  /** Completed flights that existed at this point in the user's ordered history. */
  historicalFlightIds?: readonly string[];
};

export type ArenaAchievementSnapshotRow = {
  id: string;
  arenaType: 'launch' | 'general' | 'state' | 'country';
  claimableCellCount: number | string | null;
  claimedCells: number | string;
  visited: boolean;
  firstFromLaunch: boolean;
  tagged: boolean;
};

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function crossedThresholds(count: number, thresholds: readonly number[]): number[] {
  return thresholds.filter((threshold) => count >= threshold);
}

/** Evaluates Arena achievements in a caller-owned transaction after claims exist. */
export async function evaluateArenaAchievementsInTransaction(
  database: ArenaAchievementTransaction,
  input: ArenaAchievementEvaluationInput,
): Promise<ArenaAchievementEvaluation> {
  const historicalIds = input.historicalFlightIds?.map((id) => sql`${id}::uuid`) ?? [];
  const historicalClaimFilter = input.historicalFlightIds
    ? input.historicalFlightIds.length === 0
      ? sql`AND FALSE`
      : sql`AND claims.claim_flight IN (${sql.join(historicalIds, sql`, `)})`
      : sql``;
  const historicalFlightFilter = input.historicalFlightIds
    ? input.historicalFlightIds.length === 0
      ? sql`AND FALSE`
      : sql`AND flight.flight_id IN (${sql.join(historicalIds, sql`, `)})`
    : sql``;
  const rows = await database.execute<ArenaAchievementSnapshotRow>(sql`
    WITH personal_cells AS (
      SELECT DISTINCT claims.x, claims.y
      FROM user_grid_claims claims
      WHERE claims.claim_user = ${input.userId}
        ${historicalClaimFilter}
    ),
    arena_claims AS (
      SELECT arena.id,
             COUNT(DISTINCT (personal_cells.x, personal_cells.y)) FILTER (WHERE personal_cells.x IS NOT NULL AND personal_cells.y IS NOT NULL)::integer AS claimed_cells
      FROM arenas arena
      LEFT JOIN personal_cells ON ${arenaCellOwnershipPredicateSql({ arenaId: sql`arena.id`, arenaType: sql`arena.arena_type`, externalId: sql`arena.external_id`, area: sql`arena.area`, cellCenter: claimCellCenterSql({ x: sql`personal_cells.x`, y: sql`personal_cells.y`, cellSize: sql`${input.cellSize}` }) })}
      GROUP BY arena.id
    ),
    launch_visits AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN flights flight ON flight.user_id = ${input.userId}
        AND (flight.processing_status = 'completed' OR flight.flight_id = ${input.sourceFlightId})
        ${historicalFlightFilter}
        AND flight.launch_latitude IS NOT NULL
        AND flight.launch_longitude IS NOT NULL
        AND ST_Covers(
          arena.area,
          ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
        )
      WHERE arena.arena_type = 'launch'
    ),
    current_tags AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN user_grid_claims claims
        ON claims.claim_user = ${input.userId}
       AND claims.claim_flight = ${input.sourceFlightId}
       AND ST_Covers(
         arena.area,
         ${claimCellCenterSql({ x: sql`claims.x`, y: sql`claims.y`, cellSize: sql`${input.cellSize}` })}
       )
      WHERE arena.arena_type = 'launch'
    ),
    current_origin AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN flights flight ON flight.flight_id = ${input.sourceFlightId}
        AND flight.user_id = ${input.userId}
        AND flight.launch_latitude IS NOT NULL
        AND flight.launch_longitude IS NOT NULL
        AND ST_Covers(
          arena.area,
          ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
        )
      WHERE arena.arena_type = 'launch'
    )
    SELECT arena.id,
           arena.arena_type AS "arenaType",
           CASE WHEN arena.arena_type IN ('launch', 'general') THEN arena.claimable_cell_count ELSE NULL END AS "claimableCellCount",
           COALESCE(arena_claims.claimed_cells, 0)::integer AS "claimedCells",
           (launch_visits.id IS NOT NULL) AS visited,
           (current_origin.id IS NOT NULL) AS "firstFromLaunch",
           (current_tags.id IS NOT NULL) AS tagged
    FROM arenas arena
    LEFT JOIN arena_claims ON arena_claims.id = arena.id
    LEFT JOIN launch_visits ON launch_visits.id = arena.id
    LEFT JOIN current_origin ON current_origin.id = arena.id
    LEFT JOIN current_tags ON current_tags.id = arena.id
  `);

  return awardArenaAchievementsFromSnapshotInTransaction(database, input, rows.rows);
}

/** Applies the Release 2 catalog to an already calculated as-of Arena snapshot. */
export async function awardArenaAchievementsFromSnapshotInTransaction(
  database: ArenaAchievementTransaction,
  input: ArenaAchievementEvaluationInput,
  snapshot: readonly ArenaAchievementSnapshotRow[],
): Promise<ArenaAchievementEvaluation> {
  const newlyEarned: AchievementKey[] = [];
  let alreadyEarned = 0;
  const award = async (key: string, details: Record<string, unknown>, value?: number) => {
    const result: AchievementAwardResult = await awardAchievement(database, {
      userId: input.userId,
      key,
      earnedAt: input.earnedAt,
      sourceFlightId: input.sourceFlightId,
      ...(value === undefined ? {} : { value }),
      details,
    });
    if (result.newlyEarned) newlyEarned.push(result.key);
    else alreadyEarned += 1;
  };

  const launchRows = snapshot.filter((row) => row.arenaType === 'launch');
  const visitedLaunches = launchRows.filter((row) => row.visited).length;
  const firstOriginArena = launchRows.find((row) => row.firstFromLaunch);
  if (firstOriginArena) {
    await award('first_flight_from_launch', { arenaId: firstOriginArena.id, visitedLaunchCount: visitedLaunches });
  }
  for (const threshold of crossedThresholds(visitedLaunches, launchVisitMilestones)) {
    await award(`launches_visited_${threshold}`, { visitedLaunches }, threshold);
  }

  const completeLaunch = launchRows.find((row) => {
    const total = numberOrNull(row.claimableCellCount);
    return total !== null && total > 0 && Number(row.claimedCells) === total;
  });
  if (completeLaunch) await award('complete_a_launch_arena', {
    arenaId: completeLaunch.id,
    claimedCells: Number(completeLaunch.claimedCells),
    totalCells: Number(completeLaunch.claimableCellCount),
  });

  const taggedCount = launchRows.filter((row) => row.tagged).length;
  let record: AchievementRecordResult | null = null;
  if (taggedCount > 0) {
    record = await awardAchievementRecordInTransaction(database, {
      userId: input.userId,
      key: 'most_launches_tagged_one_flight',
      value: taggedCount,
      earnedAt: input.earnedAt,
      sourceFlightId: input.sourceFlightId,
      details: { taggedLaunches: taggedCount },
    });
  }

  const generalRows = snapshot.filter((row) => row.arenaType === 'general');
  const exploredGenerals = generalRows.filter((row) => Number(row.claimedCells) > 0).length;
  if (exploredGenerals > 0) await award('first_cells_in_general_arena', { exploredArenaCount: exploredGenerals });
  for (const threshold of crossedThresholds(exploredGenerals, generalExplorationMilestones)) {
    await award(`general_arenas_explored_${threshold}`, { exploredArenaCount: exploredGenerals }, threshold);
  }
  const coverage = generalRows.some((row) => {
    const total = numberOrNull(row.claimableCellCount);
    return total !== null && total > 0 && Number(row.claimedCells) >= 0;
  })
    ? generalRows.reduce((best, row) => {
      const total = numberOrNull(row.claimableCellCount);
      if (total === null || total <= 0) return best;
      return Math.max(best, Number(row.claimedCells) * 100 / total);
    }, 0)
    : 0;
  for (const threshold of generalCoverageMilestones) {
    const reached = generalRows.some((row) => {
      const total = numberOrNull(row.claimableCellCount);
      return total !== null && total > 0
        && Number(row.claimedCells) * 100 >= threshold * total;
    });
    if (reached) {
      const bestArena = generalRows.find((row) => {
        const total = numberOrNull(row.claimableCellCount);
        return total !== null && total > 0
          && Number(row.claimedCells) * 100 >= threshold * total;
      });
      await award(`general_coverage_${threshold}`, {
        arenaId: bestArena?.id,
        bestCoveragePercentage: coverage,
      }, threshold);
    }
  }

  for (const [type, prefix] of [['state', 'states_flown_in'], ['country', 'countries_flown_in']] as const) {
    const count = snapshot.filter((row) => row.arenaType === type && Number(row.claimedCells) > 0).length;
    for (const threshold of crossedThresholds(count, regionalMilestones)) {
      await award(`${prefix}_${threshold}`, { arenaCount: count }, threshold);
    }
  }
  return { newlyEarned, alreadyEarned, record };
}

export type ArenaAchievementService = {
  evaluateInTransaction: typeof evaluateArenaAchievementsInTransaction;
};

export function createArenaAchievementService(): ArenaAchievementService {
  return { evaluateInTransaction: evaluateArenaAchievementsInTransaction };
}
