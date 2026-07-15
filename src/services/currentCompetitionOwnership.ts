import { sql } from 'drizzle-orm';

export function currentCompetitionOwnershipCtes(input: {
  competitionMonth: string;
  cellSize: number;
}) {
  return sql`
    ranked_claims AS (
      SELECT
        c.competition_month,
        c.cell_size,
        c.x,
        c.y,
        c.claim_user,
        c.claim_flight,
        c.claim_timestamp,
        ROW_NUMBER() OVER (
          PARTITION BY c.cell_size, c.x, c.y
          ORDER BY
            c.claim_timestamp DESC,
            f.created_at DESC,
            c.claim_flight DESC
        ) AS ownership_rank
      FROM competition_grid_claims c
      INNER JOIN flights f ON f.flight_id = c.claim_flight
      WHERE c.competition_month = ${input.competitionMonth}::date
        AND c.cell_size = ${input.cellSize}
    ),
    current_claims AS (
      SELECT
        competition_month,
        cell_size,
        x,
        y,
        claim_user,
        claim_flight,
        claim_timestamp
      FROM ranked_claims
      WHERE ownership_rank = 1
    )
  `;
}
