import { GetObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import type { Database } from '../db/client.js';
import { THERMAL_NATIVE_ZOOM, THERMAL_PROCESSING_VERSION } from '../domain/thermal/thermalTiles.js';
import { vectorizeThermalPixels } from '../domain/thermal/thermalVectorizer.js';

export type ClaimedThermalTile = {
  id: string;
  zoom: number;
  tileX: number;
  tmsY: number;
  bucketKey: string;
  checksum: string;
  processingVersion: number;
};

export interface ThermalProcessingService {
  claimNext(workerId: string, leaseMilliseconds?: number): Promise<ClaimedThermalTile | null>;
  renew(tileId: string, workerId: string, leaseMilliseconds?: number): Promise<boolean>;
  process(tile: ClaimedThermalTile, workerId: string): Promise<{ areaCount: number; empty: boolean }>;
  fail(tileId: string, workerId: string, error: unknown): Promise<void>;
}

async function objectBuffer(body: unknown): Promise<Buffer> {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body)) throw new Error('Thermal raster body is unavailable.');
  return Buffer.from(await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
}

export function createThermalProcessingService(database: Database, options: {
  s3Client: Pick<S3, 'send'>;
  bucketName: string;
}): ThermalProcessingService {
  return {
    async claimNext(workerId, leaseMilliseconds = 5 * 60_000) {
      if (!workerId.trim()) throw new RangeError('Thermal worker ID is required.');
      const result = await database.execute<ClaimedThermalTile>(sql`
        WITH candidate AS (
          SELECT id
          FROM thermal_raster_tiles
          WHERE zoom = ${THERMAL_NATIVE_ZOOM}
            AND processing_version = ${THERMAL_PROCESSING_VERSION}
            AND (
              processing_status = 'pending'
              OR (
                processing_status = 'failed'
                AND updated_at < NOW() - INTERVAL '5 minutes'
              )
              OR (processing_status = 'processing' AND lease_expires_at < NOW())
            )
          ORDER BY
            CASE processing_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END,
            cached_at,
            id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE thermal_raster_tiles tile
        SET processing_status = 'processing',
            lease_owner = ${workerId},
            lease_expires_at = NOW() + (${leaseMilliseconds} * INTERVAL '1 millisecond'),
            processing_attempts = tile.processing_attempts + 1,
            last_processing_error = NULL,
            updated_at = NOW()
        FROM candidate
        WHERE tile.id = candidate.id
        RETURNING tile.id,
          tile.zoom,
          tile.tile_x AS "tileX",
          tile.tms_y AS "tmsY",
          tile.bucket_key AS "bucketKey",
          tile.checksum,
          tile.processing_version AS "processingVersion"
      `);
      return result.rows[0] ?? null;
    },

    async renew(tileId, workerId, leaseMilliseconds = 5 * 60_000) {
      const result = await database.execute<{ id: string }>(sql`
        UPDATE thermal_raster_tiles
        SET lease_expires_at = NOW() + (${leaseMilliseconds} * INTERVAL '1 millisecond'), updated_at = NOW()
        WHERE id = ${tileId} AND processing_status = 'processing' AND lease_owner = ${workerId}
        RETURNING id
      `);
      return result.rows.length === 1;
    },

    async process(tile, workerId) {
      const object = await options.s3Client.send(new GetObjectCommand({ Bucket: options.bucketName, Key: tile.bucketKey }));
      const raster = await objectBuffer(object.Body);
      const decoded = await sharp(raster).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const components = vectorizeThermalPixels({
        rgba: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        zoom: tile.zoom,
        tileX: tile.tileX,
        tmsY: tile.tmsY,
      });
      await database.transaction(async (transaction) => {
        const ownership = await transaction.execute<{ id: string }>(sql`
          SELECT id FROM thermal_raster_tiles
          WHERE id = ${tile.id} AND processing_status = 'processing' AND lease_owner = ${workerId}
          FOR UPDATE
        `);
        if (!ownership.rows[0]) throw new Error('Thermal tile processing lease was lost.');
        await transaction.execute(sql`DELETE FROM thermal_areas WHERE raster_tile_id = ${tile.id}`);
        for (const component of components) {
          const geometryJson = JSON.stringify(component.geometry);
          await transaction.execute(sql`
            WITH valid_geometry AS (
              SELECT ST_Multi(
                ST_CollectionExtract(
                  ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}), 4326)),
                  3
                )
              ) AS value
            )
            INSERT INTO thermal_areas (
              raster_tile_id, component_index, activity_band, relative_score, geometry,
              area_square_meters, raster_checksum, processing_version, generated_at
            )
            SELECT
              ${tile.id}, ${component.componentIndex}, ${component.activityBand}, ${component.relativeScore},
              value, ST_Area(value::geography),
              ${tile.checksum}, ${tile.processingVersion}, NOW()
            FROM valid_geometry
            WHERE NOT ST_IsEmpty(value)
          `);
        }
        await transaction.execute(sql`
          UPDATE thermal_raster_tiles
          SET processing_status = ${components.length ? sql`'complete'::thermal_tile_processing_status` : sql`'empty'::thermal_tile_processing_status`},
              processed_at = NOW(), lease_owner = NULL, lease_expires_at = NULL,
              last_processing_error = NULL, updated_at = NOW()
          WHERE id = ${tile.id}
        `);
      });
      return { areaCount: components.length, empty: components.length === 0 };
    },

    async fail(tileId, workerId, error) {
      const message = error instanceof Error ? error.message : String(error);
      await database.execute(sql`
        UPDATE thermal_raster_tiles
        SET processing_status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
            last_processing_error = ${message.slice(0, 2_000)}, updated_at = NOW()
        WHERE id = ${tileId} AND lease_owner = ${workerId}
      `);
    },
  };
}
