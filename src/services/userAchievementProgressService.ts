import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { userAchievementProgress } from '../db/schema.js';
import type { ArenaAchievementSnapshot } from './arenaAchievementService.js';
import { arenaCellOwnershipPredicateSql, claimCellCenterSql } from './arenaGeometrySql.js';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The persisted, presentation-independent values used to build achievement cards. */
export type UserAchievementProgress = {
  userId: string;
  lifetimeUniqueCellCount: number;
  launchArenasVisited: number;
  generalArenasExplored: number;
  statesFlownIn: number;
  countriesFlownIn: number;
  bestGeneralArenaId: string | null;
  bestGeneralClaimedCellCount: number;
  bestGeneralClaimableCellCount: number;
  projectionVersion: number;
  updatedAt: Date;
};

export type UserAchievementProgressTransaction = Pick<DatabaseTransaction, 'execute' | 'insert' | 'select'>;

export type UserAchievementProgressSnapshot = Omit<UserAchievementProgress, 'userId' | 'projectionVersion' | 'updatedAt'>;

const EMPTY_PROGRESS: UserAchievementProgressSnapshot = {
  lifetimeUniqueCellCount: 0,
  launchArenasVisited: 0,
  generalArenasExplored: 0,
  statesFlownIn: 0,
  countriesFlownIn: 0,
  bestGeneralArenaId: null,
  bestGeneralClaimedCellCount: 0,
  bestGeneralClaimableCellCount: 0,
};

type StoredProgress = {
  userId: string;
  lifetimeUniqueCellCount: number | string;
  launchArenasVisited: number | string;
  generalArenasExplored: number | string;
  statesFlownIn: number | string;
  countriesFlownIn: number | string;
  bestGeneralArenaId: string | null;
  bestGeneralClaimedCellCount: number | string;
  bestGeneralClaimableCellCount: number | string;
  projectionVersion: number | string;
  updatedAt: Date | string;
};

export type UserAchievementProgressCalculation = Omit<StoredProgress, 'userId' | 'projectionVersion' | 'updatedAt'>;

function snapshotFromArenaFacts(snapshot: ArenaAchievementSnapshot): UserAchievementProgressSnapshot {
  const rows = snapshot.rows;
  const launchArenasVisited = rows.filter((row) => row.arenaType === 'launch' && row.visited).length;
  const generalArenasExplored = rows.filter((row) => row.arenaType === 'general' && Number(row.claimedCells) > 0).length;
  const statesFlownIn = rows.filter((row) => row.arenaType === 'state' && Number(row.claimedCells) > 0).length;
  const countriesFlownIn = rows.filter((row) => row.arenaType === 'country' && Number(row.claimedCells) > 0).length;
  const best = [...rows]
    .filter((row) => row.arenaType === 'general' && Number(row.claimedCells) > 0 && Number(row.claimableCellCount) > 0)
    .sort((left, right) => {
      const leftTotal = Number(left.claimableCellCount);
      const rightTotal = Number(right.claimableCellCount);
      const crossDifference = Number(right.claimedCells) * leftTotal - Number(left.claimedCells) * rightTotal;
      if (crossDifference !== 0) return crossDifference > 0 ? 1 : -1;
      const name = (left.name ?? '').toLocaleLowerCase().localeCompare((right.name ?? '').toLocaleLowerCase());
      if (name !== 0) return name;
      const leftSource = Number(left.sourceId ?? 0);
      const rightSource = Number(right.sourceId ?? 0);
      if (Number.isSafeInteger(leftSource) && Number.isSafeInteger(rightSource) && leftSource !== rightSource) {
        return leftSource - rightSource;
      }
      const source = String(left.sourceId ?? '').localeCompare(String(right.sourceId ?? ''));
      if (source !== 0) return source;
      return left.id.localeCompare(right.id);
    })[0];
  return {
    lifetimeUniqueCellCount: snapshot.lifetimeUniqueCellCount,
    launchArenasVisited,
    generalArenasExplored,
    statesFlownIn,
    countriesFlownIn,
    bestGeneralArenaId: best?.id ?? null,
    bestGeneralClaimedCellCount: best ? Number(best.claimedCells) : 0,
    bestGeneralClaimableCellCount: best ? Number(best.claimableCellCount) : 0,
  };
}

function integer(value: number | string | null | undefined, field: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`User achievement progress has an invalid ${field}.`);
  return parsed;
}

function mapProgress(row: StoredProgress): UserAchievementProgress {
  const projectionVersion = integer(row.projectionVersion, 'projection version');
  if (projectionVersion < 1) throw new Error('User achievement progress has an invalid projection version.');
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) throw new Error('User achievement progress has an invalid updated timestamp.');
  return {
    userId: row.userId,
    lifetimeUniqueCellCount: integer(row.lifetimeUniqueCellCount, 'lifetime unique-cell count'),
    launchArenasVisited: integer(row.launchArenasVisited, 'launch-Arena count'),
    generalArenasExplored: integer(row.generalArenasExplored, 'General-Arena count'),
    statesFlownIn: integer(row.statesFlownIn, 'State count'),
    countriesFlownIn: integer(row.countriesFlownIn, 'Country count'),
    bestGeneralArenaId: row.bestGeneralArenaId,
    bestGeneralClaimedCellCount: integer(row.bestGeneralClaimedCellCount, 'best General claimed-cell count'),
    bestGeneralClaimableCellCount: integer(row.bestGeneralClaimableCellCount, 'best General claimable-cell count'),
    projectionVersion,
    updatedAt,
  };
}

/** Convert a calculation result into the values persisted by the projection. */
export function snapshotToProjection(snapshot: UserAchievementProgressCalculation): UserAchievementProgressSnapshot {
  return {
    lifetimeUniqueCellCount: integer(snapshot.lifetimeUniqueCellCount, 'lifetime unique-cell count'),
    launchArenasVisited: integer(snapshot.launchArenasVisited, 'launch-Arena count'),
    generalArenasExplored: integer(snapshot.generalArenasExplored, 'General-Arena count'),
    statesFlownIn: integer(snapshot.statesFlownIn, 'State count'),
    countriesFlownIn: integer(snapshot.countriesFlownIn, 'Country count'),
    bestGeneralArenaId: snapshot.bestGeneralArenaId,
    bestGeneralClaimedCellCount: integer(snapshot.bestGeneralClaimedCellCount, 'best General claimed-cell count'),
    bestGeneralClaimableCellCount: integer(snapshot.bestGeneralClaimableCellCount, 'best General claimable-cell count'),
  };
}

async function calculateWith(database: Pick<Database, 'execute'>, options: { cellSize: number }, userId: string): Promise<UserAchievementProgressSnapshot> {
  const result = await database.execute<UserAchievementProgressCalculation>(sql`
    WITH arena_cell_counts AS (
      SELECT arena.id, arena.source_id, arena.name, arena.arena_type,
             CASE WHEN arena.arena_type = 'general' THEN arena.claimable_cell_count ELSE NULL END AS claimable_cell_count,
             COALESCE(personal_cells.claimed_cells, 0)::integer AS claimed_cells
      FROM arenas arena
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT (claims.x, claims.y))::integer AS claimed_cells
        FROM user_grid_claims claims
        WHERE claims.claim_user = ${userId}
          AND claims.x BETWEEN FLOOR(ST_XMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_XMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND claims.y BETWEEN FLOOR(ST_YMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_YMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND ${arenaCellOwnershipPredicateSql({ arenaId: sql`arena.id`, arenaType: sql`arena.arena_type`, externalId: sql`arena.external_id`, area: sql`arena.area`, cellCenter: claimCellCenterSql({ x: sql`claims.x`, y: sql`claims.y`, cellSize: sql`${options.cellSize}` }) })}
      ) personal_cells ON TRUE
      WHERE arena.arena_type IN ('general', 'state', 'country')
    ), launch_visits AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN flights flight
        ON flight.user_id = ${userId}
       AND flight.processing_status = 'completed'
       AND flight.launch_latitude IS NOT NULL
       AND flight.launch_longitude IS NOT NULL
       AND ST_Covers(
         arena.area,
         ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
       )
      WHERE arena.arena_type = 'launch'
    ), best_general AS (
      SELECT id, claimed_cells, claimable_cell_count
      FROM arena_cell_counts
      WHERE arena_type = 'general'
        AND claimed_cells > 0
        AND claimable_cell_count > 0
      ORDER BY claimed_cells::numeric / claimable_cell_count DESC, lower(name), source_id, id
      LIMIT 1
    ), totals AS (
      SELECT
        (SELECT COUNT(DISTINCT (claims.x, claims.y))::integer FROM user_grid_claims claims WHERE claims.claim_user = ${userId}) AS lifetime_unique_cell_count,
        (SELECT COUNT(*)::integer FROM launch_visits) AS launch_arenas_visited,
        (SELECT COUNT(*)::integer FROM arena_cell_counts WHERE arena_type = 'general' AND claimed_cells > 0) AS general_arenas_explored,
        (SELECT COUNT(*)::integer FROM arena_cell_counts WHERE arena_type = 'state' AND claimed_cells > 0) AS states_flown_in,
        (SELECT COUNT(*)::integer FROM arena_cell_counts WHERE arena_type = 'country' AND claimed_cells > 0) AS countries_flown_in,
        (SELECT id FROM best_general) AS best_general_arena_id,
        COALESCE((SELECT claimed_cells FROM best_general), 0)::integer AS best_general_claimed_cell_count,
        COALESCE((SELECT claimable_cell_count FROM best_general), 0)::integer AS best_general_claimable_cell_count
    )
    SELECT
      lifetime_unique_cell_count AS "lifetimeUniqueCellCount",
      launch_arenas_visited AS "launchArenasVisited",
      general_arenas_explored AS "generalArenasExplored",
      states_flown_in AS "statesFlownIn",
      countries_flown_in AS "countriesFlownIn",
      best_general_arena_id AS "bestGeneralArenaId",
      best_general_claimed_cell_count AS "bestGeneralClaimedCellCount",
      best_general_claimable_cell_count AS "bestGeneralClaimableCellCount"
    FROM totals
  `);
  return snapshotToProjection(result.rows[0] ?? {
    lifetimeUniqueCellCount: 0,
    launchArenasVisited: 0,
    generalArenasExplored: 0,
    statesFlownIn: 0,
    countriesFlownIn: 0,
    bestGeneralArenaId: null,
    bestGeneralClaimedCellCount: 0,
    bestGeneralClaimableCellCount: 0,
  });
}

export function createUserAchievementProgressService(database: Pick<Database, 'execute' | 'select'>, options: { cellSize: number }) {
  async function get(userId: string): Promise<UserAchievementProgress | null> {
    const [row] = await database.select({
      userId: userAchievementProgress.userId,
      lifetimeUniqueCellCount: userAchievementProgress.lifetimeUniqueCellCount,
      launchArenasVisited: userAchievementProgress.launchArenasVisited,
      generalArenasExplored: userAchievementProgress.generalArenasExplored,
      statesFlownIn: userAchievementProgress.statesFlownIn,
      countriesFlownIn: userAchievementProgress.countriesFlownIn,
      bestGeneralArenaId: userAchievementProgress.bestGeneralArenaId,
      bestGeneralClaimedCellCount: userAchievementProgress.bestGeneralClaimedCellCount,
      bestGeneralClaimableCellCount: userAchievementProgress.bestGeneralClaimableCellCount,
      projectionVersion: userAchievementProgress.projectionVersion,
      updatedAt: userAchievementProgress.updatedAt,
    }).from(userAchievementProgress).where(eq(userAchievementProgress.userId, userId)).limit(1);
    return row ? mapProgress(row) : null;
  }

  async function upsertInTransaction(transaction: UserAchievementProgressTransaction, userId: string, snapshot: UserAchievementProgressSnapshot): Promise<UserAchievementProgress> {
    const values = snapshotToProjection(snapshot);
    const updatedAt = new Date();
    const [row] = await transaction.insert(userAchievementProgress).values({
      userId,
      ...values,
      updatedAt,
    }).onConflictDoUpdate({
      target: userAchievementProgress.userId,
      set: { ...values, updatedAt },
    }).returning({
      userId: userAchievementProgress.userId,
      lifetimeUniqueCellCount: userAchievementProgress.lifetimeUniqueCellCount,
      launchArenasVisited: userAchievementProgress.launchArenasVisited,
      generalArenasExplored: userAchievementProgress.generalArenasExplored,
      statesFlownIn: userAchievementProgress.statesFlownIn,
      countriesFlownIn: userAchievementProgress.countriesFlownIn,
      bestGeneralArenaId: userAchievementProgress.bestGeneralArenaId,
      bestGeneralClaimedCellCount: userAchievementProgress.bestGeneralClaimedCellCount,
      bestGeneralClaimableCellCount: userAchievementProgress.bestGeneralClaimableCellCount,
      projectionVersion: userAchievementProgress.projectionVersion,
      updatedAt: userAchievementProgress.updatedAt,
    });
    if (!row) throw new Error('Failed to upsert user achievement progress.');
    return mapProgress(row);
  }

  /** Ensure a newly-created pilot has a transactionally-owned zero projection row. */
  function initializeInTransaction(transaction: UserAchievementProgressTransaction, userId: string): Promise<UserAchievementProgress> {
    return upsertInTransaction(transaction, userId, EMPTY_PROGRESS);
  }

  /** Find pilots whose current claims or completed-flight origins are covered by Arenas. */
  async function findUsersAffectedByArenasInTransaction(
    transaction: UserAchievementProgressTransaction,
    arenaIds: readonly string[],
  ): Promise<string[]> {
    const ids = [...new Set(arenaIds)].sort();
    if (ids.length === 0) return [];
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const result = await transaction.execute<{ userId: string }>(sql`
      SELECT DISTINCT user_id AS "userId"
      FROM (
        SELECT claims.claim_user AS user_id
        FROM user_grid_claims claims
        INNER JOIN arenas arena ON arena.id IN (${idList})
          AND arena.arena_type IN ('general', 'state', 'country')
          AND claims.x BETWEEN FLOOR(ST_XMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_XMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND claims.y BETWEEN FLOOR(ST_YMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_YMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND ${arenaCellOwnershipPredicateSql({
            arenaId: sql`arena.id`, arenaType: sql`arena.arena_type`, externalId: sql`arena.external_id`,
            area: sql`arena.area`, cellCenter: claimCellCenterSql({ x: sql`claims.x`, y: sql`claims.y`, cellSize: sql`${options.cellSize}` }),
          })}
        UNION
        SELECT flight.user_id
        FROM flights flight
        INNER JOIN arenas arena ON arena.id IN (${idList})
          AND arena.arena_type = 'launch'
          AND flight.processing_status = 'completed'
          AND flight.launch_latitude IS NOT NULL
          AND flight.launch_longitude IS NOT NULL
          AND ST_Covers(arena.area, ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933))
      ) affected
      ORDER BY user_id
    `);
    return result.rows.map((row) => row.userId);
  }

  /** Rebuild affected pilots in deterministic order while holding their transaction locks. */
  async function rebuildUsersInTransaction(
    transaction: UserAchievementProgressTransaction,
    userIds: readonly string[],
  ): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))
      `);
      const snapshot = await calculateWith(transaction, options, userId);
      await upsertInTransaction(transaction, userId, snapshot);
    }
  }

  async function rebuildAllInTransaction(transaction: UserAchievementProgressTransaction): Promise<void> {
    const result = await transaction.execute<{ userId: string }>(sql`
      SELECT user_id AS "userId" FROM users ORDER BY user_id
    `);
    await rebuildUsersInTransaction(transaction, result.rows.map((row) => row.userId));
  }

  return {
    get,
    calculate: (userId: string) => calculateWith(database, options, userId),
    upsertInTransaction,
    initializeInTransaction,
    upsertFromArenaSnapshotInTransaction(transaction: UserAchievementProgressTransaction, userId: string, snapshot: ArenaAchievementSnapshot) {
      return upsertInTransaction(transaction, userId, snapshotFromArenaFacts(snapshot));
    },
    async rebuildInTransaction(transaction: UserAchievementProgressTransaction, userId: string) {
      const snapshot = await calculateWith(transaction, options, userId);
      return upsertInTransaction(transaction, userId, snapshot);
    },
    findUsersAffectedByArenasInTransaction,
    rebuildUsersInTransaction,
    rebuildAllInTransaction,
  };
}

export type UserAchievementProgressService = ReturnType<typeof createUserAchievementProgressService>;
