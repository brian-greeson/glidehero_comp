import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { MapGridCellFeature, MapGridGeoJson } from '../domain/territory/mapGridGeoJson.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';
import { claimCellCenterSql } from './arenaGeometrySql.js';

type StoredCell = {
  x: number;
  y: number;
  geometry: MapGridCellFeature['geometry'];
};

export type ViewportGridResult =
  | { status: 'ok'; geojson: MapGridGeoJson }
  | { status: 'too_large' };

export interface MapGridService {
  getViewport(bounds: ViewportBounds): Promise<ViewportGridResult>;
  getArena(input: { arenaId: string } & ViewportBounds): Promise<ViewportGridResult>;
}

function geojson(rows: StoredCell[], cellSize: number): MapGridGeoJson {
  return {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      properties: { cellSize, x: row.x, y: row.y },
      geometry: row.geometry,
    })),
  };
}

export function createMapGridService(
  database: Database,
  options: { cellSize: number; maxViewportCells?: number },
): MapGridService {
  const { cellSize, maxViewportCells = 5_000 } = options;

  return {
    async getViewport(bounds) {
      const result = await database.execute<StoredCell>(sql`
        WITH ${viewportCtes(bounds)},
        cells AS (
          SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y, grid.geom
          FROM viewport_parts viewport
          CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, viewport.geometry) AS grid(geom, x, y)
          WHERE ST_Intersects(grid.geom, viewport.geometry)
        )
        SELECT x, y, ST_AsGeoJSON(ST_Transform(geom, 4326))::jsonb AS geometry
        FROM cells
        ORDER BY x, y
        LIMIT ${maxViewportCells + 1}
      `);
      if (result.rows.length > maxViewportCells) return { status: 'too_large' };
      return { status: 'ok', geojson: geojson(result.rows, cellSize) };
    },

    async getArena({ arenaId, ...bounds }) {
      const result = await database.execute<StoredCell>(sql`
        WITH ${viewportCtes(bounds)},
        cells AS (
          SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y, grid.geom
          FROM arenas arena
          CROSS JOIN viewport_parts viewport
          CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, viewport.geometry) AS grid(geom, x, y)
          WHERE arena.id = ${arenaId}
            AND ST_Intersects(grid.geom, viewport.geometry)
            AND ST_Covers(arena.area, ${claimCellCenterSql({ x: sql`grid.x`, y: sql`grid.y`, cellSize: sql`${cellSize}` })})
        )
        SELECT x, y, ST_AsGeoJSON(ST_Transform(geom, 4326))::jsonb AS geometry
        FROM cells ORDER BY x, y LIMIT ${maxViewportCells + 1}
      `);
      if (result.rows.length > maxViewportCells) return { status: 'too_large' };
      return { status: 'ok', geojson: geojson(result.rows, cellSize) };
    },
  };
}
