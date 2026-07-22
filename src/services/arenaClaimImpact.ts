import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { arenaCellOwnershipPredicateSql } from './arenaGeometrySql.js';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ArenaClaimImpactTransaction = Pick<DatabaseTransaction, 'execute'>;

/**
 * Returns eligible Arenas containing the center of a flight's persisted
 * competition cells. When `newlyUniqueOnly` is set, cells are selected when
 * this flight either introduced the pilot-cell or became its canonical
 * earliest claim. Discovery stays in Postgres so correction paths do not
 * materialize claim history in the application.
 */
export async function findEligibleArenaIdsForCompetitionFlight(
  transaction: ArenaClaimImpactTransaction,
  input: { flightId: string; cellSize?: number; newlyUniqueOnly?: boolean },
): Promise<string[]> {
  const cells = input.newlyUniqueOnly
    ? sql`WITH flight_cells AS (
      SELECT
        claims.x,
        claims.y,
        claims.claim_user,
        MIN(claims.claim_timestamp) AS claim_timestamp
      FROM competition_grid_claims claims
      WHERE claims.claim_flight = ${input.flightId}
      GROUP BY claims.x, claims.y, claims.claim_user
    ), selected_cells AS (
      SELECT cells.x, cells.y
      FROM flight_cells cells
        WHERE NOT EXISTS (
          SELECT 1
          FROM competition_grid_claims previous
          WHERE previous.claim_user = cells.claim_user
            AND previous.x = cells.x
            AND previous.y = cells.y
            AND previous.claim_flight <> ${input.flightId}
            AND (
              previous.claim_timestamp < cells.claim_timestamp
              OR (
                previous.claim_timestamp = cells.claim_timestamp
                AND previous.claim_flight::text < ${input.flightId}
              )
            )
        )
      )`
    : sql`WITH selected_cells AS (
        SELECT DISTINCT claims.x, claims.y
        FROM competition_grid_claims claims
        WHERE claims.claim_flight = ${input.flightId}
      )`;

  const cellCenter = sql`ST_SetSRID(ST_MakePoint(
    (cells.x + 0.5) * ${input.cellSize ?? 500},
    (cells.y + 0.5) * ${input.cellSize ?? 500}
  ), 6933)`;
  const result = await transaction.execute<{ arenaId: string }>(sql`
    ${cells}
    SELECT DISTINCT arena.id AS "arenaId"
    FROM arenas arena
    INNER JOIN selected_cells cells ON ${arenaCellOwnershipPredicateSql({
      arenaId: sql`arena.id`,
      arenaType: sql`arena.arena_type`,
      externalId: sql`arena.external_id`,
      area: sql`arena.area`,
      cellCenter,
    })}
    WHERE arena.arena_type IN ('general', 'state', 'country')
    ORDER BY arena.id
  `);
  return [...new Set(result.rows
    .map((row) => row.arenaId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}
