import { sql } from 'drizzle-orm';
import type { PolygonGeometry } from '../domain/arena/geoJson.js';

type SqlFragment = ReturnType<typeof sql>;

export function claimCellCenterSql(input: { x: ReturnType<typeof sql>; y: ReturnType<typeof sql>; cellSize: ReturnType<typeof sql> }) {
  return sql`ST_SetSRID(ST_MakePoint(
    (${input.x} + 0.5) * ${input.cellSize},
    (${input.y} + 0.5) * ${input.cellSize}
  ), 6933)`;
}

/**
 * Count the configured grid cells whose center is covered by an EPSG:6933
 * Arena geometry.  The count intentionally stays in PostgreSQL: callers
 * should persist this expression rather than materializing cells in Node.
 */
export function claimableCellCountSql(input: { area: ReturnType<typeof sql>; cellSize: ReturnType<typeof sql> }) {
  return sql`(
    WITH components AS (
      SELECT dumped.geom
      FROM ST_Dump(${input.area}) AS dumped
    ), candidate_cells AS (
      SELECT DISTINCT grid.x, grid.y
      FROM components
      CROSS JOIN LATERAL ST_SquareGrid(${input.cellSize}, components.geom) AS grid(geom, x, y)
    )
    SELECT COUNT(*)::bigint
    FROM candidate_cells
    WHERE ST_Covers(
      ${input.area},
      ${claimCellCenterSql({ x: sql`candidate_cells.x`, y: sql`candidate_cells.y`, cellSize: input.cellSize })}
    )
  )`;
}

/**
 * Applies complete canonical Arena membership to a cell center.
 * General Arenas retain raw ST_Covers membership; State and Country Arenas
 * yield to a same-type peer with a lexically lower external_id under the C
 * collation. Launch Arenas are intentionally left unchanged.
 */
export function arenaCellOwnershipPredicateSql(input: {
  arenaId: SqlFragment;
  arenaType: SqlFragment;
  externalId: SqlFragment;
  area: SqlFragment;
  cellCenter: SqlFragment;
}) {
  return sql`(
    ST_Covers(${input.area}, ${input.cellCenter})
    AND (
      ${input.arenaType} NOT IN ('state', 'country')
      OR (
        ${input.externalId} IS NOT NULL
        AND btrim(${input.externalId}) <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM arenas peer
          WHERE peer.arena_type = ${input.arenaType}
            AND peer.id <> ${input.arenaId}
            AND peer.external_id IS NOT NULL
            AND btrim(peer.external_id) <> ''
            AND peer.external_id COLLATE "C" < ${input.externalId} COLLATE "C"
            AND ST_Covers(peer.area, ${input.cellCenter})
        )
      )
    )
  )`;
}

export function normalizedArenaGeometrySql(geometries: PolygonGeometry[]) {
  return sql`(
    SELECT ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(
      ST_CollectionExtract(ST_MakeValid(ST_Transform(ST_Force2D(
        ST_GeomFromGeoJSON(geometry.value::text)
      ), 6933)), 3)
    )), 3))::geometry(multipolygon, 6933)
    FROM jsonb_array_elements(${JSON.stringify(geometries)}::jsonb) AS geometry(value)
  )`;
}
