import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type {
  MonthlyCoverageCellClaimant,
  MonthlyCoverageGeoJson,
  MonthlyCoverageLeaderboard,
  MonthlyCoveragePilot,
} from '../domain/competition/monthlyCoverage.js';
import { emptyMonthlyCoverageGeoJson } from '../domain/competition/monthlyCoverage.js';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

export type MonthlyCoveragePeriod = { competitionMonth: string } | { period: 'all-time' };

export interface MonthlyCoverageService {
  getGlobalLeaderboard(input: MonthlyCoveragePeriod & ViewportBounds & { currentUserId: string }): Promise<MonthlyCoverageLeaderboard>;
  getArenaLeaderboard(input: MonthlyCoveragePeriod & { launchAreaId: string; currentUserId: string }): Promise<MonthlyCoverageLeaderboard>;
  getGlobalTerritory(input: MonthlyCoveragePeriod & { pilotUserId?: string }): Promise<MonthlyCoverageGeoJson>;
  getArenaTerritory(input: MonthlyCoveragePeriod & { launchAreaId: string; pilotUserId?: string }): Promise<MonthlyCoverageGeoJson>;
  getCellClaimants(input: MonthlyCoveragePeriod & { x: number; y: number }): Promise<MonthlyCoverageCellClaimant[]>;
}

type StoredPilot = MonthlyCoveragePilot & { isCurrentPilotOnly: boolean; displayPosition: number };
type StoredProjection = { geojson: MonthlyCoverageGeoJson };

function coverageClaimsCtes(input: { competitionMonth?: string; cellSize: number }) {
  return sql`
    pilot_cells AS (
      SELECT DISTINCT c.cell_size, c.x, c.y, c.claim_user
      FROM competition_grid_claims c
      WHERE c.cell_size = ${input.cellSize}
        ${input.competitionMonth
          ? sql`AND c.competition_month = ${input.competitionMonth}::date`
          : sql``}
    ),
    cell_claimants AS (
      SELECT
        cell_size,
        x,
        y,
        COUNT(*)::integer AS claimant_count,
        CASE WHEN COUNT(*) = 1 THEN MIN(claim_user::text)::uuid END AS pilot_user_id
      FROM pilot_cells
      GROUP BY cell_size, x, y
    )
  `;
}

function normalizePeriod(input: MonthlyCoveragePeriod): string | undefined {
  return 'competitionMonth' in input
    ? normalizeCompetitionLeaderboardMonth(input.competitionMonth)
    : undefined;
}

function leaderboardFromRows(rows: StoredPilot[]): MonthlyCoverageLeaderboard {
  const pilot = (row: StoredPilot): MonthlyCoveragePilot => ({
    userId: row.userId,
    displayName: row.displayName,
    claimedCellCount: row.claimedCellCount,
    exclusiveCellCount: row.exclusiveCellCount,
    sharedCellCount: row.sharedCellCount,
    claimedAreaSquareMeters: row.claimedAreaSquareMeters,
    rank: row.rank,
  });
  const currentPilot = rows.find((row) => row.isCurrentPilotOnly);
  return {
    leaders: rows.filter((row) => !row.isCurrentPilotOnly).map(pilot),
    currentPilot: currentPilot ? pilot(currentPilot) : null,
  };
}

function leaderboardQuery(input: {
  scopedClaims: ReturnType<typeof sql>;
  currentUserId: string;
  cellSize: number;
}) {
  return sql`
    scoped_claims AS (${input.scopedClaims}),
    pilot_totals AS (
      SELECT
        scoped.claim_user,
        profile.display_name,
        COUNT(*)::integer AS claimed_cell_count,
        COUNT(*) FILTER (WHERE scoped.claimant_count = 1)::integer AS exclusive_cell_count,
        COUNT(*) FILTER (WHERE scoped.claimant_count > 1)::integer AS shared_cell_count
      FROM scoped_claims scoped
      INNER JOIN profiles profile ON profile.user_id = scoped.claim_user
      GROUP BY scoped.claim_user, profile.display_name
    ),
    ranked_pilots AS (
      SELECT
        claim_user,
        display_name,
        claimed_cell_count,
        exclusive_cell_count,
        shared_cell_count,
        (claimed_cell_count::bigint * ${input.cellSize}::bigint * ${input.cellSize}::bigint)::double precision AS claimed_area_square_meters,
        RANK() OVER (ORDER BY claimed_cell_count DESC)::integer AS rank
      FROM pilot_totals
    ),
    ordered_pilots AS (
      SELECT *, ROW_NUMBER() OVER (
        ORDER BY claimed_cell_count DESC, lower(display_name), display_name, claim_user
      ) AS display_position
      FROM ranked_pilots
    ),
    displayed_pilots AS (
      SELECT * FROM ordered_pilots WHERE display_position <= 10
    ),
    current_pilot AS (
      SELECT
        profile.user_id AS claim_user,
        profile.display_name,
        COALESCE(ranked.claimed_cell_count, 0)::integer AS claimed_cell_count,
        COALESCE(ranked.exclusive_cell_count, 0)::integer AS exclusive_cell_count,
        COALESCE(ranked.shared_cell_count, 0)::integer AS shared_cell_count,
        COALESCE(ranked.claimed_area_square_meters, 0)::double precision AS claimed_area_square_meters,
        ranked.rank
      FROM profiles profile
      LEFT JOIN ranked_pilots ranked ON ranked.claim_user = profile.user_id
      WHERE profile.user_id = ${input.currentUserId}
        AND NOT EXISTS (
          SELECT 1 FROM displayed_pilots displayed WHERE displayed.claim_user = profile.user_id
        )
    )
    SELECT
      claim_user AS "userId",
      display_name AS "displayName",
      claimed_cell_count AS "claimedCellCount",
      exclusive_cell_count AS "exclusiveCellCount",
      shared_cell_count AS "sharedCellCount",
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
      exclusive_cell_count AS "exclusiveCellCount",
      shared_cell_count AS "sharedCellCount",
      claimed_area_square_meters AS "claimedAreaSquareMeters",
      rank,
      true AS "isCurrentPilotOnly",
      11 AS "displayPosition"
    FROM current_pilot
    ORDER BY "displayPosition"
  `;
}

function territoryQuery(input: {
  scopedCells: ReturnType<typeof sql>;
  cellSize: number;
  pilotUserId?: string;
}) {
  return sql`
    scoped_cells AS (${input.scopedCells})
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'properties', jsonb_strip_nulls(jsonb_build_object(
            'cellId', concat(${input.cellSize}::integer, ':', scoped.x, ':', scoped.y),
            'cellSize', ${input.cellSize}::integer,
            'x', scoped.x,
            'y', scoped.y,
            'claimantCount', scoped.claimant_count,
            'isShared', scoped.claimant_count > 1,
            'pilotUserId', ${input.pilotUserId ? sql`${input.pilotUserId}::uuid` : sql`scoped.pilot_user_id`}
          )),
          'geometry', ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(
            scoped.x * ${input.cellSize}, scoped.y * ${input.cellSize},
            (scoped.x + 1) * ${input.cellSize}, (scoped.y + 1) * ${input.cellSize}, 6933
          ), 4326))::jsonb
        ) ORDER BY scoped.x, scoped.y
      ), '[]'::jsonb)
    ) AS geojson
    FROM scoped_cells scoped
  `;
}

export function createMonthlyCoverageService(
  database: Database,
  options: { cellSize: number },
): MonthlyCoverageService {
  const { cellSize } = options;

  return {
    async getGlobalLeaderboard(input) {
      const competitionMonth = normalizePeriod(input);
      const result = await database.execute<StoredPilot>(sql`
        WITH ${coverageClaimsCtes({ competitionMonth, cellSize })},
        ${viewportCtes(input)},
        ${leaderboardQuery({
          currentUserId: input.currentUserId,
          cellSize,
          scopedClaims: sql`
            SELECT pilot.*, claimant.claimant_count
            FROM pilot_cells pilot
            INNER JOIN cell_claimants claimant USING (cell_size, x, y)
            INNER JOIN viewport_parts viewport ON ST_Intersects(
              ST_MakeEnvelope(
                pilot.x * ${cellSize}, pilot.y * ${cellSize},
                (pilot.x + 1) * ${cellSize}, (pilot.y + 1) * ${cellSize}, 6933
              ), viewport.geometry
            )
          `,
        })}
      `);
      return leaderboardFromRows(result.rows);
    },

    async getArenaLeaderboard(input) {
      const competitionMonth = normalizePeriod(input);
      const result = await database.execute<StoredPilot>(sql`
        WITH ${coverageClaimsCtes({ competitionMonth, cellSize })},
        ${leaderboardQuery({
          currentUserId: input.currentUserId,
          cellSize,
          scopedClaims: sql`
            SELECT pilot.*, claimant.claimant_count
            FROM pilot_cells pilot
            INNER JOIN cell_claimants claimant USING (cell_size, x, y)
            INNER JOIN launch_area_cells arena ON arena.launch_area_id = ${input.launchAreaId}
              AND arena.cell_size = pilot.cell_size AND arena.x = pilot.x AND arena.y = pilot.y
          `,
        })}
      `);
      return leaderboardFromRows(result.rows);
    },

    async getGlobalTerritory(input) {
      const competitionMonth = normalizePeriod(input);
      const result = await database.execute<StoredProjection>(sql`
        WITH ${coverageClaimsCtes({ competitionMonth, cellSize })},
        ${territoryQuery({
          cellSize,
          pilotUserId: input.pilotUserId,
          scopedCells: input.pilotUserId
            ? sql`SELECT pilot.x, pilot.y, claimant.claimant_count, pilot.claim_user AS pilot_user_id FROM pilot_cells pilot INNER JOIN cell_claimants claimant USING (cell_size, x, y) WHERE pilot.claim_user = ${input.pilotUserId}`
            : sql`SELECT x, y, claimant_count, pilot_user_id FROM cell_claimants`,
        })}
      `);
      return result.rows[0]?.geojson ?? emptyMonthlyCoverageGeoJson();
    },

    async getArenaTerritory(input) {
      const competitionMonth = normalizePeriod(input);
      const result = await database.execute<StoredProjection>(sql`
        WITH ${coverageClaimsCtes({ competitionMonth, cellSize })},
        ${territoryQuery({
          cellSize,
          pilotUserId: input.pilotUserId,
          scopedCells: sql`
            SELECT source.x, source.y, source.claimant_count, source.pilot_user_id
            FROM ${input.pilotUserId
              ? sql`(SELECT pilot.x, pilot.y, claimant.claimant_count, pilot.cell_size, pilot.claim_user AS pilot_user_id FROM pilot_cells pilot INNER JOIN cell_claimants claimant USING (cell_size, x, y) WHERE pilot.claim_user = ${input.pilotUserId})`
              : sql`cell_claimants`} source
            INNER JOIN launch_area_cells arena ON arena.launch_area_id = ${input.launchAreaId}
              AND arena.cell_size = ${cellSize} AND arena.x = source.x AND arena.y = source.y
          `,
        })}
      `);
      return result.rows[0]?.geojson ?? emptyMonthlyCoverageGeoJson();
    },

    async getCellClaimants(input) {
      const competitionMonth = normalizePeriod(input);
      const result = await database.execute<MonthlyCoverageCellClaimant>(sql`
        WITH ${coverageClaimsCtes({ competitionMonth, cellSize })}
        SELECT profile.user_id AS "userId", profile.display_name AS "displayName"
        FROM pilot_cells pilot
        INNER JOIN profiles profile ON profile.user_id = pilot.claim_user
        WHERE pilot.x = ${input.x} AND pilot.y = ${input.y}
        ORDER BY lower(profile.display_name), profile.display_name, profile.user_id
      `);
      return result.rows;
    },
  };
}
