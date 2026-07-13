import { describe, expect, it, vi } from 'vitest';
import { createFlightAreaDetectionService } from '../../src/services/flightAreaDetectionService.js';

const flightId = '00000000-0000-4000-8000-000000000020';

function databaseDouble(options: { detectedAreaCount?: number; transactionError?: Error } = {}) {
  const deleteWhere = vi.fn(async () => undefined);
  const execute = vi.fn(async () => ({ rows: [{ detectedAreaCount: options.detectedAreaCount ?? 0 }] }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    if (options.transactionError) throw options.transactionError;
    return callback({
      delete: vi.fn(() => ({ where: deleteWhere })),
      execute,
    });
  });

  return { database: { transaction }, deleteWhere, execute, transaction };
}

describe('FlightAreaDetectionService', () => {
  it('replaces prior areas and returns the number of detected claims', async () => {
    const { database, deleteWhere, execute, transaction } = databaseDouble({ detectedAreaCount: 3 });
    const service = createFlightAreaDetectionService(database as never);

    await expect(service.detect({ flightId })).resolves.toEqual({ flightId, detectedAreaCount: 3 });

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('propagates transaction failures for a later retry', async () => {
    const transactionError = new Error('database unavailable');
    const { database } = databaseDouble({ transactionError });
    const service = createFlightAreaDetectionService(database as never);

    await expect(service.detect({ flightId })).rejects.toBe(transactionError);
  });
});
