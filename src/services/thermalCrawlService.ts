import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { THERMAL_NATIVE_ZOOM, THERMAL_SOURCE_LAYER } from '../domain/thermal/thermalTiles.js';

export type ThermalCrawlStatus = 'pending' | 'running' | 'paused' | 'complete' | 'cancelled' | 'failed';
export type ThermalCrawlSummary = {
  id: string;
  name: string;
  status: ThermalCrawlStatus;
  totalTiles: number;
  pendingTiles: number;
  processingTiles: number;
  cachedTiles: number;
  emptyTiles: number;
  failedTiles: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ClaimedCrawlTile = { jobId: string; zoom: number; tileX: number; tmsY: number };

export interface ThermalCrawlService {
  list(): Promise<ThermalCrawlSummary[]>;
  create(input: { name: string; geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon; userId: string }): Promise<string>;
  setStatus(jobId: string, status: Extract<ThermalCrawlStatus, 'running' | 'paused' | 'cancelled'>): Promise<boolean>;
  claimNext(workerId: string, leaseMilliseconds?: number): Promise<ClaimedCrawlTile | null>;
  complete(tile: ClaimedCrawlTile, workerId: string, rasterTileId: string | null, empty: boolean): Promise<void>;
  fail(tile: ClaimedCrawlTile, workerId: string, error: unknown): Promise<void>;
}

function allPositions(geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon): GeoJSON.Position[] {
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') throw new RangeError('Thermal crawl area requires a polygon.');
  const polygons: unknown[] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) throw new RangeError('Thermal crawl area requires a polygon.');
  const positions: GeoJSON.Position[] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) throw new RangeError('Thermal crawl polygon coordinates are invalid.');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new RangeError('Thermal crawl polygon rings require at least four positions.');
      for (const position of ring) {
        if (!Array.isArray(position) || position.length < 2) throw new RangeError('Thermal crawl coordinates are invalid.');
        positions.push(position as GeoJSON.Position);
        if (positions.length > 10_000) throw new RangeError('Thermal crawl polygons are limited to 10,000 positions.');
      }
      const first = ring[0] as GeoJSON.Position;
      const last = ring[ring.length - 1] as GeoJSON.Position;
      if (first[0] !== last[0] || first[1] !== last[1]) throw new RangeError('Thermal crawl polygon rings must be closed.');
    }
  }
  return positions;
}

function longitudeToTileX(longitude: number, zoom: number): number {
  return Math.floor(((longitude + 180) / 360) * 2 ** zoom);
}

function latitudeToXyzY(latitude: number, zoom: number): number {
  const radians = (Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180;
  return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom);
}

function bounds(geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon) {
  const positions = allPositions(geometry);
  if (positions.length < 4) throw new RangeError('Thermal crawl area requires a polygon.');
  const longitudes = positions.map((position) => Number(position[0]));
  const latitudes = positions.map((position) => Number(position[1]));
  if (![...longitudes, ...latitudes].every(Number.isFinite)) throw new RangeError('Thermal crawl coordinates are invalid.');
  if (longitudes.some((longitude) => longitude < -180 || longitude > 180)
    || latitudes.some((latitude) => latitude < -85 || latitude > 85)) {
    throw new RangeError('Thermal crawl coordinates are outside the supported map bounds.');
  }
  return {
    west: Math.max(-180, Math.min(...longitudes)),
    east: Math.min(180, Math.max(...longitudes)),
    south: Math.max(-85, Math.min(...latitudes)),
    north: Math.min(85, Math.max(...latitudes)),
  };
}

export function createThermalCrawlService(database: Database): ThermalCrawlService {
  return {
    async list() {
      const result = await database.execute<ThermalCrawlSummary>(sql`
        SELECT job.id, job.name, job.status, job.created_at AS "createdAt", job.updated_at AS "updatedAt",
          COUNT(tile.job_id)::integer AS "totalTiles",
          COUNT(*) FILTER (WHERE tile.status = 'pending')::integer AS "pendingTiles",
          COUNT(*) FILTER (WHERE tile.status = 'processing')::integer AS "processingTiles",
          COUNT(*) FILTER (WHERE tile.status = 'cached')::integer AS "cachedTiles",
          COUNT(*) FILTER (WHERE tile.status = 'empty')::integer AS "emptyTiles",
          COUNT(*) FILTER (WHERE tile.status = 'failed')::integer AS "failedTiles"
        FROM thermal_crawl_jobs job
        LEFT JOIN thermal_crawl_job_tiles tile ON tile.job_id = job.id
        GROUP BY job.id
        ORDER BY job.created_at DESC
        LIMIT 50
      `);
      return result.rows.map((row) => ({
        ...row,
        totalTiles: Number(row.totalTiles), pendingTiles: Number(row.pendingTiles), processingTiles: Number(row.processingTiles),
        cachedTiles: Number(row.cachedTiles), emptyTiles: Number(row.emptyTiles), failedTiles: Number(row.failedTiles),
      }));
    },

    async create(input) {
      const name = input.name.trim();
      if (!name || name.length > 80) throw new RangeError('Thermal crawl job name must be 1–80 characters.');
      const areaBounds = bounds(input.geometry);
      const maximum = 2 ** THERMAL_NATIVE_ZOOM - 1;
      const xMin = Math.max(0, Math.min(maximum, longitudeToTileX(areaBounds.west, THERMAL_NATIVE_ZOOM)));
      const xMax = Math.max(0, Math.min(maximum, longitudeToTileX(areaBounds.east, THERMAL_NATIVE_ZOOM)));
      const xyzYMin = Math.max(0, Math.min(maximum, latitudeToXyzY(areaBounds.north, THERMAL_NATIVE_ZOOM)));
      const xyzYMax = Math.max(0, Math.min(maximum, latitudeToXyzY(areaBounds.south, THERMAL_NATIVE_ZOOM)));
      const estimate = (xMax - xMin + 1) * (xyzYMax - xyzYMin + 1);
      if (estimate > 20_000) throw new RangeError('Thermal crawl area is too large; limit a job to 20,000 zoom-12 tiles.');
      const geometryJson = JSON.stringify(input.geometry);
      return database.transaction(async (transaction) => {
        const inserted = await transaction.execute<{ id: string }>(sql`
          INSERT INTO thermal_crawl_jobs (name, source_layer_key, target_geometry, status, created_by, created_at, updated_at)
          VALUES (
            ${name}, ${THERMAL_SOURCE_LAYER},
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}), 4326)), 3)),
            'running', ${input.userId}, NOW(), NOW()
          ) RETURNING id
        `);
        const jobId = inserted.rows[0]?.id;
        if (!jobId) throw new Error('Unable to create thermal crawl job.');
        const tileCount = await transaction.execute<{ count: number }>(sql`
          WITH inserted AS (
            INSERT INTO thermal_crawl_job_tiles (job_id, zoom, tile_x, tms_y, status, updated_at)
            SELECT ${jobId}, ${THERMAL_NATIVE_ZOOM}, x, (${maximum} - xyz_y), 'pending', NOW()
            FROM generate_series(${xMin}, ${xMax}) x
            CROSS JOIN generate_series(${xyzYMin}, ${xyzYMax}) xyz_y
            CROSS JOIN thermal_crawl_jobs job
            WHERE job.id = ${jobId}
              AND ST_Intersects(job.target_geometry, ST_Transform(ST_TileEnvelope(${THERMAL_NATIVE_ZOOM}, x, xyz_y), 4326))
            RETURNING 1
          )
          SELECT COUNT(*)::integer AS count FROM inserted
        `);
        if (Number(tileCount.rows[0]?.count ?? 0) === 0) throw new RangeError('Thermal crawl area does not intersect any supported tiles.');
        return jobId;
      });
    },

    async setStatus(jobId, status) {
      const result = await database.execute<{ id: string }>(sql`
        UPDATE thermal_crawl_jobs SET status = ${status}, updated_at = NOW()
        WHERE id = ${jobId} AND status NOT IN ('complete', 'cancelled') RETURNING id
      `);
      const updated = result.rows.length === 1;
      if (updated && status === 'running') {
        await database.execute(sql`
          UPDATE thermal_crawl_job_tiles SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
          WHERE job_id = ${jobId} AND status = 'failed'
        `);
      }
      return updated;
    },

    async claimNext(workerId, leaseMilliseconds = 5 * 60_000) {
      const result = await database.execute<ClaimedCrawlTile>(sql`
        WITH candidate AS (
          SELECT tile.job_id, tile.zoom, tile.tile_x, tile.tms_y
          FROM thermal_crawl_job_tiles tile
          JOIN thermal_crawl_jobs job ON job.id = tile.job_id
          WHERE job.status = 'running'
            AND (tile.status = 'pending' OR (tile.status = 'processing' AND tile.lease_expires_at < NOW()))
          ORDER BY job.created_at, tile.tile_x, tile.tms_y
          FOR UPDATE OF tile SKIP LOCKED
          LIMIT 1
        )
        UPDATE thermal_crawl_job_tiles tile
        SET status = 'processing', lease_owner = ${workerId},
          lease_expires_at = NOW() + (${leaseMilliseconds} * INTERVAL '1 millisecond'),
          attempt_count = tile.attempt_count + 1, last_error = NULL, updated_at = NOW()
        FROM candidate
        WHERE tile.job_id = candidate.job_id AND tile.zoom = candidate.zoom
          AND tile.tile_x = candidate.tile_x AND tile.tms_y = candidate.tms_y
        RETURNING tile.job_id AS "jobId", tile.zoom, tile.tile_x AS "tileX", tile.tms_y AS "tmsY"
      `);
      return result.rows[0] ?? null;
    },

    async complete(tile, workerId, rasterTileId, empty) {
      await database.transaction(async (transaction) => {
        await transaction.execute(sql`
          UPDATE thermal_crawl_job_tiles
          SET status = ${empty ? sql`'empty'::thermal_crawl_tile_status` : sql`'cached'::thermal_crawl_tile_status`},
            raster_tile_id = ${rasterTileId}, lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
          WHERE job_id = ${tile.jobId} AND zoom = ${tile.zoom} AND tile_x = ${tile.tileX} AND tms_y = ${tile.tmsY}
            AND lease_owner = ${workerId}
        `);
        await transaction.execute(sql`
          UPDATE thermal_crawl_jobs job SET status = 'complete', updated_at = NOW()
          WHERE id = ${tile.jobId} AND job.status <> 'cancelled' AND NOT EXISTS (
            SELECT 1 FROM thermal_crawl_job_tiles pending
            WHERE pending.job_id = job.id AND pending.status IN ('pending', 'processing', 'failed')
          )
        `);
      });
    },

    async fail(tile, workerId, error) {
      const message = error instanceof Error ? error.message : String(error);
      await database.execute(sql`
        UPDATE thermal_crawl_job_tiles
        SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
          last_error = ${message.slice(0, 2_000)}, updated_at = NOW()
        WHERE job_id = ${tile.jobId} AND zoom = ${tile.zoom} AND tile_x = ${tile.tileX} AND tms_y = ${tile.tmsY}
          AND lease_owner = ${workerId}
      `);
    },
  };
}
