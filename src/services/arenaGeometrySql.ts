import { sql } from 'drizzle-orm';
import type { PolygonGeometry } from '../domain/arena/geoJson.js';

export function claimCellCenterSql(input: { x: ReturnType<typeof sql>; y: ReturnType<typeof sql>; cellSize: ReturnType<typeof sql> }) {
  return sql`ST_SetSRID(ST_MakePoint(
    (${input.x} + 0.5) * ${input.cellSize},
    (${input.y} + 0.5) * ${input.cellSize}
  ), 6933)`;
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
