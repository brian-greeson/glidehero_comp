import { describe, expect, it, vi } from 'vitest';
import { createGridClaimService } from '../../src/services/gridClaimService.js';

const flightId = '00000000-0000-4000-8000-000000000020';
const userId = '00000000-0000-4000-8000-000000000030';

function processingDatabaseDouble(counts = { directCellCount: 3, enclosedCellCount: 0 }) {
  const where = vi.fn(async () => undefined);
  const execute = vi.fn(async (_query: unknown) => ({ rows: [counts] }));
  const deleteFrom = vi.fn(() => ({ where }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    delete: deleteFrom,
    execute,
  }));

  return { database: { transaction }, where, execute, deleteFrom, transaction };
}

function projectionDatabaseDouble(rows: unknown[] = []) {
  const execute = vi.fn(async () => ({ rows }));
  return { database: { execute }, execute };
}

describe('GridClaimService', () => {
  it('replaces a flight’s existing cells and reports direct and enclosed claims', async () => {
    const { database, where, execute, deleteFrom, transaction } = processingDatabaseDouble({
      directCellCount: 3,
      enclosedCellCount: 2,
    });
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.process({ flightId, userId, launchTimezone: 'America/Denver' })).resolves.toEqual({
      flightId,
      cellSize: 1_000,
      directCellCount: 3,
      enclosedCellCount: 2,
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('splits projected segments before generating direct-cell grid candidates', async () => {
    const { database, execute } = processingDatabaseDouble();
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await service.process({ flightId, userId, launchTimezone: 'America/Denver' });

    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain('ST_Segmentize');
  });

  it('groups competition events by launch-local month and keeps Personal winners global', async () => {
    const { database, execute } = processingDatabaseDouble();
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await service.process({ flightId, userId, launchTimezone: 'America/Denver' });

    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('AT TIME ZONE');
    expect(query).toContain('competition_grid_claims');
    expect(query).toContain('competition_month');
    expect(query).toContain('personal_winning_candidates');
  });

  it('returns an empty FeatureCollection when the user owns no cells', async () => {
    const { database, execute } = projectionDatabaseDouble();
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.get({ userId })).resolves.toEqual({ type: 'FeatureCollection', features: [] });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns the projected WGS84 features from the query', async () => {
    const geojson = {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      }],
    };
    const { database } = projectionDatabaseDouble([{ geojson }]);
    const service = createGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.get({ userId })).resolves.toEqual(geojson);
  });
});
