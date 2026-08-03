import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import type { ThermalActivityBand } from '../domain/thermal/thermalVectorizer.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

export type ProcessedThermalAreaGeoJson = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: {
      activityBand: ThermalActivityBand;
      relativeScore: number;
      processedAt: string;
    };
    geometry: GeoJSON.MultiPolygon;
  }>;
};

export type ProcessedThermalAreaViewportResult =
  | { status: 'ok'; geojson: ProcessedThermalAreaGeoJson }
  | { status: 'too_large' };

export interface ThermalAreaMapService {
  getViewport(bounds: ViewportBounds): Promise<ProcessedThermalAreaViewportResult>;
}

type StoredThermalArea = {
  activityBand: ThermalActivityBand;
  relativeScore: number;
  processedAt: string;
  geometry: GeoJSON.MultiPolygon;
};

export function createThermalAreaMapService(
  database: Database,
  options: { maximumFeatures?: number } = {},
): ThermalAreaMapService {
  const maximumFeatures = options.maximumFeatures ?? 5_000;

  return {
    async getViewport(bounds) {
      const result = await database.execute<StoredThermalArea>(sql`
        WITH ${viewportCtes(bounds)}
        SELECT
          area.activity_band AS "activityBand",
          area.relative_score AS "relativeScore",
          tile.processed_at AS "processedAt",
          ST_AsGeoJSON(area.geometry)::jsonb AS geometry
        FROM thermal_areas area
        JOIN thermal_raster_tiles tile ON tile.id = area.raster_tile_id
        WHERE tile.processing_status = 'complete'
          AND tile.processed_at IS NOT NULL
          AND area.processing_version = tile.processing_version
          AND EXISTS (
            SELECT 1
            FROM viewport_parts viewport
            WHERE ST_Intersects(area.geometry, ST_Transform(viewport.geometry, 4326))
          )
        LIMIT ${maximumFeatures + 1}
      `);
      if (result.rows.length > maximumFeatures) return { status: 'too_large' };
      return {
        status: 'ok',
        geojson: {
          type: 'FeatureCollection',
          features: result.rows.map((row) => ({
            type: 'Feature',
            properties: {
              activityBand: row.activityBand,
              relativeScore: Number(row.relativeScore),
              processedAt: new Date(row.processedAt).toISOString(),
            },
            geometry: row.geometry,
          })),
        },
      };
    },
  };
}
