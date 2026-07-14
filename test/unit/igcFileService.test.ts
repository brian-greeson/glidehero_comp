import { describe, expect, it, vi } from 'vitest';
import { createIgcFileService } from '../../src/services/igcFileService.js';
import { duplicateFlightMessage } from '../../src/services/flightProcessingService.js';

const ownerUserId = '00000000-0000-4000-8000-000000000001';

function databaseReturning(
  row: { id: string; bucketKey: string },
  existingFlight?: { id: string },
  metadataDeleteError?: Error,
) {
  const returning = vi.fn(async () => [row]);
  const values = vi.fn(() => ({ returning }));
  const limit = vi.fn(async () => existingFlight ? [existingFlight] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const deleteWhere = vi.fn(async () => {
    if (metadataDeleteError) throw metadataDeleteError;
  });
  const remove = vi.fn(() => ({ where: deleteWhere }));
  return {
    database: { select, insert: vi.fn(() => ({ values })), delete: remove },
    values,
    returning,
    select,
    limit,
    remove,
    deleteWhere,
  };
}

describe('IgcFileService', () => {
  it('uploads original IGC bytes and persists retrieval metadata', async () => {
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const { database, values } = databaseReturning(stored);
    const send = vi.fn(async () => ({}));
    const outcome = { status: 'completed' as const, flightId: '00000000-0000-4000-8000-000000000020' };
    const processor = { process: vi.fn(async () => outcome) };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor);
    const bytes = Buffer.from('AXXX IGC flight log');

    await expect(
      service.upload({
        ownerUserId,
        originalFilename: 'flight.igc',
        contentType: 'application/octet-stream',
        bytes,
      }),
    ).resolves.toEqual(outcome);

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
    expect(processor.process).toHaveBeenCalledWith({
      ownerUserId,
      igcFileId: stored.id,
      bucketKey: stored.bucketKey,
      contentHash: 'ff1869d081d2815322d62f0c4e23864966de47b4bf9ee8ae7b0c7a99eff18c8e',
    });
  });

  it('returns the duplicate outcome before writing when the content hash already exists', async () => {
    const existingFlightId = '00000000-0000-4000-8000-000000000099';
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const { database, select } = databaseReturning(stored, { id: existingFlightId });
    const send = vi.fn(async () => ({}));
    const processor = { process: vi.fn() };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor as never);

    await expect(service.upload({
      ownerUserId,
      originalFilename: 'flight.igc',
      contentType: 'application/octet-stream',
      bytes: Buffer.from('AXXX IGC flight log'),
    })).resolves.toEqual({ status: 'duplicate', message: duplicateFlightMessage });

    expect(select).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('removes the object when database persistence fails', async () => {
    const send = vi.fn(async () => ({}));
    const limit = vi.fn(async () => []);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => { throw new Error('database unavailable'); }) })) })),
    };
    const processor = { process: vi.fn() };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor as never);

    await expect(
      service.upload({ ownerUserId, originalFilename: 'flight.igc', contentType: 'text/plain', bytes: Buffer.from('A') }),
    ).rejects.toThrow('database unavailable');
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: 'glidehero/object-id.igc' }) }),
    );
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('does not remove the source object when processing returns a failure outcome', async () => {
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const { database } = databaseReturning(stored);
    const send = vi.fn(async () => ({}));
    const outcome = {
      status: 'failed' as const,
      flightId: '00000000-0000-4000-8000-000000000020',
      message: 'Invalid flight track.',
    };
    const processor = { process: vi.fn(async () => outcome) };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor);

    await expect(
      service.upload({ ownerUserId, originalFilename: 'flight.igc', contentType: 'text/plain', bytes: Buffer.from('A') }),
    ).resolves.toEqual(outcome);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('removes the stored metadata and object when processing detects a concurrent duplicate', async () => {
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const { database, remove, deleteWhere } = databaseReturning(stored);
    const send = vi.fn(async () => ({}));
    const outcome = { status: 'duplicate' as const, message: duplicateFlightMessage as typeof duplicateFlightMessage };
    const processor = { process: vi.fn(async () => outcome) };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor);

    await expect(
      service.upload({ ownerUserId, originalFilename: 'flight.igc', contentType: 'text/plain', bytes: Buffer.from('A') }),
    ).resolves.toEqual(outcome);

    expect(remove).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: stored.bucketKey }) }),
    );
  });

  it('removes the stored object and returns duplicate when duplicate metadata cleanup fails', async () => {
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const metadataDeleteError = new Error('metadata cleanup unavailable');
    const { database, remove, deleteWhere } = databaseReturning(stored, undefined, metadataDeleteError);
    const send = vi.fn(async () => ({}));
    const outcome = { status: 'duplicate' as const, message: duplicateFlightMessage as typeof duplicateFlightMessage };
    const processor = { process: vi.fn(async () => outcome) };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor);

    await expect(
      service.upload({ ownerUserId, originalFilename: 'flight.igc', contentType: 'text/plain', bytes: Buffer.from('A') }),
    ).resolves.toEqual(outcome);

    expect(remove).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: expect.objectContaining({ Bucket: 'glidehero-files', Key: stored.bucketKey }) }),
    );
  });

  it('does not remove the source object when processing throws unexpectedly', async () => {
    const stored = { id: '00000000-0000-4000-8000-000000000010', bucketKey: 'glidehero/object-id.igc' };
    const { database } = databaseReturning(stored);
    const send = vi.fn(async () => ({}));
    const processor = { process: vi.fn(async () => { throw new Error('processor unavailable'); }) };
    const service = createIgcFileService(database as never, {
      bucketName: 'glidehero-files',
      s3Client: { send } as never,
      keyFactory: () => 'glidehero/object-id.igc',
    }, processor);

    await expect(
      service.upload({ ownerUserId, originalFilename: 'flight.igc', contentType: 'text/plain', bytes: Buffer.from('A') }),
    ).rejects.toThrow('processor unavailable');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
