import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

export type AdminAreaSummary = {
  id: string;
  sourceId: number;
  name: string;
  country: string;
  state: string;
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

export interface AdminAreaService {
  list(): Promise<AdminAreaSummary[]>;
  get(id: string): Promise<AdminAreaDetail | null>;
  grid(bounds: ViewportBounds): Promise<{ type: 'FeatureCollection'; features: AdminAreaCellFeature[] }>;
  create(input: AdminAreaSaveInput): Promise<{ id: string; sourceId: number }>;
  update(id: string, input: AdminAreaSaveInput): Promise<{ id: string; sourceId: number } | null>;
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
      FROM launch_areas
      WHERE id = ${id}
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
      WITH cells AS (
        SELECT
          x,
          y,
          ST_MakeEnvelope(
            x * cell_size,
            y * cell_size,
            (x + 1) * cell_size,
            (y + 1) * cell_size,
            6933
          ) AS geometry
        FROM launch_area_cells
        WHERE launch_area_id = ${id} AND cell_size = ${cellSize}
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
    if (input.cells.length === 0) throw new RangeError('An area must contain at least one cell.');
    const updated = await transaction.execute<{ id: string; sourceId: number }>(sql`
      UPDATE launch_areas
      SET
        name = ${input.name},
        country = ${input.country},
        state = ${input.state},
        city = ${input.city},
        location = ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
        altitude_meters = ${input.altitudeMeters},
        timezone = ${input.timezone}
      WHERE id = ${id}
      RETURNING id, source_id::integer AS "sourceId"
    `);
    const area = updated.rows[0];
    if (!area) return null;

    await transaction.execute(sql`DELETE FROM launch_area_cells WHERE launch_area_id = ${id}`);
    const values = sql.join(
      input.cells.map((cell) => sql`(${id}, ${cellSize}, ${cell.x}, ${cell.y})`),
      sql`, `,
    );
    await transaction.execute(sql`
      INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y)
      VALUES ${values}
    `);
    await transaction.execute(sql`
      UPDATE launch_areas
      SET area = (
        SELECT ST_Multi(
          ST_UnaryUnion(
            ST_Collect(
              ST_MakeEnvelope(
                x * cell_size,
                y * cell_size,
                (x + 1) * cell_size,
                (y + 1) * cell_size,
                6933
              )
            )
          )
        )::geometry(multipolygon, 6933)
        FROM launch_area_cells
        WHERE launch_area_id = ${id} AND cell_size = ${cellSize}
      )
      WHERE id = ${id}
    `);
    return area;
  }

  return {
    async list() {
      const result = await database.execute<AdminAreaSummary>(sql`
        SELECT id, source_id::integer AS "sourceId", name, country, state
        FROM launch_areas
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
      return database.transaction(async (transaction) => {
        const inserted = await transaction.execute<{ id: string; sourceId: number }>(sql`
          INSERT INTO launch_areas (
            source_id, name, country, state, city, location, altitude_meters, timezone, area
          ) VALUES (
            nextval('custom_launch_area_source_id_seq'),
            ${input.name},
            ${input.country},
            ${input.state},
            ${input.city},
            ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326),
            ${input.altitudeMeters},
            ${input.timezone},
            NULL
          )
          RETURNING id, source_id::integer AS "sourceId"
        `);
        const area = inserted.rows[0];
        if (!area) throw new Error('Unable to create launch area.');
        const saved = await save(transaction, area.id, input);
        if (!saved) throw new Error('Unable to save launch area.');
        return saved;
      });
    },

    async update(id, input) {
      return database.transaction((transaction) => save(transaction, id, input));
    },
  };
}
