import { describe, expect, it, vi } from 'vitest';
import { createIgcFileService } from '../../src/services/igcFileService.js';

const ownerUserId = '00000000-0000-4000-8000-000000000001';

function databaseReturning(row: { id: string; bucketKey: string }) {
  const returning = vi.fn(async () => [row]);
  const values = vi.fn(() => ({ returning }));
  return { database: { insert: vi.fn(() => ({ values })) }, values, returning };
}

describe('IgcFileService', () => {
  it('uploads original IGC bytes and persists retrieval metadata', async () => {
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const { database, values } = databaseReturning(stored);
    const send = vi.fn(async () => ({}));
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    });
    const bytes = Buffer.from('AXXX IGC flight log');

    await expect(
      service.upload({
        ownerUserId,
        originalFilename: 'flight.igc',
        contentType: 'application/octet-stream',
        bytes,
      }),
    ).resolves.toEqual(stored);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: 'glidehero/object-id.igc', Body: bytes }) }),
    );
    expect(values).toHaveBeenCalledWith({
      userId: ownerUserId,
      originalFilename: 'flight.igc',
      contentType: 'application/octet-stream',
      byteSize: bytes.byteLength,
      bucketKey: 'glidehero/object-id.igc',
    });
  });

  it('removes the object when database persistence fails', async () => {
    const send = vi.fn(async () => ({}));
    const database = { insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => { throw new Error('database unavailable'); }) })) })) };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    });

    await expect(
      service.upload({ ownerUserId, originalFilename: 'flight.igc', contentType: 'text/plain', bytes: Buffer.from('A') }),
    ).rejects.toThrow('database unavailable');
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: 'glidehero/object-id.igc' }) }),
    );
  });
});
