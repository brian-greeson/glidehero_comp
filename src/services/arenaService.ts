import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { arenaCountryCode, arenaPath, isCanonicalArenaRoute, parseArenaSourceId } from '../domain/arena/arenaRoute.js';
import { buildLiteralSearchPatterns } from '../domain/search/searchSanitizer.js';

export type ArenaSummary = {
  sourceId: number;
  name: string;
  city: string;
  state: string;
  country: string;
  countryCode: string;
  path: string;
};

export type ArenaBoundary = {
  type: 'Feature';
  properties: { sourceId: number; name: string };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  bbox: [number, number, number, number];
};

export type ArenaDetail = ArenaSummary & { id: string; boundary: ArenaBoundary };

export interface ArenaService {
  search(query: string): Promise<ArenaSummary[]>;
  getBySourceId(sourceId: number): Promise<ArenaDetail | null>;
  getByRoute(countryCode: string, routeSlug: string): Promise<ArenaDetail | null>;
}

type StoredArena = {
  id: string;
  sourceId: number;
  name: string;
  city: string;
  state: string;
  country: string;
};

type StoredArenaDetail = StoredArena & {
  geometry: ArenaBoundary['geometry'];
  west: number;
  south: number;
  east: number;
  north: number;
};

function summary(row: StoredArena): ArenaSummary {
  return {
    sourceId: row.sourceId,
    name: row.name,
    city: row.city,
    state: row.state,
    country: row.country,
    countryCode: arenaCountryCode(row.country),
    path: arenaPath(row),
  };
}

function detail(row: StoredArenaDetail): ArenaDetail {
  const arena = summary(row);
  return {
    ...arena,
    id: row.id,
    boundary: {
      type: 'Feature',
      properties: { sourceId: row.sourceId, name: row.name },
      geometry: row.geometry,
      bbox: [row.west, row.south, row.east, row.north],
    },
  };
}

export function createArenaService(database: Database, options: { cellSize: number }): ArenaService {
  const { cellSize } = options;
  async function getBySourceId(sourceId: number): Promise<ArenaDetail | null> {
    const result = await database.execute<StoredArenaDetail>(sql`
      SELECT
        area.id,
        area.source_id::integer AS "sourceId",
        area.name,
        area.city,
        area.state,
        area.country,
        ST_AsGeoJSON(ST_Transform(area.area, 4326))::jsonb AS geometry,
        ST_XMin(ST_Envelope(ST_Transform(area.area, 4326)))::double precision AS west,
        ST_YMin(ST_Envelope(ST_Transform(area.area, 4326)))::double precision AS south,
        ST_XMax(ST_Envelope(ST_Transform(area.area, 4326)))::double precision AS east,
        ST_YMax(ST_Envelope(ST_Transform(area.area, 4326)))::double precision AS north
      FROM launch_areas area
      WHERE area.source_id = ${sourceId}
        AND area.area IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM launch_area_cells cell
          WHERE cell.launch_area_id = area.id AND cell.cell_size = ${cellSize}
        )
      LIMIT 1
    `);
    const row = result.rows[0];
    return row ? detail(row) : null;
  }

  return {
    async search(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const { contains, prefix } = buildLiteralSearchPatterns(trimmed);
      const result = await database.execute<StoredArena>(sql`
        SELECT
          area.id,
          area.source_id::integer AS "sourceId",
          area.name,
          area.city,
          area.state,
          area.country
        FROM launch_areas area
        WHERE area.area IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM launch_area_cells cell
            WHERE cell.launch_area_id = area.id AND cell.cell_size = ${cellSize}
          )
          AND (
            area.name ILIKE ${contains} ESCAPE E'\\\\'
            OR area.city ILIKE ${contains} ESCAPE E'\\\\'
            OR area.state ILIKE ${contains} ESCAPE E'\\\\'
            OR area.country ILIKE ${contains} ESCAPE E'\\\\'
          )
        ORDER BY
          CASE
            WHEN area.name ILIKE ${prefix} ESCAPE E'\\\\' THEN 0
            WHEN area.name ILIKE ${contains} ESCAPE E'\\\\' THEN 1
            ELSE 2
          END,
          lower(area.name), area.source_id
        LIMIT 10
      `);
      return result.rows.map(summary);
    },

    getBySourceId,

    async getByRoute(countryCode, routeSlug) {
      const sourceId = parseArenaSourceId(routeSlug);
      if (sourceId === null) return null;
      const arena = await getBySourceId(sourceId);
      if (!arena || !isCanonicalArenaRoute(arena, countryCode, routeSlug)) return null;
      return arena;
    },
  };
}
