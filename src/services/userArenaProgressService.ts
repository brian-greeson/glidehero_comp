import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { ArenaAchievementSnapshot, ArenaAchievementSnapshotRow } from './arenaAchievementService.js';
import { arenaCellOwnershipPredicateSql, claimCellCenterSql } from './arenaGeometrySql.js';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type UserArenaProgressTransaction = Pick<DatabaseTransaction, 'execute' | 'insert'>;
export type UserArenaProgressSnapshotReadOptions = {
  lifetimeUniqueCellCount?: number;
  currentFlightId?: string;
};

type StoredProgressRow = {
  id: string;
  name: string;
  sourceId: number | string;
  arenaType: ArenaAchievementSnapshotRow['arenaType'];
  claimableCellCount: number | string | null;
  claimedCells: number | string;
  visited: boolean;
  firstFromLaunch?: boolean;
  tagged?: boolean;
};

function asNonNegativeInteger(value: number | string | null, field: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`User Arena progress has an invalid ${field}.`);
  return parsed;
}

function snapshotRows(rows: readonly StoredProgressRow[]): ArenaAchievementSnapshotRow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceId: String(row.sourceId),
    arenaType: row.arenaType,
    claimableCellCount: row.arenaType === 'launch' || row.arenaType === 'general'
      ? row.claimableCellCount
      : null,
    claimedCells: asNonNegativeInteger(row.claimedCells, 'claimed-cell count'),
    visited: row.visited,
    // The persisted projection deliberately does not carry current-flight facts.
    firstFromLaunch: false,
    tagged: false,
  }));
}

function factsCtes(userId: string, cellSize: number) {
  return sql`
    WITH personal_cells AS (
      SELECT DISTINCT claims.x, claims.y
      FROM user_grid_claims claims
      WHERE claims.claim_user = ${userId}
    ), arena_facts AS (
      SELECT arena.id,
             COALESCE(COUNT(DISTINCT (personal_cells.x, personal_cells.y))
               FILTER (WHERE personal_cells.x IS NOT NULL AND personal_cells.y IS NOT NULL), 0)::integer AS claimed_cells,
             EXISTS (
               SELECT 1
               FROM flights flight
               WHERE flight.user_id = ${userId}
                 AND flight.processing_status = 'completed'
                 AND flight.launch_latitude IS NOT NULL
                 AND flight.launch_longitude IS NOT NULL
                 AND arena.arena_type = 'launch'
                 AND ST_Covers(
                   arena.area,
                   ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
                 )
             ) AS visited
      FROM arenas arena
      LEFT JOIN personal_cells ON ${arenaCellOwnershipPredicateSql({
        arenaId: sql`arena.id`,
        arenaType: sql`arena.arena_type`,
        externalId: sql`arena.external_id`,
        area: sql`arena.area`,
        cellCenter: claimCellCenterSql({
          x: sql`personal_cells.x`,
          y: sql`personal_cells.y`,
          cellSize: sql`${cellSize}`,
        }),
      })}
      GROUP BY arena.id
    )
  `;
}

async function readSnapshot(
  database: Pick<Database, 'execute'>,
  userId: string,
  cellSize: number,
  options: UserArenaProgressSnapshotReadOptions = {},
): Promise<ArenaAchievementSnapshot> {
  const rows = await database.execute<StoredProgressRow>(sql`
    WITH current_origin AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN flights flight
        ON flight.flight_id = ${options.currentFlightId ?? null}
       AND flight.user_id = ${userId}
       AND flight.launch_latitude IS NOT NULL
       AND flight.launch_longitude IS NOT NULL
       AND ST_Covers(
         arena.area,
         ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
       )
      WHERE arena.arena_type = 'launch'
    ), current_tags AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN user_grid_claims claims
        ON claims.claim_user = ${userId}
       AND claims.claim_flight = ${options.currentFlightId ?? null}
       AND ST_Covers(
         arena.area,
         ${claimCellCenterSql({
           x: sql`claims.x`,
           y: sql`claims.y`,
           cellSize: sql`${cellSize}`,
         })}
       )
      WHERE arena.arena_type = 'launch'
    )
    SELECT arena.id,
           arena.name,
           arena.source_id AS "sourceId",
           arena.arena_type AS "arenaType",
           CASE WHEN arena.arena_type IN ('launch', 'general') THEN arena.claimable_cell_count ELSE NULL END AS "claimableCellCount",
           progress.claimed_cell_count AS "claimedCells",
           progress.visited,
           (current_origin.id IS NOT NULL) AS "firstFromLaunch",
           (current_tags.id IS NOT NULL) AS tagged
    FROM user_arena_progress progress
    INNER JOIN arenas arena ON arena.id = progress.arena_id
    LEFT JOIN current_origin ON current_origin.id = arena.id
    LEFT JOIN current_tags ON current_tags.id = arena.id
    WHERE progress.user_id = ${userId}
    ORDER BY arena.arena_type, lower(arena.name) COLLATE "C", arena.source_id, arena.id
  `);
  const lifetimeUniqueCellCount = options.lifetimeUniqueCellCount === undefined
    ? await database.execute<{ count: number | string }>(sql`
        SELECT COUNT(DISTINCT (claims.x, claims.y))::integer AS count
        FROM user_grid_claims claims
        WHERE claims.claim_user = ${userId}
      `).then((result) => asNonNegativeInteger(result.rows[0]?.count ?? 0, 'lifetime unique-cell count'))
    : asNonNegativeInteger(options.lifetimeUniqueCellCount, 'lifetime unique-cell count');
  return {
    rows: snapshotRows(rows.rows).map((row, index) => ({
      ...row,
      firstFromLaunch: Boolean(rows.rows[index]?.firstFromLaunch),
      tagged: Boolean(rows.rows[index]?.tagged),
    })),
    lifetimeUniqueCellCount,
  };
}

/**
 * Durable, correction-oriented personal Arena projection. Rebuilds are always
 * performed in the transaction supplied by the caller so claims and progress
 * can be corrected atomically by the owning workflow.
 */
export function createUserArenaProgressService(
  database: Pick<Database, 'execute'>,
  options: { cellSize: number },
) {
  async function rebuildInTransaction(
    transaction: UserArenaProgressTransaction,
    userId: string,
  ): Promise<ArenaAchievementSnapshot> {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))
    `);

    // Remove rows which no longer have canonical personal cells or a completed
    // Launch origin. The same CTE semantics are used for the replacement rows.
    await transaction.execute(sql`
      ${factsCtes(userId, options.cellSize)}
      DELETE FROM user_arena_progress progress
      WHERE progress.user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM arena_facts facts
          WHERE facts.id = progress.arena_id
            AND (facts.claimed_cells > 0 OR facts.visited)
        )
    `);
    await transaction.execute(sql`
      ${factsCtes(userId, options.cellSize)}
      INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited, updated_at)
      SELECT ${userId}, facts.id, facts.claimed_cells, facts.visited, now()
      FROM arena_facts facts
      WHERE facts.claimed_cells > 0 OR facts.visited
      ON CONFLICT (user_id, arena_id) DO UPDATE
      SET claimed_cell_count = EXCLUDED.claimed_cell_count,
          visited = EXCLUDED.visited,
          updated_at = EXCLUDED.updated_at
    `);

    return readSnapshot(transaction, userId, options.cellSize);
  }

  /** Find pilots whose canonical Personal cells or completed Launch origins
   * are covered by any of the supplied current Arena geometries. */
  async function findUsersAffectedByArenasInTransaction(
    transaction: UserArenaProgressTransaction,
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
          AND arena.arena_type IN ('launch', 'general', 'state', 'country')
          AND claims.x BETWEEN FLOOR(ST_XMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_XMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND claims.y BETWEEN FLOOR(ST_YMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_YMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND ${arenaCellOwnershipPredicateSql({
            arenaId: sql`arena.id`,
            arenaType: sql`arena.arena_type`,
            externalId: sql`arena.external_id`,
            area: sql`arena.area`,
            cellCenter: claimCellCenterSql({
              x: sql`claims.x`,
              y: sql`claims.y`,
              cellSize: sql`${options.cellSize}`,
            }),
          })}
        UNION
        SELECT flight.user_id
        FROM flights flight
        INNER JOIN arenas arena ON arena.id IN (${idList})
          AND arena.arena_type = 'launch'
          AND flight.processing_status = 'completed'
          AND flight.launch_latitude IS NOT NULL
          AND flight.launch_longitude IS NOT NULL
          AND ST_Covers(
            arena.area,
            ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
          )
      ) affected
      ORDER BY user_id
    `);
    return result.rows.map((row) => row.userId);
  }

  /** Rebuild pilots in deterministic order within the caller's transaction. */
  async function rebuildUsersInTransaction(
    transaction: UserArenaProgressTransaction,
    userIds: readonly string[],
  ): Promise<Array<{ userId: string; snapshot: ArenaAchievementSnapshot }>> {
    const ids = [...new Set(userIds)].sort();
    const results: Array<{ userId: string; snapshot: ArenaAchievementSnapshot }> = [];
    for (const userId of ids) {
      results.push({ userId, snapshot: await rebuildInTransaction(transaction, userId) });
    }
    return results;
  }

  /** Rebuild every pilot's projection in deterministic order. */
  async function rebuildAllInTransaction(
    transaction: UserArenaProgressTransaction,
  ): Promise<Array<{ userId: string; snapshot: ArenaAchievementSnapshot }>> {
    const result = await transaction.execute<{ userId: string }>(sql`
      SELECT user_id AS "userId" FROM users ORDER BY user_id
    `);
    return rebuildUsersInTransaction(transaction, result.rows.map((row) => row.userId));
  }

  async function applyFlightInTransaction(
    transaction: UserArenaProgressTransaction,
    input: {
      userId: string;
      flightId: string;
      previousLifetimeUniqueCellCount: number;
      lifetimeUniqueCellCount: number;
    },
  ): Promise<{ before: ArenaAchievementSnapshot; after: ArenaAchievementSnapshot }> {
    const before = await readSnapshot(transaction, input.userId, options.cellSize, {
      lifetimeUniqueCellCount: input.previousLifetimeUniqueCellCount,
    });

    // Only cells first claimed by this flight can increase the durable
    // projection. Historical cells are deliberately not joined here.
    await transaction.execute(sql`
      WITH current_cells AS (
        SELECT DISTINCT claims.x, claims.y
        FROM user_grid_claims claims
        WHERE claims.claim_user = ${input.userId}
          AND claims.claim_flight = ${input.flightId}
          AND NOT EXISTS (
            SELECT 1
            FROM user_grid_claims previous
            WHERE previous.claim_user = claims.claim_user
              AND previous.x = claims.x
              AND previous.y = claims.y
              AND previous.claim_flight <> claims.claim_flight
          )
      ), arena_cells AS (
        SELECT arena.id, current_cells.x, current_cells.y
        FROM arenas arena
        INNER JOIN current_cells ON ${arenaCellOwnershipPredicateSql({
          arenaId: sql`arena.id`,
          arenaType: sql`arena.arena_type`,
          externalId: sql`arena.external_id`,
          area: sql`arena.area`,
          cellCenter: claimCellCenterSql({
            x: sql`current_cells.x`,
            y: sql`current_cells.y`,
            cellSize: sql`${options.cellSize}`,
          }),
        })}
      ), arena_counts AS (
        SELECT id, COUNT(DISTINCT (x, y))::integer AS claimed_cells
        FROM arena_cells
        GROUP BY id
      )
      INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited, updated_at)
      SELECT ${input.userId}, arena_counts.id, arena_counts.claimed_cells, FALSE, now()
      FROM arena_counts
      ON CONFLICT (user_id, arena_id) DO UPDATE
      SET claimed_cell_count = user_arena_progress.claimed_cell_count + EXCLUDED.claimed_cell_count,
          updated_at = EXCLUDED.updated_at
    `);

    // A flight may still be processing when its origin is projected. This is
    // intentionally independent of processing_status.
    await transaction.execute(sql`
      INSERT INTO user_arena_progress (user_id, arena_id, claimed_cell_count, visited, updated_at)
      SELECT ${input.userId}, arena.id, 0, TRUE, now()
      FROM arenas arena
      INNER JOIN flights flight
        ON flight.flight_id = ${input.flightId}
       AND flight.user_id = ${input.userId}
       AND flight.launch_latitude IS NOT NULL
       AND flight.launch_longitude IS NOT NULL
       AND ST_Covers(
         arena.area,
         ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
       )
      WHERE arena.arena_type = 'launch'
      ON CONFLICT (user_id, arena_id) DO UPDATE
      SET visited = TRUE,
          updated_at = EXCLUDED.updated_at
    `);

    const after = await readSnapshot(transaction, input.userId, options.cellSize, {
      lifetimeUniqueCellCount: input.lifetimeUniqueCellCount,
      currentFlightId: input.flightId,
    });
    return { before, after };
  }

  return {
    rebuildInTransaction,
    findUsersAffectedByArenasInTransaction,
    rebuildUsersInTransaction,
    rebuildAllInTransaction,
    applyFlightInTransaction,
    getSnapshot: (userId: string, readOptions?: UserArenaProgressSnapshotReadOptions) => readSnapshot(database, userId, options.cellSize, readOptions),
    getSnapshotInTransaction: (transaction: UserArenaProgressTransaction, userId: string, readOptions?: UserArenaProgressSnapshotReadOptions) => readSnapshot(transaction, userId, options.cellSize, readOptions),
    // Keep the short read name consistent with other progression services.
    get: (userId: string, readOptions?: UserArenaProgressSnapshotReadOptions) => readSnapshot(database, userId, options.cellSize, readOptions),
  };
}

export type UserArenaProgressService = ReturnType<typeof createUserArenaProgressService>;
