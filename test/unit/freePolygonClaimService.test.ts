import { describe, expect, it, vi } from 'vitest';
import { createFreePolygonClaimService } from '../../src/services/freePolygonClaimService.js';

const flightId = '00000000-0000-4000-8000-000000000020';
const userId = '00000000-0000-4000-8000-000000000030';

function detectionDatabaseDouble(options: { detectedAreaCount?: number; transactionError?: Error } = {}) {
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

function projectionDatabaseDouble() {
  const limit = vi.fn(async () => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return { database: { select }, select };
}

function processDatabaseDouble(events: string[]) {
  let transactionCount = 0;
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    transactionCount += 1;
    if (transactionCount === 1) {
      return callback({
        delete: vi.fn(() => ({ where: vi.fn(async () => { events.push('detect-delete'); }) })),
        execute: vi.fn(async () => {
          events.push('detect-insert');
          return { rows: [{ detectedAreaCount: 2 }] };
        }),
      });
    }

    let executeCount = 0;
    return callback({
      delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      execute: vi.fn(async () => {
        executeCount += 1;
        events.push(executeCount === 1 ? 'projection-lock' : 'projection-upsert');
        return { rows: executeCount === 1 ? [] : [{ geojson: { type: 'FeatureCollection', features: [] } }] };
      }),
    });
  });
  const select = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) }));

  return { transaction, select };
}

describe('FreePolygonClaimService', () => {
  it('replaces prior areas and returns the number of detected claims', async () => {
    const { database, deleteWhere, execute, transaction } = detectionDatabaseDouble({ detectedAreaCount: 3 });
    const service = createFreePolygonClaimService(database as never);

    await expect(service.detect({ flightId })).resolves.toEqual({ flightId, detectedAreaCount: 3 });

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('propagates transaction failures for a later retry', async () => {
    const transactionError = new Error('database unavailable');
    const { database } = detectionDatabaseDouble({ transactionError });
    const service = createFreePolygonClaimService(database as never);

    await expect(service.detect({ flightId })).rejects.toBe(transactionError);
  });

  it('returns an empty FeatureCollection when no stored projection exists', async () => {
    const { database, select } = projectionDatabaseDouble();
    const service = createFreePolygonClaimService(database as never);

    await expect(service.get({ userId })).resolves.toEqual({ type: 'FeatureCollection', features: [] });

    expect(select).toHaveBeenCalledOnce();
  });

  it('does not share the empty projection between reads', async () => {
    const { database } = projectionDatabaseDouble();
    const service = createFreePolygonClaimService(database as never);

    const first = await service.get({ userId });
    const second = await service.get({ userId });

    expect(first).not.toBe(second);
  });

  it('detects a flight before refreshing its pilot projection', async () => {
    const events: string[] = [];
    const database = processDatabaseDouble(events);
    const service = createFreePolygonClaimService(database as never);

    await expect(service.process({ flightId, userId })).resolves.toEqual({ flightId, detectedAreaCount: 2 });

    expect(events).toEqual(['detect-delete', 'detect-insert', 'projection-lock', 'projection-upsert']);
  });
});
