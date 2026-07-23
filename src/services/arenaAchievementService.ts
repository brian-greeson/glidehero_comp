import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { AchievementKey } from '../domain/achievement/catalog.js';
import { awardAchievementsInBatch, awardAchievementRecordInTransaction, type AchievementRecordResult } from './achievementService.js';
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
  /** Raw Arena facts used by the persisted progress projection. */
  snapshot?: ArenaAchievementSnapshot;
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
  name?: string | null;
  sourceId?: string | null;
  claimableCellCount: number | string | null;
  claimedCells: number | string;
  visited: boolean;
  firstFromLaunch: boolean;
  tagged: boolean;
};

export type ArenaAchievementSnapshot = {
  rows: readonly ArenaAchievementSnapshotRow[];
  lifetimeUniqueCellCount: number;
};

type ArenaAchievementSnapshotQueryRow = ArenaAchievementSnapshotRow & {
  lifetimeUniqueCellCount: number | string;
};

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function crossedThresholds(count: number, thresholds: readonly number[]): number[] {
  return thresholds.filter((threshold) => count >= threshold);
}

type ArenaOrdinaryCandidate = {
  key: string;
  details: Record<string, unknown>;
  value?: number;
};

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function completeLaunch(rows: readonly ArenaAchievementSnapshotRow[]): ArenaAchievementSnapshotRow | undefined {
  return byId(rows.filter((row) => {
    const total = numberOrNull(row.claimableCellCount);
    return total !== null && total > 0 && Number(row.claimedCells) === total;
  }))[0];
}

function generalCoverage(rows: readonly ArenaAchievementSnapshotRow[]): number {
  return rows.reduce((best, row) => {
    const total = numberOrNull(row.claimableCellCount);
    if (total === null || total <= 0) return best;
    return Math.max(best, Number(row.claimedCells) * 100 / total);
  }, 0);
}

function bestCoverageArena(rows: readonly ArenaAchievementSnapshotRow[], threshold: number): ArenaAchievementSnapshotRow | undefined {
  return byId(rows.filter((row) => {
    const total = numberOrNull(row.claimableCellCount);
    return total !== null && total > 0 && Number(row.claimedCells) * 100 >= threshold * total;
  }))[0];
}

function ordinaryCandidates(
  snapshot: readonly ArenaAchievementSnapshotRow[],
  before?: readonly ArenaAchievementSnapshotRow[],
): ArenaOrdinaryCandidate[] {
  const launchRows = byId(snapshot.filter((row) => row.arenaType === 'launch'));
  const beforeLaunchRows = before ? before.filter((row) => row.arenaType === 'launch') : [];
  const visitedLaunches = launchRows.filter((row) => row.visited).length;
  const beforeVisitedLaunches = beforeLaunchRows.filter((row) => row.visited).length;
  const firstOriginArena = launchRows.find((row) => row.firstFromLaunch);
  const firstOriginCrossed = firstOriginArena && (!before || beforeVisitedLaunches === 0);
  const candidates: ArenaOrdinaryCandidate[] = [];
  if (firstOriginCrossed) {
    candidates.push({ key: 'first_flight_from_launch', details: { arenaId: firstOriginArena.id, visitedLaunchCount: visitedLaunches } });
  }
  for (const threshold of crossedThresholds(visitedLaunches, launchVisitMilestones)) {
    if (!before || beforeVisitedLaunches < threshold) candidates.push({ key: `launches_visited_${threshold}`, details: { visitedLaunches }, value: threshold });
  }

  const completed = completeLaunch(launchRows);
  const beforeCompleted = completeLaunch(beforeLaunchRows);
  if (completed && (!before || !beforeCompleted)) {
    candidates.push({ key: 'complete_a_launch_arena', details: {
      arenaId: completed.id,
      claimedCells: Number(completed.claimedCells),
      totalCells: Number(completed.claimableCellCount),
    } });
  }

  const generalRows = byId(snapshot.filter((row) => row.arenaType === 'general'));
  const beforeGeneralRows = before ? before.filter((row) => row.arenaType === 'general') : [];
  const exploredGenerals = generalRows.filter((row) => Number(row.claimedCells) > 0).length;
  const beforeExploredGenerals = beforeGeneralRows.filter((row) => Number(row.claimedCells) > 0).length;
  if (exploredGenerals > 0 && (!before || beforeExploredGenerals === 0)) candidates.push({ key: 'first_cells_in_general_arena', details: { exploredArenaCount: exploredGenerals } });
  for (const threshold of crossedThresholds(exploredGenerals, generalExplorationMilestones)) {
    if (!before || beforeExploredGenerals < threshold) candidates.push({ key: `general_arenas_explored_${threshold}`, details: { exploredArenaCount: exploredGenerals }, value: threshold });
  }

  const coverage = generalCoverage(generalRows);
  const beforeCoverage = generalCoverage(beforeGeneralRows);
  for (const threshold of generalCoverageMilestones) {
    if ((!before || beforeCoverage < threshold) && coverage >= threshold) {
      const bestArena = bestCoverageArena(generalRows, threshold);
      candidates.push({ key: `general_coverage_${threshold}`, details: { arenaId: bestArena?.id, bestCoveragePercentage: coverage }, value: threshold });
    }
  }

  for (const [type, prefix] of [['state', 'states_flown_in'], ['country', 'countries_flown_in']] as const) {
    const count = snapshot.filter((row) => row.arenaType === type && Number(row.claimedCells) > 0).length;
    const beforeCount = before ? before.filter((row) => row.arenaType === type && Number(row.claimedCells) > 0).length : 0;
    for (const threshold of crossedThresholds(count, regionalMilestones)) {
      if (!before || beforeCount < threshold) candidates.push({ key: `${prefix}_${threshold}`, details: { arenaCount: count }, value: threshold });
    }
  }
  return candidates;
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
  const rows = await database.execute<ArenaAchievementSnapshotQueryRow>(sql`
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
    personal_cell_count AS (
      SELECT COUNT(*)::integer AS count
      FROM personal_cells
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
           arena.name,
           arena.source_id AS "sourceId",
           arena.arena_type AS "arenaType",
           CASE WHEN arena.arena_type IN ('launch', 'general') THEN arena.claimable_cell_count ELSE NULL END AS "claimableCellCount",
           COALESCE(arena_claims.claimed_cells, 0)::integer AS "claimedCells",
           (launch_visits.id IS NOT NULL) AS visited,
           (current_origin.id IS NOT NULL) AS "firstFromLaunch",
           (current_tags.id IS NOT NULL) AS tagged,
           personal_cell_count.count AS "lifetimeUniqueCellCount"
    FROM arenas arena
    LEFT JOIN arena_claims ON arena_claims.id = arena.id
    LEFT JOIN launch_visits ON launch_visits.id = arena.id
    LEFT JOIN current_origin ON current_origin.id = arena.id
    LEFT JOIN current_tags ON current_tags.id = arena.id
    CROSS JOIN personal_cell_count
  `);

  let lifetimeUniqueCellCount = Number(rows.rows[0]?.lifetimeUniqueCellCount ?? 0);
  // The Arena catalog can legitimately be empty; in that case the final Arena
  // join has no row from which to carry the scalar count.
  if (rows.rows.length === 0) {
    const count = await database.execute<{ count: number | string }>(sql`
      SELECT COUNT(DISTINCT (claims.x, claims.y))::integer AS count
      FROM user_grid_claims claims
      WHERE claims.claim_user = ${input.userId}
        ${historicalClaimFilter}
    `);
    lifetimeUniqueCellCount = Number(count.rows[0]?.count ?? 0);
  }
  const snapshot: ArenaAchievementSnapshot = { rows: rows.rows, lifetimeUniqueCellCount };
  const evaluation = await awardArenaAchievementsFromSnapshotInTransaction(database, input, snapshot.rows);
  return { ...evaluation, snapshot };
}

/** Applies the Release 2 catalog to an already calculated as-of Arena snapshot. */
export async function awardArenaAchievementsFromSnapshotInTransaction(
  database: ArenaAchievementTransaction,
  input: ArenaAchievementEvaluationInput,
  snapshot: readonly ArenaAchievementSnapshotRow[],
): Promise<ArenaAchievementEvaluation> {
  const ordinary = await awardAchievementsInBatch(database, ordinaryCandidates(snapshot).map((candidate) => ({
    userId: input.userId,
    key: candidate.key,
    earnedAt: input.earnedAt,
    sourceFlightId: input.sourceFlightId,
    ...(candidate.value === undefined ? {} : { value: candidate.value }),
    details: candidate.details,
  })));
  const launchRows = snapshot.filter((row) => row.arenaType === 'launch');
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
  return { newlyEarned: ordinary.newlyEarned, alreadyEarned: ordinary.alreadyEarned, record };
}

/** Persist only ordinary achievements crossed by this flight's Arena transition. */
export async function evaluateArenaAchievementTransitionInTransaction(
  database: ArenaAchievementTransaction,
  input: ArenaAchievementEvaluationInput,
  before: ArenaAchievementSnapshot,
  after: ArenaAchievementSnapshot,
): Promise<ArenaAchievementEvaluation> {
  const ordinary = await awardAchievementsInBatch(database, ordinaryCandidates(after.rows, before.rows).map((candidate) => ({
    userId: input.userId,
    key: candidate.key,
    earnedAt: input.earnedAt,
    sourceFlightId: input.sourceFlightId,
    ...(candidate.value === undefined ? {} : { value: candidate.value }),
    details: candidate.details,
  })));
  const taggedCount = after.rows.filter((row) => row.arenaType === 'launch' && row.tagged).length;
  const record = taggedCount > 0
    ? await awardAchievementRecordInTransaction(database, {
      userId: input.userId,
      key: 'most_launches_tagged_one_flight',
      value: taggedCount,
      earnedAt: input.earnedAt,
      sourceFlightId: input.sourceFlightId,
      details: { taggedLaunches: taggedCount },
    })
    : null;
  return { newlyEarned: ordinary.newlyEarned, alreadyEarned: ordinary.alreadyEarned, record, snapshot: after };
}

// Plural alias follows the existing evaluator's public naming convention.
export const evaluateArenaAchievementsTransitionInTransaction = evaluateArenaAchievementTransitionInTransaction;

export type ArenaAchievementService = {
  evaluateInTransaction: typeof evaluateArenaAchievementsInTransaction;
  evaluateTransitionInTransaction: typeof evaluateArenaAchievementTransitionInTransaction;
};

export function createArenaAchievementService(): ArenaAchievementService {
  return {
    evaluateInTransaction: evaluateArenaAchievementsInTransaction,
    evaluateTransitionInTransaction: evaluateArenaAchievementTransitionInTransaction,
  };
}
