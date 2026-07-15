import { sql, type SQL } from 'drizzle-orm';

export function gridClaimCandidateCtes(input: { flightId: string; cellSize: number }): SQL {
  const { flightId, cellSize } = input;

  return sql`
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
    )
  `;
}
