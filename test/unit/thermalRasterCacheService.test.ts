import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createThermalRasterCacheService } from '../../src/services/thermalRasterCacheService.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe('thermal raster cache', () => {
  it('serves a Spaces hit without contacting Thermal.kk', async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input.Bucket).toBe('thermal-tiles');
      expect((command as GetObjectCommand).input.Key).toBe('12/2144/1378.png');
      return { Body: { transformToByteArray: async () => png } };
    });
    const client = { fetchTile: vi.fn() };
    const database = { execute: vi.fn(async () => ({ rows: [] })) };
    const service = createThermalRasterCacheService(database as never, client, {
      s3Client: { send } as never, bucketName: 'thermal-tiles',
    });
    await expect(service.get({ zoom: 12, x: 2144, tmsY: 1378 })).resolves.toMatchObject({
      cache: 'hit', bucketKey: '12/2144/1378.png',
    });
    expect(client.fetchTile).not.toHaveBeenCalled();
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it('fetches, stores, and records a cache miss', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        expect(command.input.Bucket).toBe('thermal-tiles');
        expect(command.input.Key).toBe('12/2/3.png');
        throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      }
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect((command as PutObjectCommand).input.Bucket).toBe('thermal-tiles');
      expect((command as PutObjectCommand).input.Key).toBe('12/2/3.png');
      return {};
    });
    const client = { fetchTile: vi.fn(async () => ({ body: png, contentType: 'image/png' as const })) };
    const database = { execute: vi.fn(async () => ({ rows: [] })) };
    const service = createThermalRasterCacheService(database as never, client, {
      s3Client: { send } as never, bucketName: 'thermal-tiles',
    });
    await expect(service.get({ zoom: 12, x: 2, tmsY: 3 })).resolves.toMatchObject({ cache: 'miss' });
    expect(client.fetchTile).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it('replaces a corrupt Spaces object from Thermal.kk', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => Buffer.from('not a png') } };
      }
      expect(command).toBeInstanceOf(PutObjectCommand);
      return {};
    });
    const client = { fetchTile: vi.fn(async () => ({ body: png, contentType: 'image/png' as const })) };
    const database = { execute: vi.fn(async () => ({ rows: [] })) };
    const service = createThermalRasterCacheService(database as never, client, {
      s3Client: { send } as never, bucketName: 'files',
    });

    await expect(service.get({ zoom: 12, x: 2, tmsY: 3 })).resolves.toMatchObject({ cache: 'miss' });
    expect(client.fetchTile).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous misses for the same tile', async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return {};
    });
    const client = { fetchTile: vi.fn(async () => ({ body: png, contentType: 'image/png' as const })) };
    const database = { execute: vi.fn(async () => ({ rows: [] })) };
    const service = createThermalRasterCacheService(database as never, client, {
      s3Client: { send } as never, bucketName: 'files',
    });

    const coordinate = { zoom: 12, x: 2, tmsY: 3 };
    await expect(Promise.all([service.get(coordinate), service.get(coordinate)])).resolves.toHaveLength(2);
    expect(client.fetchTile).toHaveBeenCalledOnce();
    expect(send.mock.calls.filter(([command]) => command instanceof PutObjectCommand)).toHaveLength(1);
    expect(database.execute).toHaveBeenCalledOnce();
  });
});
