import { describe, expect, it, vi } from 'vitest';
import { createFlightThumbnailDeliveryService } from '../../src/services/flightThumbnailDeliveryService.js';

describe('flight thumbnail delivery service', () => {
  it('presigns both deterministic objects for 24 hours without probing storage', async () => {
    const presign = vi.fn(async (command: { input: { Bucket?: string; Key?: string } }, expiresIn: number) => `signed:${command.input.Key}`);
    const service = createFlightThumbnailDeliveryService({
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
      presign,
    });

    await expect(service.sign({ userId: 'user-1', flightId: 'flight-1' })).resolves.toEqual({
      wideUrl: 'signed:glidehero-test/uploads/user-1/thumbnails/flight-1-800x450.webp',
      squareUrl: 'signed:glidehero-test/uploads/user-1/thumbnails/flight-1-450x450.webp',
    });
    expect(presign).toHaveBeenCalledTimes(2);
    expect(presign.mock.calls.every(([, expiresIn]) => expiresIn === 86_400)).toBe(true);
  });

  it('returns a per-flight fallback result when signing fails', async () => {
    const service = createFlightThumbnailDeliveryService({
      s3Client: { send: vi.fn() } as never,
      bucketName: 'flights',
      bucketFolder: 'glidehero-test',
      presign: vi.fn(async () => { throw new Error('presigner unavailable'); }),
    });

    await expect(service.signMany([
      { userId: 'user-1', flightId: 'flight-1' },
      { userId: 'user-1', flightId: 'flight-2' },
    ])).resolves.toEqual(new Map());
  });
});
