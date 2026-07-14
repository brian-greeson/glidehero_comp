import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims, userGridClaims } from '../db/schema.js';
import {
  emptyGridClaimGeoJson,
  type GridClaimGeoJson,
} from '../domain/territory/gridClaimGeoJson.js';

export type GridClaimProcessResult = {
  flightId: string;
  cellSize: number;
  directCellCount: number;
  enclosedCellCount: number;
};

export interface GridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<GridClaimProcessResult>;
  get(input: { userId: string }): Promise<GridClaimGeoJson>;
}

type ProcessCounts = {
  directCellCount: number;
  enclosedCellCount: number;
};

type StoredProjection = { geojson: GridClaimGeoJson };

export function createGridClaimService(
  database: Database,
  options: { cellSize: number },
): GridClaimService {
  const { cellSize } = options;

  return {
    async process({ flightId, userId, launchTimezone }) {
      return database.transaction(async (tx) => {
        await tx.delete(userGridClaims).where(and(
          eq(userGridClaims.claimFlight, flightId),
          eq(userGridClaims.cellSize, cellSize),
        ));
        await tx.delete(competitionGridClaims).where(and(
          eq(competitionGridClaims.claimFlight, flightId),
          eq(competitionGridClaims.cellSize, cellSize),
        ));

        const result = await tx.execute<ProcessCounts>(sql`
          WITH ordered_points AS (
            SELECT
              longitude,
              latitude,
              recorded_at,
              sequence_number,
              LEAD(longitude) OVER (ORDER BY sequence_number) AS next_longitude,
              LEAD(latitude) OVER (ORDER BY sequence_number) AS next_latitude,
              LEAD(recorded_at) OVER (ORDER BY sequence_number) AS next_recorded_at
            FROM track_points
            WHERE flight_id = ${flightId}
          ),
          segments AS (
            SELECT
              sequence_number AS segment_id,
              ST_Transform(
                ST_MakeLine(
                  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
                  ST_SetSRID(ST_MakePoint(next_longitude, next_latitude), 4326)
                ),
                6933
              ) AS segment,
              next_recorded_at AS segment_timestamp
            FROM ordered_points
            WHERE next_longitude IS NOT NULL
              AND next_latitude IS NOT NULL
              AND next_recorded_at IS NOT NULL
          ),
          densified_segments AS (
            SELECT
              segment_id,
              ST_Segmentize(segment, ${cellSize}) AS segment,
              segment_timestamp
            FROM segments
          ),
          densified_points AS (
            SELECT
              segment_id,
              point_dump.path[1] AS point_index,
              point_dump.geom AS point,
              segment_timestamp
            FROM densified_segments
            CROSS JOIN LATERAL ST_DumpPoints(segment) AS point_dump
          ),
          split_segments AS (
            SELECT
              ST_MakeLine(
                point,
                LEAD(point) OVER (PARTITION BY segment_id ORDER BY point_index)
              ) AS segment,
              segment_timestamp
            FROM densified_points
          ),
          direct_hits AS (
            SELECT grid.x::integer AS x, grid.y::integer AS y, segment_timestamp
            FROM split_segments
            CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, ST_Envelope(segment)) AS grid(geom, x, y)
            WHERE segment IS NOT NULL
              AND ST_Intersects(segment, grid.geom)
          ),
          direct_cells AS (
            SELECT
              x,
              y,
              MIN(segment_timestamp) AS first_claimed_at,
              MAX(segment_timestamp) AS latest_claimed_at,
              ST_MakeEnvelope(
                x * ${cellSize},
                y * ${cellSize},
                (x + 1) * ${cellSize},
                (y + 1) * ${cellSize},
                6933
              ) AS geometry
            FROM direct_hits
            GROUP BY x, y
          ),
          flight_cell_union AS (
            SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry
            FROM direct_cells
          ),
          union_polygons AS (
            SELECT polygon_dump.geom AS geometry
            FROM flight_cell_union
            CROSS JOIN LATERAL ST_Dump(flight_cell_union.geometry) AS polygon_dump
          ),
          hole_rings AS (
            SELECT ST_ExteriorRing(ring_dump.geom) AS geometry
            FROM union_polygons
            CROSS JOIN LATERAL ST_DumpRings(union_polygons.geometry) AS ring_dump
            WHERE ring_dump.path[1] > 0
          ),
          holes AS (
            SELECT ST_MakePolygon(geometry) AS geometry
            FROM hole_rings
          ),
          hole_boundaries AS (
            SELECT holes.geometry, boundary_cells.claim_timestamp
            FROM holes
            CROSS JOIN LATERAL (
              SELECT MAX(direct_cells.first_claimed_at) AS claim_timestamp
              FROM direct_cells
              WHERE direct_cells.geometry && holes.geometry
                AND ST_Length(
                ST_Intersection(ST_Boundary(direct_cells.geometry), ST_Boundary(holes.geometry))
              ) > 0
            ) AS boundary_cells
            WHERE boundary_cells.claim_timestamp IS NOT NULL
          ),
          enclosed_candidates AS (
            SELECT grid.x::integer AS x, grid.y::integer AS y, hole_boundaries.claim_timestamp
            FROM hole_boundaries
            CROSS JOIN LATERAL ST_SquareGrid(
              ${cellSize},
              ST_Envelope(hole_boundaries.geometry)
            ) AS grid(geom, x, y)
            WHERE ST_Covers(hole_boundaries.geometry, grid.geom)
          ),
          candidate_events AS (
            SELECT x, y, segment_timestamp AS claim_timestamp
            FROM direct_hits
            UNION ALL
            SELECT x, y, claim_timestamp
            FROM enclosed_candidates
          ),
          personal_winning_candidates AS (
            SELECT x, y, MAX(claim_timestamp) AS claim_timestamp
            FROM candidate_events
            GROUP BY x, y
          ),
          competition_events AS (
            SELECT
              date_trunc(
                'month',
                claim_timestamp AT TIME ZONE ${launchTimezone}
              )::date AS competition_month,
              x,
              y,
              claim_timestamp
            FROM candidate_events
          ),
          competition_winning_candidates AS (
            SELECT competition_month, x, y, MAX(claim_timestamp) AS claim_timestamp
            FROM competition_events
            GROUP BY competition_month, x, y
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
              ${flightId},
              ${userId},
              claim_timestamp
            FROM competition_winning_candidates
            ON CONFLICT (competition_month, cell_size, x, y, claim_flight) DO UPDATE
            SET
              claim_user = EXCLUDED.claim_user,
              claim_timestamp = EXCLUDED.claim_timestamp
            RETURNING competition_month, x, y
          ),
          personal_upserted AS (
            INSERT INTO user_grid_claims (
              cell_size,
              x,
              y,
              claim_flight,
              claim_user,
              claim_timestamp
            )
            SELECT ${cellSize}, x, y, ${flightId}, ${userId}, claim_timestamp
            FROM personal_winning_candidates
            ON CONFLICT (cell_size, x, y) DO UPDATE
            SET
              claim_flight = EXCLUDED.claim_flight,
              claim_user = EXCLUDED.claim_user,
              claim_timestamp = EXCLUDED.claim_timestamp
            WHERE user_grid_claims.claim_timestamp < EXCLUDED.claim_timestamp
            RETURNING x, y
          )
          SELECT
            (SELECT count(*)::integer FROM direct_cells) AS "directCellCount",
            (SELECT count(*)::integer FROM enclosed_candidates) AS "enclosedCellCount"
        `);
        const counts = result.rows[0] ?? { directCellCount: 0, enclosedCellCount: 0 };

        return {
          flightId,
          cellSize,
          directCellCount: counts.directCellCount,
          enclosedCellCount: counts.enclosedCellCount,
        };
      });
    },

    async get({ userId }) {
      const result = await database.execute<StoredProjection>(sql`
        WITH claimed_cells AS (
          SELECT ST_MakeEnvelope(
            x * ${cellSize}, y * ${cellSize},
            (x + 1) * ${cellSize}, (y + 1) * ${cellSize},
            6933
          ) AS geometry
          FROM user_grid_claims
          WHERE claim_user = ${userId}
            AND cell_size = ${cellSize}
        ),
        dissolved AS (
          SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry
          FROM claimed_cells
        ),
        connected_regions AS (
          SELECT region.geom AS geometry
          FROM dissolved
          CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(dissolved.geometry, 3)) AS region
          WHERE dissolved.geometry IS NOT NULL
            AND NOT ST_IsEmpty(dissolved.geometry)
        )
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'properties', '{}'::jsonb,
                'geometry', ST_AsGeoJSON(
                  ST_Transform(geometry, 4326)
                )::jsonb
              )
              ORDER BY ST_XMin(geometry), ST_YMin(geometry)
            ),
            '[]'::jsonb
          )
        ) AS geojson
        FROM connected_regions
      `);

      return result.rows[0]?.geojson ?? emptyGridClaimGeoJson();
    },
  };
}
