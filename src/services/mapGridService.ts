import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { MapGridCellFeature, MapGridGeoJson } from '../domain/territory/mapGridGeoJson.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

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
  getArena(input: { launchAreaId: string }): Promise<MapGridGeoJson>;
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

    async getArena({ launchAreaId }) {
      const result = await database.execute<StoredCell>(sql`
        SELECT
          cell.x::integer AS x,
          cell.y::integer AS y,
          ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(
            cell.x * cell.cell_size,
            cell.y * cell.cell_size,
            (cell.x + 1) * cell.cell_size,
            (cell.y + 1) * cell.cell_size,
            6933
          ), 4326))::jsonb AS geometry
        FROM launch_area_cells cell
        WHERE cell.launch_area_id = ${launchAreaId}
          AND cell.cell_size = ${cellSize}
        ORDER BY cell.x, cell.y
      `);
      return geojson(result.rows, cellSize);
    },
  };
}
