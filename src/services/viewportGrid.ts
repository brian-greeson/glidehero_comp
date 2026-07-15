import { sql } from 'drizzle-orm';

export type ViewportBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function viewportGridCtes(input: ViewportBounds & { cellSize: number }) {
  return sql`
    viewport_parts AS (
      SELECT ST_Transform(ST_MakeEnvelope(${input.west}, ${input.south}, ${input.east}, ${input.north}, 4326), 6933) AS geometry
      WHERE ${input.west} <= ${input.east}
      UNION ALL
      SELECT ST_Transform(ST_MakeEnvelope(${input.west}, ${input.south}, 180, ${input.north}, 4326), 6933) AS geometry
      WHERE ${input.west} > ${input.east}
      UNION ALL
      SELECT ST_Transform(ST_MakeEnvelope(-180, ${input.south}, ${input.east}, ${input.north}, 4326), 6933) AS geometry
      WHERE ${input.west} > ${input.east}
    ),
    viewport_grid_ranges AS (
      SELECT
        (ceil(ST_XMin(geometry) / ${input.cellSize}) - 1)::bigint AS min_x,
        floor(ST_XMax(geometry) / ${input.cellSize})::bigint AS max_x,
        (ceil(ST_YMin(geometry) / ${input.cellSize}) - 1)::bigint AS min_y,
        floor(ST_YMax(geometry) / ${input.cellSize})::bigint AS max_y
      FROM viewport_parts
    ),
    viewport_grid_total AS (
      SELECT COALESCE(SUM(
        (max_x - min_x + 1)::double precision
        * (max_y - min_y + 1)::double precision
      ), 0)::double precision AS visible_cell_count
      FROM viewport_grid_ranges
    )
  `;
}
