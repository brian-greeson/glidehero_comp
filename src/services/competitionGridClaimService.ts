import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims } from '../db/schema.js';
import { normalizeCompetitionMonth } from '../domain/competition/competitionMonth.js';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import type { CompetitionLeaderboard } from '../domain/competition/competitionLeaderboard.js';
import {
  emptyCompetitionGridClaimGeoJson,
  type CompetitionGridClaimGeoJson,
} from '../domain/territory/competitionGridClaimGeoJson.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';
import { currentCompetitionOwnershipCtes } from './currentCompetitionOwnership.js';

export interface CompetitionGridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<void>;
  getCurrent(input: { competitionMonth: string }): Promise<CompetitionGridClaimGeoJson>;
  getViewportLeaderboard(input: {
    competitionMonth: string;
    west: number;
    south: number;
    east: number;
    north: number;
    currentUserId: string;
  }): Promise<CompetitionLeaderboard>;
}

type StoredProjection = { geojson: CompetitionGridClaimGeoJson };
type StoredLeaderboardPilot = {
  userId: string;
  displayName: string;
  claimedCellCount: number;
  claimedAreaSquareMeters: number;
  rank: number | null;
  isCurrentPilotOnly: boolean;
  displayPosition: number;
};
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
        WITH ${currentCompetitionOwnershipCtes({ competitionMonth: normalizedMonth, cellSize })}
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'properties', jsonb_build_object(
                  'ownerUserId', claim_user,
                  'cellId', concat(competition_month::text, ':', cell_size, ':', x, ':', y),
                  'competitionMonth', competition_month::text,
                  'cellSize', cell_size,
                  'x', x,
                  'y', y
                ),
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

    async getViewportLeaderboard({ competitionMonth, west, south, east, north, currentUserId }) {
      const normalizedMonth = normalizeCompetitionLeaderboardMonth(competitionMonth);
      const result = await database.execute<StoredLeaderboardPilot>(sql`
        WITH ${currentCompetitionOwnershipCtes({ competitionMonth: normalizedMonth, cellSize })},
        viewport_parts AS (
          SELECT ST_Transform(ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326), 6933) AS geometry
          WHERE ${west} <= ${east}
          UNION ALL
          SELECT ST_Transform(ST_MakeEnvelope(${west}, ${south}, 180, ${north}, 4326), 6933) AS geometry
          WHERE ${west} > ${east}
          UNION ALL
          SELECT ST_Transform(ST_MakeEnvelope(-180, ${south}, ${east}, ${north}, 4326), 6933) AS geometry
          WHERE ${west} > ${east}
        ),
        visible_claims AS (
          SELECT DISTINCT c.x, c.y, c.claim_user
          FROM current_claims c
          INNER JOIN viewport_parts viewport ON ST_Intersects(
            ST_MakeEnvelope(
              c.x * ${cellSize},
              c.y * ${cellSize},
              (c.x + 1) * ${cellSize},
              (c.y + 1) * ${cellSize},
              6933
            ),
            viewport.geometry
          )
        ),
        pilot_totals AS (
          SELECT
            visible.claim_user,
            profile.display_name,
            COUNT(*)::integer AS claimed_cell_count,
            (COUNT(*) * ${cellSize}::bigint * ${cellSize}::bigint)::double precision AS claimed_area_square_meters
          FROM visible_claims visible
          INNER JOIN profiles profile ON profile.user_id = visible.claim_user
          GROUP BY visible.claim_user, profile.display_name
        ),
        ranked_pilots AS (
          SELECT
            claim_user,
            display_name,
            claimed_cell_count,
            claimed_area_square_meters,
            RANK() OVER (ORDER BY claimed_cell_count DESC)::integer AS rank
          FROM pilot_totals
        ),
        ordered_pilots AS (
          SELECT
            ranked_pilots.*,
            ROW_NUMBER() OVER (
              ORDER BY claimed_cell_count DESC, lower(display_name), display_name, claim_user
            ) AS display_position
          FROM ranked_pilots
        ),
        displayed_pilots AS (
          SELECT *
          FROM ordered_pilots
          WHERE display_position <= 10
        ),
        current_pilot AS (
          SELECT
            profile.user_id AS claim_user,
            profile.display_name,
            COALESCE(ranked.claimed_cell_count, 0)::integer AS claimed_cell_count,
            COALESCE(ranked.claimed_area_square_meters, 0)::double precision AS claimed_area_square_meters,
            ranked.rank
          FROM profiles profile
          LEFT JOIN ranked_pilots ranked ON ranked.claim_user = profile.user_id
          WHERE profile.user_id = ${currentUserId}
            AND NOT EXISTS (
              SELECT 1 FROM displayed_pilots displayed WHERE displayed.claim_user = profile.user_id
            )
        )
        SELECT
          claim_user AS "userId",
          display_name AS "displayName",
          claimed_cell_count AS "claimedCellCount",
          claimed_area_square_meters AS "claimedAreaSquareMeters",
          rank,
          false AS "isCurrentPilotOnly",
          display_position::integer AS "displayPosition"
        FROM displayed_pilots
        UNION ALL
        SELECT
          claim_user AS "userId",
          display_name AS "displayName",
          claimed_cell_count AS "claimedCellCount",
          claimed_area_square_meters AS "claimedAreaSquareMeters",
          rank,
          true AS "isCurrentPilotOnly",
          11 AS "displayPosition"
        FROM current_pilot
        ORDER BY "displayPosition"
      `);

      return {
        leaders: result.rows
          .filter((pilot) => !pilot.isCurrentPilotOnly)
          .map(({ isCurrentPilotOnly: _, displayPosition: __, ...pilot }) => pilot),
        currentPilot: result.rows
          .filter((pilot) => pilot.isCurrentPilotOnly)
          .map(({ isCurrentPilotOnly: _, displayPosition: __, ...pilot }) => pilot)[0] ?? null,
      };
    },
  };
}
