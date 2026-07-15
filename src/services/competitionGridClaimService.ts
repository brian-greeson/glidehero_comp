import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims } from '../db/schema.js';
import { normalizeCompetitionMonth } from '../domain/competition/competitionMonth.js';
import {
  emptyCompetitionGridClaimGeoJson,
  type CompetitionGridClaimGeoJson,
} from '../domain/territory/competitionGridClaimGeoJson.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';

export interface CompetitionGridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<void>;
  getCurrent(input: { competitionMonth: string }): Promise<CompetitionGridClaimGeoJson>;
}

type StoredProjection = { geojson: CompetitionGridClaimGeoJson };
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

    async getCurrent({ competitionMonth }) {
      const normalizedMonth = normalizeCompetitionMonth(competitionMonth);
      const result = await database.execute<StoredProjection>(sql`
        WITH ranked_claims AS (
          SELECT
            c.x,
            c.y,
            c.claim_user,
            ROW_NUMBER() OVER (
              PARTITION BY c.cell_size, c.x, c.y
              ORDER BY
                c.claim_timestamp DESC,
                f.created_at DESC,
                c.claim_flight DESC
            ) AS ownership_rank
          FROM competition_grid_claims c
          INNER JOIN flights f ON f.flight_id = c.claim_flight
          WHERE c.competition_month = ${normalizedMonth}::date
            AND c.cell_size = ${cellSize}
        ),
        current_claims AS (
          SELECT x, y, claim_user
          FROM ranked_claims
          WHERE ownership_rank = 1
        )
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'properties', jsonb_build_object('ownerUserId', claim_user),
                'geometry', ST_AsGeoJSON(
                  ST_Transform(
                    ST_MakeEnvelope(
                      x * ${cellSize},
                      y * ${cellSize},
                      (x + 1) * ${cellSize},
                      (y + 1) * ${cellSize},
                      6933
                    ),
                    4326
                  )
                )::jsonb
              )
              ORDER BY x, y
            ),
            '[]'::jsonb
          )
        ) AS geojson
        FROM current_claims
      `);

      return result.rows[0]?.geojson ?? emptyCompetitionGridClaimGeoJson();
    },
  };
}
