import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims } from '../db/schema.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';

export interface CompetitionGridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<void>;
}

type ClaimDatabase = Pick<Database, 'delete' | 'execute'>;

export async function rebuildCompetitionGridClaims(
  database: ClaimDatabase,
  input: { flightId: string; userId: string; launchTimezone: string },
  cellSize: number,
): Promise<void> {
  await database.execute(sql`
    ${gridClaimCandidateCtes({ flightId: input.flightId, cellSize })},
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
    )
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
  `);
}

export function createCompetitionGridClaimService(
  database: Database,
  options: { cellSize: number },
): CompetitionGridClaimService {
  const { cellSize } = options;

  return {
    async process({ flightId, userId, launchTimezone }) {
      await database.transaction(async (tx) => {
        await tx.delete(competitionGridClaims).where(and(
          eq(competitionGridClaims.claimFlight, flightId),
          eq(competitionGridClaims.cellSize, cellSize),
        ));

        await rebuildCompetitionGridClaims(tx, { flightId, userId, launchTimezone }, cellSize);
      });
    },
  };
}
