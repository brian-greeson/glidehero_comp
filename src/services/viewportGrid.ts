import { sql } from 'drizzle-orm';

export type ViewportBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function viewportCtes(input: ViewportBounds) {
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
    )
  `;
}
