import { sql } from 'drizzle-orm';
import type { PolygonGeometry } from '../domain/arena/geoJson.js';
import type { Database } from '../db/client.js';
import { claimableCellCountSql, normalizedArenaGeometrySql } from './arenaGeometrySql.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';
import {
  createArenaLeadershipReconciliationService,
  type ArenaLeadershipReconciliationService,
} from './arenaLeadershipReconciliationService.js';
import { createUserAchievementProgressService } from './userAchievementProgressService.js';

export type AdminAreaSummary = {
  id: string;
  sourceId: number;
  name: string;
  country: string;
  state: string;
  city: string;
  arenaType: 'launch' | 'general' | 'state' | 'country';
  countryCode: string;
};

export type AdminCountryOption = {
  id: string;
  sourceId: number;
  name: string;
  countryCode: string;
};

export type AdminAreaSaveInput = {
  name: string;
  /** Country Arena identifier supplied by the admin editor. */
  countryArenaId: string;
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
  listCountryOptions(): Promise<AdminCountryOption[]>;
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

export function createAdminAreaService(
  database: Database,
  options: { cellSize: number },
  arenaLeadership: ArenaLeadershipReconciliationService = createArenaLeadershipReconciliationService(database, options),
): AdminAreaService {
  const { cellSize } = options;
  const userAchievementProgress = createUserAchievementProgressService(database, options);

  async function resolveCountry(executor: Pick<Database, 'execute'>, countryArenaId: string): Promise<AdminCountryOption> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(countryArenaId)) {
      throw new RangeError('Select a valid Country Arena.');
    }
    const result = await executor.execute<AdminCountryOption>(sql`
      SELECT id, source_id::double precision AS "sourceId", name, UPPER(country_code) AS "countryCode"
      FROM arenas
      WHERE id = ${countryArenaId} AND arena_type = 'country'
      LIMIT 1
    `);
    const country = result.rows[0];
    if (!country) throw new RangeError('Select a valid Country Arena.');
    return { ...country, countryCode: country.countryCode.toUpperCase() };
  }

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
        source_id::double precision AS "sourceId",
        name,
        country,
        arena_type AS "arenaType",
        country_code AS "countryCode",
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
        SELECT id, source_id::double precision AS "sourceId", name, country,
          COALESCE(state, '') AS state, COALESCE(city, '') AS city,
          arena_type AS "arenaType", UPPER(country_code) AS "countryCode"
        FROM arenas
        ORDER BY lower(name), lower(country), lower(state), source_id
      `);
      return result.rows;
    },

    async listCountryOptions() {
      const result = await database.execute<AdminCountryOption>(sql`
        SELECT id, source_id::double precision AS "sourceId", name, UPPER(country_code) AS "countryCode"
        FROM arenas
        WHERE arena_type = 'country'
        ORDER BY lower(name), source_id
      `);
      return result.rows.map((country) => ({ ...country, countryCode: country.countryCode.toUpperCase() }));
    },

    get,

    async create(input) {
      const id = await database.transaction(async (transaction) => {
        const country = await resolveCountry(transaction, input.countryArenaId);
        const result = await transaction.execute<{ id: string }>(sql`
          WITH geometry AS (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area),
          counted AS (
            SELECT area, ${claimableCellCountSql({ area: sql`geometry.area`, cellSize: sql`${cellSize}` })} AS count
            FROM geometry
          )
          INSERT INTO arenas (source_id, name, country, country_code, state, city, area, arena_type,
            claimable_cell_count)
          SELECT nextval('arena_source_id_seq'), ${input.name}, ${country.name}, ${country.countryCode},
            ${input.state || null}, ${input.city || null}, counted.area, 'general', counted.count
          FROM counted
          WHERE counted.area IS NOT NULL AND NOT ST_IsEmpty(counted.area) AND ST_IsValid(counted.area)
            AND counted.count > 0
          RETURNING id
        `);
        const createdId = result.rows[0]?.id;
        if (!createdId) throw new RangeError('Arena geometry must contain at least one valid polygon and one claimable grid cell.');
        const affectedUsers = await userAchievementProgress.findUsersAffectedByArenasInTransaction(transaction, [createdId]);
        await userAchievementProgress.rebuildUsersInTransaction(transaction, affectedUsers);
        await arenaLeadership.reconcileInTransaction(transaction, { arenaIds: [createdId] });
        return createdId;
      });
      if (!id) throw new RangeError('Arena geometry must contain at least one valid polygon.');
      const saved = await get(id);
      if (!saved) throw new Error('Unable to reload Arena.');
      return saved;
    },

    async update(id, input) {
      const updated = await database.transaction(async (transaction) => {
        const country = await resolveCountry(transaction, input.countryArenaId);
        const arenaTypeResult = await transaction.execute<{ arenaType: AdminAreaSummary['arenaType'] }>(sql`
          SELECT arena_type AS "arenaType" FROM arenas WHERE id = ${id}
        `);
        const arenaType = arenaTypeResult.rows[0]?.arenaType;
        if (!arenaType) return null;
        let oldPeerIds: string[] = [];
        if (arenaType === 'state' || arenaType === 'country') {
          const peers = await transaction.execute<{ id: string }>(sql`
            SELECT peer.id
            FROM arenas target
            INNER JOIN arenas peer
              ON peer.arena_type = target.arena_type
             AND peer.id <> target.id
             AND ST_Intersects(peer.area, target.area)
            WHERE target.id = ${id}
          `);
          oldPeerIds = peers.rows.map((peer) => peer.id);
        }
        const oldAffectedUsers = await userAchievementProgress.findUsersAffectedByArenasInTransaction(
          transaction,
          [id, ...oldPeerIds],
        );
        const shouldRecomputeCount = arenaType === 'general' || arenaType === 'launch';
        const result = await transaction.execute<{ id: string; arenaType: AdminAreaSummary['arenaType'] }>(shouldRecomputeCount ? sql`
          WITH geometry AS (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area),
          counted AS (
            SELECT area, ${claimableCellCountSql({ area: sql`geometry.area`, cellSize: sql`${cellSize}` })} AS count
            FROM geometry
          )
          UPDATE arenas
          SET name = ${input.name},
            country = CASE WHEN arenas.arena_type = 'country' THEN arenas.country ELSE ${country.name} END,
            country_code = CASE WHEN arenas.arena_type = 'country' THEN arenas.country_code ELSE ${country.countryCode} END,
            state = ${input.state || null},
            city = ${input.city || null}, area = counted.area,
            claimable_cell_count = counted.count
          FROM counted
          WHERE arenas.id = ${id}
            AND counted.area IS NOT NULL AND NOT ST_IsEmpty(counted.area) AND ST_IsValid(counted.area)
            AND counted.count > 0
          RETURNING arenas.id, arenas.arena_type AS "arenaType"
        ` : sql`
          WITH geometry AS (SELECT ${normalizedArenaGeometrySql(input.geometries)} AS area)
          UPDATE arenas
          SET name = ${input.name},
            country = CASE WHEN arenas.arena_type = 'country' THEN arenas.country ELSE ${country.name} END,
            country_code = CASE WHEN arenas.arena_type = 'country' THEN arenas.country_code ELSE ${country.countryCode} END,
            state = ${input.state || null},
            city = ${input.city || null}, area = geometry.area
          FROM geometry
          WHERE arenas.id = ${id}
            AND geometry.area IS NOT NULL AND NOT ST_IsEmpty(geometry.area) AND ST_IsValid(geometry.area)
          RETURNING arenas.id, arenas.arena_type AS "arenaType"
        `);
        const row = result.rows[0];
        if (!row) return null;
        const newAffectedArenaIds = new Set<string>([row.id]);
        if (row.arenaType === 'state' || row.arenaType === 'country') {
          const peers = await transaction.execute<{ id: string }>(sql`
            SELECT peer.id
            FROM arenas target
            INNER JOIN arenas peer
              ON peer.arena_type = target.arena_type
             AND peer.id <> target.id
             AND ST_Intersects(peer.area, target.area)
            WHERE target.id = ${row.id}
          `);
          for (const peer of peers.rows) newAffectedArenaIds.add(peer.id);
        }
        const newAffectedUsers = await userAchievementProgress.findUsersAffectedByArenasInTransaction(
          transaction,
          [...newAffectedArenaIds],
        );
        await userAchievementProgress.rebuildUsersInTransaction(transaction, [...oldAffectedUsers, ...newAffectedUsers]);
        if (row.arenaType !== 'launch') {
          await arenaLeadership.reconcileInTransaction(transaction, { arenaIds: [...new Set([row.id, ...oldPeerIds, ...newAffectedArenaIds])] });
        }
        return row;
      });
      return updated ? get(id) : null;
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
