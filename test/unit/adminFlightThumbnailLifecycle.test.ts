import { describe, expect, it, vi } from 'vitest';
import { createAdminFlightService } from '../../src/services/adminFlightService.js';

const flightId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';

function storage(thumbnailLifecycle: {
  generateForFlight: (flightId: string) => Promise<void>;
  deleteForFlight: (input: { userId: string; flightId: string }) => Promise<void>;
}) {
  return {
    s3Client: { send: vi.fn(async () => ({})) } as never,
    bucketName: 'flights',
    uploadQueue: { removeTerminalJobsForFlight: vi.fn(async () => undefined) },
    thumbnailLifecycle,
  };
}

describe('admin flight thumbnail lifecycle', () => {
  it('regenerates after successful claim reprocessing without making failure visible', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const generateForFlight = vi.fn<(flightId: string) => Promise<void>>(async () => {
      throw new Error('Thumbnail generation failed.', { cause: new Error('MapTiler returned HTTP 401.') });
    });
    const thumbnailLifecycle = { generateForFlight, deleteForFlight: vi.fn(async () => undefined) };
    const reprocess = vi.fn(async () => ({ status: 'completed' as const, result: {} as never }));
    const database = {
      transaction: async (callback: (transaction: unknown) => Promise<void>) => callback({
        execute: async () => ({ rows: [] }),
      }),
    };
    const service = createAdminFlightService(database as never, { reprocess }, storage(thumbnailLifecycle));

    await expect(service.reprocessFlight({ flightId })).resolves.toMatchObject({ status: 'completed' });
    expect(generateForFlight).toHaveBeenCalledWith(flightId);
    expect(consoleError).toHaveBeenCalledWith('Unable to regenerate flight thumbnail', {
      flightId,
      errorName: 'Error',
      errorMessage: 'Thumbnail generation failed.',
      causeName: 'Error',
      causeMessage: 'MapTiler returned HTTP 401.',
      httpStatusCode: 401,
    });
    consoleError.mockRestore();
  });

  it('deletes deterministic thumbnail objects inside the existing flight deletion transaction', async () => {
    const generateForFlight = vi.fn<(flightId: string) => Promise<void>>(async () => undefined);
    const deleteForFlight = vi.fn<(input: { userId: string; flightId: string }) => Promise<void>>(async () => undefined);
    const thumbnailLifecycle = { generateForFlight, deleteForFlight };
    const storedFlight = {
      id: flightId,
      userId,
      igcFileId: 'file-1',
      bucketKey: 'glidehero-test/uploads/user-1/flight.igc',
      originalFilename: 'flight.igc',
      processingStatus: 'completed' as const,
    };
    const where = vi.fn(async () => [storedFlight]);
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: where })) })) })) })),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        execute: vi.fn(async () => ({ rows: [] })),
        delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    };
    const configuredStorage = storage(thumbnailLifecycle);
    const service = createAdminFlightService(database as never, { reprocess: vi.fn() }, configuredStorage);

    await expect(service.deleteFlight({ flightId, userId })).resolves.toBe('deleted');
    expect(deleteForFlight).toHaveBeenCalledWith({ userId, flightId });
  });

  it('keeps the database deletion retryable when thumbnail cleanup fails inside the transaction boundary', async () => {
    const deleteForFlight = vi.fn(async () => { throw new Error('thumbnail object store unavailable'); });
    const thumbnailLifecycle = { generateForFlight: vi.fn(async () => undefined), deleteForFlight };
    const storedFlight = {
      id: flightId,
      userId,
      igcFileId: 'file-1',
      bucketKey: 'glidehero-test/uploads/user-1/flight.igc',
      originalFilename: 'flight.igc',
      processingStatus: 'completed' as const,
    };
    const where = vi.fn(async () => [storedFlight]);
    const txDelete = vi.fn(async () => undefined);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      execute: vi.fn(async () => ({ rows: [] })),
      delete: vi.fn(() => ({ where: txDelete })),
    }));
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: where })) })) })) })),
      transaction,
    };
    const service = createAdminFlightService(database as never, { reprocess: vi.fn() }, storage(thumbnailLifecycle));

    await expect(service.deleteFlight({ flightId, userId })).rejects.toThrow('thumbnail object store unavailable');
    expect(transaction).toHaveBeenCalledOnce();
    expect(txDelete).toHaveBeenCalledOnce();
    expect(deleteForFlight).toHaveBeenCalledWith({ userId, flightId });
  });

  it('does not delete a completed flight while achievement replay is active', async () => {
    const storedFlight = {
      id: flightId,
      userId,
      igcFileId: 'file-1',
      bucketKey: 'glidehero-test/uploads/user-1/flight.igc',
      originalFilename: 'flight.igc',
      processingStatus: 'completed' as const,
    };
    const where = vi.fn(async () => [storedFlight]);
    const txDelete = vi.fn(async () => undefined);
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ active: true }] });
    const database = {
      select: vi.fn(() => ({ from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ limit: where })) })) })) })),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        execute,
        delete: vi.fn(() => ({ where: txDelete })),
      })),
    };
    const deleteForFlight = vi.fn(async () => undefined);
    const service = createAdminFlightService(database as never, { reprocess: vi.fn() }, storage({
      generateForFlight: vi.fn(async () => undefined),
      deleteForFlight,
    }));

    await expect(service.deleteFlight({ flightId, userId })).resolves.toBe('replay_active');
    expect(txDelete).not.toHaveBeenCalled();
    expect(deleteForFlight).not.toHaveBeenCalled();
  });
});
