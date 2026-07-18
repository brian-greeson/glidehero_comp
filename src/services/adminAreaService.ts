import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';
import type { PolygonGeometry } from '../domain/arena/geoJson.js';
import { normalizedArenaGeometrySql } from './arenaGeometrySql.js';

export type AdminAreaSummary = {
  id: string;
  sourceId: number;
  name: string;
  country: string;
  state: string;
  definitionType?: 'grid' | 'polygon';
};

export type AdminAreaCellFeature = {
  type: 'Feature';
  properties: { x: number; y: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
};

export type AdminAreaDetail = AdminAreaSummary & {
  city: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  timezone: string;
  cellCount: number;
  cells: { type: 'FeatureCollection'; features: AdminAreaCellFeature[] };
  bbox: [number, number, number, number] | null;
};

export type AdminAreaSaveInput = {
  name: string;
  country: string;
  state: string;
  city: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  timezone: string;
  cells: Array<{ x: number; y: number }>;
};

export type AdminLargeAreaSaveInput = {
  name: string;
  country: string;
  state?: string;
  geometries: PolygonGeometry[];
};

export type AdminLargeAreaDetail = AdminAreaSummary & {
  componentCount: number;
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  bbox: [number, number, number, number];
};

export type AdminAreaPreview = { type: 'FeatureCollection'; features: Array<AdminAreaCellFeature & { properties: { x: number; y: number; inside: boolean } }> };

export interface AdminAreaService {
  list(definitionType?: 'grid' | 'polygon'): Promise<AdminAreaSummary[]>;
  get(id: string): Promise<AdminAreaDetail | null>;
  grid(bounds: ViewportBounds): Promise<{ type: 'FeatureCollection'; features: AdminAreaCellFeature[] }>;
  create(input: AdminAreaSaveInput): Promise<{ id: string; sourceId: number }>;
  update(id: string, input: AdminAreaSaveInput): Promise<{ id: string; sourceId: number } | null>;
  getLarge(id: string): Promise<AdminLargeAreaDetail | null>;
  createLarge(input: AdminLargeAreaSaveInput): Promise<AdminLargeAreaDetail>;
  updateLarge(id: string, input: AdminLargeAreaSaveInput): Promise<AdminLargeAreaDetail | null>;
  preview(bounds: ViewportBounds, geometries: PolygonGeometry[]): Promise<AdminAreaPreview>;
}

type AreaRow = AdminAreaSummary & {
  city: string;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
  timezone: string;
};

type CellRow = { x: number; y: number; geometry: AdminAreaCellFeature['geometry'] };
const MAX_EDITOR_GRID_CELLS = 10_000;

function feature(row: CellRow): AdminAreaCellFeature {
  return {
    type: 'Feature',
    properties: { x: row.x, y: row.y },
    geometry: row.geometry,
  };
}

export function createAdminAreaService(database: Database, options: { cellSize: number }): AdminAreaService {
  const { cellSize } = options;
  function validateCells(cells: AdminAreaSaveInput['cells']) {
    if (!cells.length) throw new RangeError('An area must contain at least one cell.');
    if (cells.length > MAX_EDITOR_GRID_CELLS) throw new RangeError('An area cannot contain more than 10,000 cells.');
    const keys = new Set(cells.map(({ x, y }) => `${x}:${y}`));
    if (keys.size !== cells.length) throw new RangeError('Area cells must be unique.');
    if (cells.some(({ x, y }) => !Number.isInteger(x) || !Number.isInteger(y))) throw new RangeError('Area cells must use integer coordinates.');
  }

  async function get(id: string): Promise<AdminAreaDetail | null> {
    const areaResult = await database.execute<AreaRow>(sql`
      SELECT
        id,
        source_id::integer AS "sourceId",
        name,
        country,
        state,
        city,
        ST_Y(location)::double precision AS latitude,
        ST_X(location)::double precision AS longitude,
        altitude_meters AS "altitudeMeters",
        timezone
      FROM arenas
      WHERE id = ${id} AND definition_type = 'grid'
      LIMIT 1
    `);
    const area = areaResult.rows[0];
    if (!area) return null;

    const cellsResult = await database.execute<CellRow & {
      west: number;
      south: number;
      east: number;
      north: number;
    }>(sql`
      WITH arena AS (
        SELECT area FROM arenas WHERE id = ${id} AND definition_type = 'grid'
      ), cells AS (
        SELECT
          grid.x::integer AS x,
          grid.y::integer AS y,
          grid.geom AS geometry
        FROM arena
        CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, ST_Envelope(arena.area)) AS grid(geom, x, y)
        WHERE ST_Covers(arena.area, ST_SetSRID(ST_MakePoint(
          (grid.x + 0.5) * ${cellSize}, (grid.y + 0.5) * ${cellSize}
        ), 6933))
        LIMIT ${MAX_EDITOR_GRID_CELLS + 1}
      ), bounds AS (
        SELECT ST_Envelope(ST_Collect(geometry)) AS geometry FROM cells
      )
      SELECT
        cells.x,
        cells.y,
        ST_AsGeoJSON(ST_Transform(cells.geometry, 4326))::jsonb AS geometry,
        ST_XMin(ST_Transform(bounds.geometry, 4326))::double precision AS west,
        ST_YMin(ST_Transform(bounds.geometry, 4326))::double precision AS south,
        ST_XMax(ST_Transform(bounds.geometry, 4326))::double precision AS east,
        ST_YMax(ST_Transform(bounds.geometry, 4326))::double precision AS north
      FROM cells CROSS JOIN bounds
      ORDER BY cells.x, cells.y
    `);
    const cells = cellsResult.rows.map(feature);
    const first = cellsResult.rows[0];
    return {
      ...area,
      cellCount: cells.length,
      cells: { type: 'FeatureCollection', features: cells },
      bbox: first ? [first.west, first.south, first.east, first.north] : null,
    };
  }

  async function save(
    transaction: Parameters<Parameters<Database['transaction']>[0]>[0],
    id: string,
    input: AdminAreaSaveInput,
  ) {
    validateCells(input.cells);
    const updated = await transaction.execute<{ id: string; sourceId: number }>(sql`
      WITH cells(x, y) AS (VALUES ${sql.join(
        input.cells.map((cell) => sql`(${cell.x}::integer, ${cell.y}::integer)`),
        sql`, `,
      )}), normalized AS (
        SELECT ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(
          ST_MakeEnvelope(
            x * ${cellSize}, y * ${cellSize},
            (x + 1) * ${cellSize}, (y + 1) * ${cellSize}, 6933
          )
        )), 3))::geometry(multipolygon, 6933) AS area
        FROM cells
      )
      UPDATE arenas
      SET
        name = ${input.name},
        country = ${input.country},
        state = ${input.state},
        city = ${input.city},
        location = ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
        altitude_meters = ${input.altitudeMeters},
        timezone = ${input.timezone},
        definition_type = 'grid',
        area = normalized.area
      FROM normalized
      WHERE id = ${id}
      RETURNING id, source_id::integer AS "sourceId"
    `);
    const area = updated.rows[0];
    if (!area) return null;

    return area;
  }

  return {
    async list(definitionType = 'grid') {
      const result = await database.execute<AdminAreaSummary>(sql`
        SELECT id, source_id::integer AS "sourceId", name, country, COALESCE(state, '') AS state,
          definition_type AS "definitionType"
        FROM arenas
        WHERE definition_type = ${definitionType}
        ORDER BY lower(name), lower(country), lower(state), source_id
      `);
      return result.rows;
    },

    get,

    async grid(bounds) {
      const estimate = await database.execute<{ cellCount: string }>(sql`
        WITH ${viewportCtes(bounds)}
        SELECT COALESCE(SUM(
          (floor(ST_XMax(geometry) / ${cellSize}) - floor(ST_XMin(geometry) / ${cellSize}) + 2)::bigint
          *
          (floor(ST_YMax(geometry) / ${cellSize}) - floor(ST_YMin(geometry) / ${cellSize}) + 2)::bigint
        ), 0)::bigint AS "cellCount"
        FROM viewport_parts
      `);
      if (Number(estimate.rows[0]?.cellCount ?? 0) > MAX_EDITOR_GRID_CELLS) {
        throw new RangeError('Zoom in to edit game cells.');
      }
      const result = await database.execute<CellRow>(sql`
        WITH ${viewportCtes(bounds)}
        SELECT
          grid.x::integer AS x,
          grid.y::integer AS y,
          ST_AsGeoJSON(ST_Transform(grid.geom, 4326))::jsonb AS geometry
        FROM viewport_parts
        CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, viewport_parts.geometry) AS grid(geom, x, y)
        WHERE ST_Intersects(grid.geom, viewport_parts.geometry)
        ORDER BY grid.x, grid.y
      `);
      return { type: 'FeatureCollection', features: result.rows.map(feature) };
    },

    async create(input) {
      validateCells(input.cells);
      return database.transaction(async (transaction) => {
        const inserted = await transaction.execute<{ id: string; sourceId: number }>(sql`
          WITH cells(x, y) AS (VALUES ${sql.join(
            input.cells.map((cell) => sql`(${cell.x}::integer, ${cell.y}::integer)`),
            sql`, `,
          )}), normalized AS (
            SELECT ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(
              ST_MakeEnvelope(
                x * ${cellSize}, y * ${cellSize},
                (x + 1) * ${cellSize}, (y + 1) * ${cellSize}, 6933
              )
            )), 3))::geometry(multipolygon, 6933) AS area FROM cells
          )
          INSERT INTO arenas (
            source_id, name, country, state, city, location, altitude_meters, timezone, definition_type, area
          ) SELECT
            nextval('arena_source_id_seq'),
            ${input.name},
            ${input.country},
            ${input.state},
            ${input.city},
            ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
            ${input.altitudeMeters},
            ${input.timezone}, 'grid', normalized.area
          FROM normalized
          RETURNING id, source_id::integer AS "sourceId"
        `);
        const area = inserted.rows[0];
        if (!area) throw new Error('Unable to create Arena.');
        return area;
      });
    },

    async update(id, input) {
      return database.transaction((transaction) => save(transaction, id, input));
    },

    async getLarge(id) {
      const result = await database.execute<AdminLargeAreaDetail>(sql`
        WITH selected AS (
          SELECT arena.*, ST_Transform(area, 4326) AS wgs84 FROM arenas arena
          WHERE id = ${id} AND definition_type = 'polygon' LIMIT 1
        ), display AS (
          SELECT selected.*, CASE
            WHEN ST_XMax(ST_Envelope(wgs84)) - ST_XMin(ST_Envelope(wgs84))
              <= ST_XMax(ST_Envelope(ST_ShiftLongitude(wgs84))) - ST_XMin(ST_Envelope(ST_ShiftLongitude(wgs84)))
            THEN wgs84 ELSE ST_ShiftLongitude(wgs84) END AS display_geometry
          FROM selected
        )
        SELECT id, source_id::integer AS "sourceId", name, country, COALESCE(state, '') AS state,
          definition_type AS "definitionType", ST_NumGeometries(area)::integer AS "componentCount",
          ST_AsGeoJSON(display_geometry)::jsonb AS geometry,
          ST_XMin(ST_Envelope(display_geometry))::double precision AS west,
          ST_YMin(ST_Envelope(display_geometry))::double precision AS south,
          ST_XMax(ST_Envelope(display_geometry))::double precision AS east,
          ST_YMax(ST_Envelope(display_geometry))::double precision AS north
        FROM display
      `);
      const row = result.rows[0] as (AdminLargeAreaDetail & { west: number; south: number; east: number; north: number }) | undefined;
      return row ? { ...row, bbox: [row.west, row.south, row.east, row.north] } : null;
    },

    async createLarge(input) {
      const id = await database.transaction(async (transaction) => {
        const result = await transaction.execute<{ id: string }>(sql`
          INSERT INTO arenas (source_id, name, country, state, definition_type, area)
          SELECT nextval('arena_source_id_seq'), ${input.name}, ${input.country}, ${input.state ?? null}, 'polygon', geometry.area
          FROM (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area) geometry
          WHERE geometry.area IS NOT NULL AND NOT ST_IsEmpty(geometry.area) AND ST_IsValid(geometry.area)
          RETURNING id
        `);
        if (!result.rows[0]) throw new RangeError('Arena geometry must contain at least one valid polygon.');
        return result.rows[0].id;
      });
      const saved = await this.getLarge(id);
      if (!saved) throw new Error('Unable to reload Large Arena.');
      return saved;
    },

    async updateLarge(id, input) {
      const updated = await database.transaction(async (transaction) => {
        const result = await transaction.execute<{ id: string }>(sql`
          UPDATE arenas SET name = ${input.name}, country = ${input.country}, state = ${input.state ?? null},
            definition_type = 'polygon', area = geometry.area
          FROM (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area) geometry
          WHERE arenas.id = ${id} AND arenas.definition_type = 'polygon'
            AND geometry.area IS NOT NULL AND NOT ST_IsEmpty(geometry.area) AND ST_IsValid(geometry.area)
          RETURNING arenas.id
        `);
        return Boolean(result.rows[0]);
      });
      return updated ? this.getLarge(id) : null;
    },

    async preview(bounds, geometries) {
      const estimate = await database.execute<{ cellCount: string }>(sql`
        WITH ${viewportCtes(bounds)}
        SELECT COALESCE(SUM((floor(ST_XMax(geometry) / ${cellSize}) - floor(ST_XMin(geometry) / ${cellSize}) + 2)::bigint
          * (floor(ST_YMax(geometry) / ${cellSize}) - floor(ST_YMin(geometry) / ${cellSize}) + 2)::bigint), 0)::bigint AS "cellCount"
        FROM viewport_parts
      `);
      if (Number(estimate.rows[0]?.cellCount ?? 0) > MAX_EDITOR_GRID_CELLS) throw new RangeError('Zoom in to preview Arena cells.');
      const result = await database.execute<CellRow & { inside: boolean }>(sql`
        WITH ${viewportCtes(bounds)}, draft AS (SELECT ${normalizedArenaGeometrySql(geometries)} AS area), cells AS (
          SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y, grid.geom
          FROM viewport_parts viewport
          CROSS JOIN LATERAL ST_SquareGrid(${cellSize}, viewport.geometry) AS grid(geom, x, y)
          WHERE ST_Intersects(grid.geom, viewport.geometry)
        )
        SELECT cells.x, cells.y, ST_Covers(draft.area, ST_SetSRID(ST_MakePoint(
          (cells.x + 0.5) * ${cellSize}, (cells.y + 0.5) * ${cellSize}
        ), 6933)) AS inside,
          ST_AsGeoJSON(ST_Transform(cells.geom, 4326))::jsonb AS geometry
        FROM cells CROSS JOIN draft ORDER BY cells.x, cells.y
      `);
      return { type: 'FeatureCollection', features: result.rows.map((row) => ({
        type: 'Feature', properties: { x: row.x, y: row.y, inside: row.inside }, geometry: row.geometry,
      })) };
    },
  };
}
