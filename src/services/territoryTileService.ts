import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import type { MonthlyCoveragePeriod } from './monthlyCoverageService.js';
import { arenaCellOwnershipPredicateSql, claimCellCenterSql } from './arenaGeometrySql.js';

export type TerritoryTileResult = {
  data: Buffer;
  featureCount: number;
};
export type CompetitionScope = 'following';

export interface TerritoryTileService {
  getPersonalTile(input: {
    z: number;
    x: number;
    y: number;
    userId: string;
    period: MonthlyCoveragePeriod;
  }): Promise<TerritoryTileResult>;
  getGlobalCompetitionTile(input: {
    z: number;
    x: number;
    y: number;
    period: MonthlyCoveragePeriod;
    pilotUserId?: string;
    currentUserId?: string;
    scope?: CompetitionScope;
  }): Promise<TerritoryTileResult>;
  getArenaCompetitionTile(input: {
    z: number;
    x: number;
    y: number;
    arenaId: string;
    period: MonthlyCoveragePeriod;
    pilotUserId?: string;
    currentUserId?: string;
    scope?: CompetitionScope;
  }): Promise<TerritoryTileResult>;
  /** Return monthly competition coverage visible to accepted members of a group. */
  getGroupCompetitionTile?(input: {
    z: number;
    x: number;
    y: number;
    groupId: string;
    period: MonthlyCoveragePeriod;
    pilotUserId?: string;
  }): Promise<TerritoryTileResult>;
}

type StoredTile = { data: Buffer; featureCount: number };

function tileBoundsCtes(input: {
  z: number;
  x: number;
  y: number;
  cellSize: number;
  extent: number;
  buffer: number;
}) {
  return sql`
    tile_bounds AS (
      SELECT
        ST_TileEnvelope(${input.z}, ${input.x}, ${input.y}) AS geometry,
        ST_TileEnvelope(
          ${input.z}, ${input.x}, ${input.y},
          margin => ${input.buffer}::double precision / ${input.extent}::double precision
        ) AS expanded_geometry
    ),
    grid_bounds AS (
      SELECT ST_Transform(expanded_geometry, 6933) AS geometry
      FROM tile_bounds
    ),
    cell_ranges AS (
      SELECT
        floor(ST_XMin(geometry) / ${input.cellSize})::integer AS min_x,
        (ceil(ST_XMax(geometry) / ${input.cellSize}) - 1)::integer AS max_x,
        floor(ST_YMin(geometry) / ${input.cellSize})::integer AS min_y,
        (ceil(ST_YMax(geometry) / ${input.cellSize}) - 1)::integer AS max_y
      FROM grid_bounds
    )
  `;
}

function normalizePeriod(period: MonthlyCoveragePeriod): string | undefined {
  return 'competitionMonth' in period
    ? normalizeCompetitionLeaderboardMonth(period.competitionMonth)
    : undefined;
}

function tileResult(row?: StoredTile): TerritoryTileResult {
  return {
    data: row?.data ?? Buffer.alloc(0),
    featureCount: row?.featureCount ?? 0,
  };
}

export function createTerritoryTileService(
  database: Pick<Database, 'execute'>,
  options: { cellSize: number; extent?: number; buffer?: number },
): TerritoryTileService {
  const cellSize = options.cellSize;
  const extent = options.extent ?? 4096;
  const buffer = options.buffer ?? 64;

  async function getCompetitionTile(input: {
    z: number;
    x: number;
    y: number;
    period: MonthlyCoveragePeriod;
    arenaId?: string;
    pilotUserId?: string;
    currentUserId?: string;
    scope?: CompetitionScope;
    groupId?: string;
  }): Promise<TerritoryTileResult> {
    const competitionMonth = normalizePeriod(input.period);
    const result = await database.execute<StoredTile>(sql`
      WITH ${tileBoundsCtes({ ...input, cellSize, extent, buffer })},
      pilot_cells AS (
        SELECT DISTINCT claim.x, claim.y, claim.claim_user
        FROM competition_grid_claims claim
        CROSS JOIN cell_ranges range
        WHERE claim.x BETWEEN range.min_x AND range.max_x
          AND claim.y BETWEEN range.min_y AND range.max_y
          ${competitionMonth
            ? sql`AND claim.competition_month = ${competitionMonth}::date`
            : sql``}
      ),
      scoped_pilot_cells AS (
        SELECT pilot.*
        FROM pilot_cells pilot
        WHERE ${input.groupId
          ? sql`EXISTS (
              SELECT 1 FROM pilot_group_memberships membership
              WHERE membership.group_id = ${input.groupId}
                AND membership.user_id = pilot.claim_user
                AND membership.status = 'accepted'
            )`
          : input.scope === 'following' && input.currentUserId
          ? sql`pilot.claim_user = ${input.currentUserId} OR EXISTS (
              SELECT 1 FROM pilot_follows follow
              WHERE follow.follower_user_id = ${input.currentUserId}
                AND follow.followed_user_id = pilot.claim_user
            )`
          : sql`TRUE`}
      ),
      cell_claimants AS (
        SELECT
          x,
          y,
          COUNT(*)::integer AS claimant_count,
          CASE WHEN COUNT(*) = 1 THEN MIN(claim_user::text)::uuid END AS pilot_user_id
        FROM pilot_cells
        GROUP BY x, y
      ),
      selected_cells AS (
        SELECT
          claimant.x,
          claimant.y,
          claimant.claimant_count,
          ${input.pilotUserId
            ? input.groupId
              ? sql`CASE WHEN claimant.claimant_count = 1 THEN ${input.pilotUserId}::uuid END`
              : sql`${input.pilotUserId}::uuid`
            : sql`claimant.pilot_user_id`} AS pilot_user_id
        FROM cell_claimants claimant
        ${input.pilotUserId
          ? sql`INNER JOIN scoped_pilot_cells pilot USING (x, y)`
          : sql``}
        WHERE true
          ${!input.pilotUserId && input.groupId
            ? sql`AND EXISTS (SELECT 1 FROM scoped_pilot_cells pilot WHERE pilot.x = claimant.x AND pilot.y = claimant.y)`
            : !input.pilotUserId && input.scope === 'following' && input.currentUserId
              ? sql`AND EXISTS (SELECT 1 FROM scoped_pilot_cells pilot WHERE pilot.x = claimant.x AND pilot.y = claimant.y)`
              : sql``}
          ${input.pilotUserId
            ? input.groupId
              ? sql`AND pilot.claim_user = ${input.pilotUserId} AND EXISTS (
                  SELECT 1 FROM pilot_group_memberships membership
                  WHERE membership.group_id = ${input.groupId}
                    AND membership.user_id = pilot.claim_user
                    AND membership.status = 'accepted'
                )`
              : sql`AND pilot.claim_user = ${input.pilotUserId}`
            : sql``}
      ),
      scoped_cells AS (
        SELECT selected.*
        FROM selected_cells selected
        ${input.arenaId
          ? sql`INNER JOIN arenas arena ON arena.id = ${input.arenaId}
              AND ${arenaCellOwnershipPredicateSql({ arenaId: sql`arena.id`, arenaType: sql`arena.arena_type`, externalId: sql`arena.external_id`, area: sql`arena.area`, cellCenter: claimCellCenterSql({ x: sql`selected.x`, y: sql`selected.y`, cellSize: sql`${cellSize}` }) })}`
          : sql``}
      ),
      clipped_features AS (
        SELECT
          concat(${cellSize}::integer, ':', x, ':', y) AS "cellId",
          ${cellSize}::integer AS "cellSize",
          x::integer AS x,
          y::integer AS y,
          claimant_count::integer AS "claimantCount",
          claimant_count > 1 AS "isShared",
          pilot_user_id::text AS "pilotUserId",
          ST_AsMVTGeom(
            ST_Transform(ST_MakeEnvelope(
              x * ${cellSize},
              y * ${cellSize},
              (x + 1) * ${cellSize},
              (y + 1) * ${cellSize},
              6933
            ), 3857),
            tile_bounds.geometry,
            ${extent},
            ${buffer},
            true
          ) AS geom
        FROM scoped_cells
        CROSS JOIN tile_bounds
      ),
      mvt_features AS (
        SELECT * FROM clipped_features WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
      )
      SELECT
        COALESCE(ST_AsMVT(mvt_features.*, 'competition-coverage', ${extent}, 'geom'), ''::bytea) AS data,
        COUNT(*)::integer AS "featureCount"
      FROM mvt_features
    `);
    return tileResult(result.rows[0]);
  }

  return {
    async getPersonalTile(input) {
      const competitionMonth = normalizePeriod(input.period);
      const result = await database.execute<StoredTile>(sql`
        WITH ${tileBoundsCtes({ ...input, cellSize, extent, buffer })},
        claimed_cells AS (
          SELECT DISTINCT claim.x, claim.y
          FROM user_grid_claims claim
          INNER JOIN flights flight ON flight.flight_id = claim.claim_flight
          CROSS JOIN cell_ranges range
          WHERE claim.claim_user = ${input.userId}
            AND claim.x BETWEEN range.min_x AND range.max_x
            AND claim.y BETWEEN range.min_y AND range.max_y
            ${competitionMonth
              ? sql`AND date_trunc(
                  'month',
                  claim.claim_timestamp AT TIME ZONE flight.launch_timezone
                )::date = ${competitionMonth}::date`
              : sql``}
        ),
        cell_geometries AS (
          SELECT ST_MakeEnvelope(
            x * ${cellSize},
            y * ${cellSize},
            (x + 1) * ${cellSize},
            (y + 1) * ${cellSize},
            6933
          ) AS geometry
          FROM claimed_cells
        ),
        dissolved AS (
          SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry
          FROM cell_geometries
        ),
        connected_regions AS (
          SELECT region.geom AS geometry
          FROM dissolved
          CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(dissolved.geometry, 3)) region
          WHERE dissolved.geometry IS NOT NULL AND NOT ST_IsEmpty(dissolved.geometry)
        ),
        clipped_features AS (
          SELECT ST_AsMVTGeom(
            ST_Transform(region.geometry, 3857),
            tile_bounds.geometry,
            ${extent},
            ${buffer},
            true
          ) AS geom
          FROM connected_regions region
          CROSS JOIN tile_bounds
        ),
        mvt_features AS (
          SELECT * FROM clipped_features WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
        ),
        exact_cell_clipped_features AS (
          SELECT
            concat(${cellSize}::integer, ':', cell.x, ':', cell.y) AS "cellId",
            cell.x::integer AS x,
            cell.y::integer AS y,
            ST_AsMVTGeom(
              ST_Transform(ST_MakeEnvelope(
                cell.x * ${cellSize},
                cell.y * ${cellSize},
                (cell.x + 1) * ${cellSize},
                (cell.y + 1) * ${cellSize},
                6933
              ), 3857),
              tile_bounds.geometry,
              ${extent},
              ${buffer},
              true
            ) AS geom
          FROM claimed_cells cell
          CROSS JOIN tile_bounds
        ),
        exact_cell_features AS (
          SELECT *
          FROM exact_cell_clipped_features
          WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
        )
        SELECT
          COALESCE((
            SELECT ST_AsMVT(mvt_features.*, 'personal-territory', ${extent}, 'geom')
            FROM mvt_features
          ), ''::bytea) || COALESCE((
            SELECT ST_AsMVT(exact_cell_features.*, 'personal-territory-cells', ${extent}, 'geom')
            FROM exact_cell_features
          ), ''::bytea) AS data,
          (SELECT COUNT(*)::integer FROM mvt_features) AS "featureCount"
      `);
      return tileResult(result.rows[0]);
    },

    getGlobalCompetitionTile(input) {
      return getCompetitionTile(input);
    },

    getArenaCompetitionTile(input) {
      return getCompetitionTile(input);
    },

    getGroupCompetitionTile(input) {
      return getCompetitionTile(input);
    },
  };
}
