import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { GridClaimProcessResult } from './gridClaimService.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';

type ProcessCounts = {
  directCellCount: number;
  enclosedCellCount: number;
  newPersonalCellCount: number;
  personalCellTotalAfter: number;
  progressionVersion: number;
  evaluatedAt: Date;
};

type ClaimDatabase = Pick<Database, 'delete' | 'execute'>;

export async function rebuildGridClaims(
  database: ClaimDatabase,
  input: { flightId: string; userId: string; launchTimezone: string },
  cellSize: number,
): Promise<GridClaimProcessResult> {
  const result = await database.execute<ProcessCounts>(sql`
    ${gridClaimCandidateCtes({ flightId: input.flightId, cellSize })},
    personal_cells AS (
      SELECT x, y, MAX(claim_timestamp) AS claim_timestamp
      FROM candidate_events
      GROUP BY x, y
    ),
    competition_events AS (
      SELECT
        date_trunc(
          'month',
          claim_timestamp AT TIME ZONE ${input.launchTimezone}
        )::date AS competition_month,
        x,
        y,
        claim_timestamp
      FROM candidate_events
    ),
    competition_cells AS (
      SELECT competition_month, x, y, MAX(claim_timestamp) AS claim_timestamp
      FROM competition_events
      GROUP BY competition_month, x, y
    ),
    personal_inserted AS (
      INSERT INTO user_grid_claims (
        cell_size,
        x,
        y,
        claim_flight,
        claim_user,
        claim_timestamp
      )
      SELECT ${cellSize}, x, y, ${input.flightId}, ${input.userId}, claim_timestamp
      FROM personal_cells
      ON CONFLICT (claim_user, cell_size, x, y, claim_flight) DO UPDATE
      SET
        claim_timestamp = EXCLUDED.claim_timestamp
      RETURNING x, y
    ),
    competition_inserted AS (
      INSERT INTO competition_grid_claims (
        competition_month,
        cell_size,
        x,
        y,
        claim_flight,
        claim_user,
        claim_timestamp
      )
      SELECT
        competition_month,
        ${cellSize},
        x,
        y,
        ${input.flightId},
        ${input.userId},
        claim_timestamp
      FROM competition_cells
      ON CONFLICT (competition_month, cell_size, x, y, claim_flight) DO UPDATE
      SET
        claim_user = EXCLUDED.claim_user,
        claim_timestamp = EXCLUDED.claim_timestamp
      RETURNING competition_month
    ),
    new_personal_cells AS (
      SELECT personal_cells.x, personal_cells.y
      FROM personal_cells
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_grid_claims existing_claims
        WHERE existing_claims.claim_user = ${input.userId}
          AND existing_claims.cell_size = ${cellSize}
          AND existing_claims.x = personal_cells.x
          AND existing_claims.y = personal_cells.y
          AND existing_claims.claim_flight <> ${input.flightId}
      )
    ),
    personal_claim_cells AS (
      SELECT existing_claims.x, existing_claims.y
      FROM user_grid_claims existing_claims
      WHERE existing_claims.claim_user = ${input.userId}
        AND existing_claims.cell_size = ${cellSize}
      UNION
      SELECT x, y
      FROM personal_inserted
    ),
    claim_counts AS (
      SELECT
        (SELECT count(*)::integer FROM direct_cells) AS direct_cell_count,
        (SELECT count(*)::integer FROM enclosed_candidates) AS enclosed_cell_count,
        (SELECT count(*)::integer FROM new_personal_cells) AS new_personal_cell_count,
        (SELECT count(*)::integer FROM personal_claim_cells) AS personal_cell_total_after
    ),
    progression_upsert AS (
      INSERT INTO flight_progress (
        flight_id,
        user_id,
        direct_cell_count,
        enclosed_cell_count,
        new_personal_cell_count,
        personal_cell_total_after,
        progression_version,
        evaluated_at,
        updated_at
      )
      SELECT
        ${input.flightId},
        ${input.userId},
        direct_cell_count,
        enclosed_cell_count,
        new_personal_cell_count,
        personal_cell_total_after,
        1,
        now(),
        now()
      FROM claim_counts
      ON CONFLICT (flight_id) DO UPDATE SET
        direct_cell_count = EXCLUDED.direct_cell_count,
        enclosed_cell_count = EXCLUDED.enclosed_cell_count,
        progression_version = flight_progress.progression_version + 1,
        updated_at = now()
      RETURNING new_personal_cell_count, personal_cell_total_after, progression_version, evaluated_at
    ),
    competition_write AS (
      SELECT count(*)::integer AS written_count
      FROM competition_inserted
    )
    SELECT
      claim_counts.direct_cell_count AS "directCellCount",
      claim_counts.enclosed_cell_count AS "enclosedCellCount",
      progression_upsert.new_personal_cell_count AS "newPersonalCellCount",
      progression_upsert.personal_cell_total_after AS "personalCellTotalAfter",
      progression_upsert.progression_version AS "progressionVersion",
      progression_upsert.evaluated_at AS "evaluatedAt"
    FROM claim_counts
    CROSS JOIN progression_upsert
    CROSS JOIN competition_write
  `);
  const counts = result.rows[0] ?? {
    directCellCount: 0,
    enclosedCellCount: 0,
    newPersonalCellCount: 0,
    personalCellTotalAfter: 0,
    progressionVersion: 1,
    evaluatedAt: new Date(),
  };

  return {
    flightId: input.flightId,
    cellSize,
    directCellCount: counts.directCellCount,
    enclosedCellCount: counts.enclosedCellCount,
    newPersonalCellCount: counts.newPersonalCellCount,
    personalCellTotalAfter: counts.personalCellTotalAfter,
    progressionVersion: counts.progressionVersion,
    evaluatedAt: new Date(counts.evaluatedAt),
  };
}
