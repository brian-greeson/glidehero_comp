import { sql } from 'drizzle-orm';
import type { PolygonGeometry } from '../domain/arena/geoJson.js';
import type { Database } from '../db/client.js';
import { normalizedArenaGeometrySql } from './arenaGeometrySql.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

export type AdminAreaSummary = {
  id: string;
  sourceId: number;
  name: string;
  country: string;
  state: string;
  city: string;
};

export type AdminAreaSaveInput = {
  name: string;
  country: string;
  state?: string;
  city?: string;
  geometries: PolygonGeometry[];
};

export type AdminAreaDetail = AdminAreaSummary & {
  componentCount: number;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  bbox: [number, number, number, number];
};

export type AdminAreaCellFeature = {
  type: 'Feature';
  properties: { x: number; y: number; inside: boolean };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};

export type AdminAreaPreview = {
  type: 'FeatureCollection';
  features: AdminAreaCellFeature[];
};

export interface AdminAreaService {
  list(): Promise<AdminAreaSummary[]>;
  get(id: string): Promise<AdminAreaDetail | null>;
  create(input: AdminAreaSaveInput): Promise<AdminAreaDetail>;
  update(id: string, input: AdminAreaSaveInput): Promise<AdminAreaDetail | null>;
  preview(bounds: ViewportBounds, geometries: PolygonGeometry[]): Promise<AdminAreaPreview>;
}

type PreviewRow = {
  x: number;
  y: number;
  inside: boolean;
  geometry: AdminAreaCellFeature['geometry'];
};

const MAX_EDITOR_GRID_CELLS = 10_000;

export function createAdminAreaService(database: Database, options: { cellSize: number }): AdminAreaService {
  const { cellSize } = options;

  async function get(id: string): Promise<AdminAreaDetail | null> {
    const result = await database.execute<AdminAreaDetail & {
      west: number;
      south: number;
      east: number;
      north: number;
    }>(sql`
      WITH selected AS (
        SELECT arena.*, ST_Transform(area, 4326) AS wgs84
        FROM arenas arena
        WHERE id = ${id}
        LIMIT 1
      ), display AS (
        SELECT selected.*, CASE
          WHEN ST_XMax(ST_Envelope(wgs84)) - ST_XMin(ST_Envelope(wgs84))
            <= ST_XMax(ST_Envelope(ST_ShiftLongitude(wgs84))) - ST_XMin(ST_Envelope(ST_ShiftLongitude(wgs84)))
          THEN wgs84 ELSE ST_ShiftLongitude(wgs84)
        END AS display_geometry
        FROM selected
      )
      SELECT
        id,
        source_id::integer AS "sourceId",
        name,
        country,
        COALESCE(state, '') AS state,
        COALESCE(city, '') AS city,
        ST_NumGeometries(area)::integer AS "componentCount",
        ST_AsGeoJSON(display_geometry)::jsonb AS geometry,
        ST_XMin(ST_Envelope(display_geometry))::double precision AS west,
        ST_YMin(ST_Envelope(display_geometry))::double precision AS south,
        ST_XMax(ST_Envelope(display_geometry))::double precision AS east,
        ST_YMax(ST_Envelope(display_geometry))::double precision AS north
      FROM display
    `);
    const row = result.rows[0];
    return row ? { ...row, bbox: [row.west, row.south, row.east, row.north] } : null;
  }

  return {
    async list() {
      const result = await database.execute<AdminAreaSummary>(sql`
        SELECT id, source_id::integer AS "sourceId", name, country,
          COALESCE(state, '') AS state, COALESCE(city, '') AS city
        FROM arenas
        ORDER BY lower(name), lower(country), lower(state), source_id
      `);
      return result.rows;
    },

    get,

    async create(input) {
      const result = await database.execute<{ id: string }>(sql`
        INSERT INTO arenas (source_id, name, country, state, city, area)
        SELECT nextval('arena_source_id_seq'), ${input.name}, ${input.country},
          ${input.state || null}, ${input.city || null}, geometry.area
        FROM (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area) geometry
        WHERE geometry.area IS NOT NULL AND NOT ST_IsEmpty(geometry.area) AND ST_IsValid(geometry.area)
        RETURNING id
      `);
      const id = result.rows[0]?.id;
      if (!id) throw new RangeError('Arena geometry must contain at least one valid polygon.');
      const saved = await get(id);
      if (!saved) throw new Error('Unable to reload Arena.');
      return saved;
    },

    async update(id, input) {
      const result = await database.execute<{ id: string }>(sql`
        UPDATE arenas
        SET name = ${input.name}, country = ${input.country}, state = ${input.state || null},
          city = ${input.city || null}, area = geometry.area
        FROM (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area) geometry
        WHERE arenas.id = ${id}
          AND geometry.area IS NOT NULL AND NOT ST_IsEmpty(geometry.area) AND ST_IsValid(geometry.area)
        RETURNING arenas.id
      `);
      return result.rows[0] ? get(id) : null;
    },

    async preview(bounds, geometries) {
      const estimate = await database.execute<{ cellCount: string }>(sql`
        WITH ${viewportCtes(bounds)}
        SELECT COALESCE(SUM(
          (floor(ST_XMax(geometry) / ${cellSize}) - floor(ST_XMin(geometry) / ${cellSize}) + 2)::bigint
          * (floor(ST_YMax(geometry) / ${cellSize}) - floor(ST_YMin(geometry) / ${cellSize}) + 2)::bigint
        ), 0)::bigint AS "cellCount"
        FROM viewport_parts
      `);
      if (Number(estimate.rows[0]?.cellCount ?? 0) > MAX_EDITOR_GRID_CELLS) {
        throw new RangeError('Zoom in to preview Arena cells.');
      }
      const result = await database.execute<PreviewRow>(sql`
        WITH ${viewportCtes(bounds)}, draft AS (
          SELECT ${normalizedArenaGeometrySql(geometries)} AS area
        ), cells AS (
          SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y, grid.geom
          FROM viewport_parts viewport
          CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, viewport.geometry) AS grid(geom, x, y)
          WHERE ST_Intersects(grid.geom, viewport.geometry)
        )
        SELECT
          cells.x,
          cells.y,
          ST_Covers(draft.area, ST_SetSRID(ST_MakePoint(
            (cells.x + 0.5) * ${cellSize}, (cells.y + 0.5) * ${cellSize}
          ), 6933)) AS inside,
          ST_AsGeoJSON(ST_Transform(cells.geom, 4326))::jsonb AS geometry
        FROM cells CROSS JOIN draft
        ORDER BY cells.x, cells.y
      `);
      return {
        type: 'FeatureCollection',
        features: result.rows.map((row) => ({
          type: 'Feature',
          properties: { x: row.x, y: row.y, inside: row.inside },
          geometry: row.geometry,
        })),
      };
    },
  };
}
