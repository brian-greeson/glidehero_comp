import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createThermalProcessingService } from '../../src/services/thermalProcessingService.js';

describe('thermal processing service', () => {
  it('claims a native tile with a short processing lease', async () => {
    const claimed = {
      id: 'tile-1', zoom: 12, tileX: 2144, tmsY: 1378,
      bucketKey: 'thermal_tiles/tile.png', checksum: 'checksum', processingVersion: 1,
    };
    const database = { execute: vi.fn(async () => ({ rows: [claimed] })) };
    const service = createThermalProcessingService(database as never, {
      s3Client: { send: vi.fn() } as never,
      bucketName: 'files',
    });

    await expect(service.claimNext('local-worker')).resolves.toEqual(claimed);
    expect(database.execute).toHaveBeenCalledOnce();
  });

  it('vectorizes a cached raster and completes it under the owned lease', async () => {
    const raster = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const transactionExecute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'tile-1' }] })
      .mockResolvedValue({ rows: [] });
    const database = {
      transaction: vi.fn(async (work: (transaction: { execute: typeof transactionExecute }) => Promise<void>) => work({ execute: transactionExecute })),
    };
    const service = createThermalProcessingService(database as never, {
      s3Client: {
        send: vi.fn(async () => ({ Body: { transformToByteArray: async () => raster } })),
      } as never,
      bucketName: 'files',
    });

    await expect(service.process({
      id: 'tile-1', zoom: 12, tileX: 2144, tmsY: 1378,
      bucketKey: 'thermal_tiles/tile.png', checksum: 'checksum', processingVersion: 1,
    }, 'local-worker')).resolves.toEqual({ areaCount: 1, empty: false });
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(transactionExecute).toHaveBeenCalledTimes(4);
  });

  it('does not finish processing after a lease has been lost', async () => {
    const raster = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const transactionExecute = vi.fn(async () => ({ rows: [] }));
    const database = {
      transaction: vi.fn(async (work: (transaction: { execute: typeof transactionExecute }) => Promise<void>) => work({ execute: transactionExecute })),
    };
    const service = createThermalProcessingService(database as never, {
      s3Client: {
        send: vi.fn(async () => ({ Body: { transformToByteArray: async () => raster } })),
      } as never,
      bucketName: 'files',
    });

    await expect(service.process({
      id: 'tile-1', zoom: 12, tileX: 2144, tmsY: 1378,
      bucketKey: 'thermal_tiles/tile.png', checksum: 'checksum', processingVersion: 1,
    }, 'local-worker')).rejects.toThrow('processing lease was lost');
    expect(transactionExecute).toHaveBeenCalledOnce();
  });
});
