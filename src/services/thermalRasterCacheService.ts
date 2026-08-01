import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  assertThermalTileCoordinate,
  isPng,
  thermalRasterObjectKey,
  THERMAL_MAX_TILE_BYTES,
  THERMAL_NATIVE_ZOOM,
  THERMAL_PROCESSING_VERSION,
  THERMAL_SOURCE_LAYER,
  type ThermalTileCoordinate,
} from '../domain/thermal/thermalTiles.js';
import type { ThermalKkClient } from '../resources/thermalKkClient.js';

export type ThermalRasterTileResult = {
  body: Buffer;
  contentType: 'image/png';
  bucketKey: string;
  cache: 'hit' | 'miss';
};

export interface ThermalRasterCacheService {
  get(input: ThermalTileCoordinate): Promise<ThermalRasterTileResult | null>;
  cache(input: ThermalTileCoordinate): Promise<ThermalRasterTileResult | null>;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === 'NoSuchKey' || value.Code === 'NoSuchKey' || value.$metadata?.httpStatusCode === 404;
}

function checksum(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

async function bodyBuffer(body: unknown): Promise<Buffer> {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body)) throw new Error('Cached thermal tile body is unavailable.');
  const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

export function createThermalRasterCacheService(
  database: Database,
  client: ThermalKkClient,
  options: {
    s3Client: Pick<S3, 'send'>;
    bucketName: string;
  },
): ThermalRasterCacheService {
  const inFlightFills = new Map<string, Promise<ThermalRasterTileResult | null>>();

  async function record(input: ThermalTileCoordinate, bucketKey: string, body: Buffer, freshlyFetched: boolean): Promise<void> {
    const digest = checksum(body);
    await database.execute(sql`
      INSERT INTO thermal_raster_tiles (
        source_layer_key, zoom, tile_x, tms_y, bucket_key, checksum, byte_size,
        content_type, processing_status, processing_version, cached_at, created_at, updated_at
      ) VALUES (
        ${THERMAL_SOURCE_LAYER}, ${input.zoom}, ${input.x}, ${input.tmsY}, ${bucketKey}, ${digest}, ${body.byteLength},
        'image/png', ${input.zoom === THERMAL_NATIVE_ZOOM ? sql`'pending'::thermal_tile_processing_status` : null},
        ${THERMAL_PROCESSING_VERSION}, NOW(), NOW(), NOW()
      )
      ON CONFLICT (source_layer_key, zoom, tile_x, tms_y) DO UPDATE SET
        bucket_key = EXCLUDED.bucket_key,
        byte_size = EXCLUDED.byte_size,
        content_type = EXCLUDED.content_type,
        cached_at = CASE WHEN ${freshlyFetched} THEN NOW() ELSE thermal_raster_tiles.cached_at END,
        updated_at = NOW(),
        processing_status = CASE
          WHEN thermal_raster_tiles.zoom = ${THERMAL_NATIVE_ZOOM}
            AND (
              thermal_raster_tiles.checksum IS DISTINCT FROM EXCLUDED.checksum
              OR thermal_raster_tiles.processing_version IS DISTINCT FROM EXCLUDED.processing_version
            )
            THEN 'pending'::thermal_tile_processing_status
          ELSE thermal_raster_tiles.processing_status
        END,
        processing_version = EXCLUDED.processing_version,
        processing_attempts = CASE
          WHEN thermal_raster_tiles.zoom = ${THERMAL_NATIVE_ZOOM}
            AND (
              thermal_raster_tiles.checksum IS DISTINCT FROM EXCLUDED.checksum
              OR thermal_raster_tiles.processing_version IS DISTINCT FROM EXCLUDED.processing_version
            )
            THEN 0
          ELSE thermal_raster_tiles.processing_attempts
        END,
        processed_at = CASE
          WHEN thermal_raster_tiles.zoom = ${THERMAL_NATIVE_ZOOM}
            AND (
              thermal_raster_tiles.checksum IS DISTINCT FROM EXCLUDED.checksum
              OR thermal_raster_tiles.processing_version IS DISTINCT FROM EXCLUDED.processing_version
            )
            THEN NULL
          ELSE thermal_raster_tiles.processed_at
        END,
        lease_owner = CASE
          WHEN thermal_raster_tiles.checksum IS DISTINCT FROM EXCLUDED.checksum
            OR thermal_raster_tiles.processing_version IS DISTINCT FROM EXCLUDED.processing_version
            THEN NULL
          ELSE thermal_raster_tiles.lease_owner
        END,
        lease_expires_at = CASE
          WHEN thermal_raster_tiles.checksum IS DISTINCT FROM EXCLUDED.checksum
            OR thermal_raster_tiles.processing_version IS DISTINCT FROM EXCLUDED.processing_version
            THEN NULL
          ELSE thermal_raster_tiles.lease_expires_at
        END,
        checksum = EXCLUDED.checksum
      WHERE ${freshlyFetched}
        OR thermal_raster_tiles.bucket_key IS DISTINCT FROM EXCLUDED.bucket_key
        OR thermal_raster_tiles.byte_size IS DISTINCT FROM EXCLUDED.byte_size
        OR thermal_raster_tiles.content_type IS DISTINCT FROM EXCLUDED.content_type
        OR thermal_raster_tiles.checksum IS DISTINCT FROM EXCLUDED.checksum
        OR thermal_raster_tiles.processing_version IS DISTINCT FROM EXCLUDED.processing_version
    `);
  }

  async function read(bucketKey: string): Promise<Buffer | null> {
    try {
      const object = await options.s3Client.send(new GetObjectCommand({ Bucket: options.bucketName, Key: bucketKey }));
      const body = await bodyBuffer(object.Body);
      if (body.byteLength === 0 || body.byteLength > THERMAL_MAX_TILE_BYTES || !isPng(body)) return null;
      return body;
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  async function cache(input: ThermalTileCoordinate): Promise<ThermalRasterTileResult | null> {
    assertThermalTileCoordinate(input);
    const bucketKey = thermalRasterObjectKey(input);
    const existing = inFlightFills.get(bucketKey);
    if (existing) return existing;
    const fill = (async () => {
      const tile = await client.fetchTile(input);
      if (!tile) return null;
      await options.s3Client.send(new PutObjectCommand({
        Bucket: options.bucketName,
        Key: bucketKey,
        Body: tile.body,
        ContentType: tile.contentType,
        CacheControl: 'public, max-age=86400',
      }));
      await record(input, bucketKey, tile.body, true);
      return { ...tile, bucketKey, cache: 'miss' as const };
    })();
    inFlightFills.set(bucketKey, fill);
    try {
      return await fill;
    } finally {
      if (inFlightFills.get(bucketKey) === fill) inFlightFills.delete(bucketKey);
    }
  }

  return {
    cache,
    async get(input) {
      assertThermalTileCoordinate(input);
      const bucketKey = thermalRasterObjectKey(input);
      const cached = await read(bucketKey);
      if (cached) {
        await record(input, bucketKey, cached, false);
        return { body: cached, contentType: 'image/png', bucketKey, cache: 'hit' };
      }
      return cache(input);
    },
  };
}
