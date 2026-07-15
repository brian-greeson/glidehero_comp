import { describe, expect, it, vi } from 'vitest';
import { createPersonalGridClaimService } from '../../src/services/gridClaimService.js';

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
  const execute = vi.fn(async (_query: unknown) => ({ rows }));
  return { database: { execute }, execute };
}

describe('PersonalGridClaimService', () => {
  it('replaces a flight’s existing cells and reports direct and enclosed claims', async () => {
    const { database, where, execute, deleteFrom, transaction } = processingDatabaseDouble({
      directCellCount: 3,
      enclosedCellCount: 2,
    });
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.process({ flightId, userId })).resolves.toEqual({
      flightId,
      cellSize: 1_000,
      directCellCount: 3,
      enclosedCellCount: 2,
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteFrom).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('splits projected segments before generating direct-cell grid candidates', async () => {
    const { database, execute } = processingDatabaseDouble();
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await service.process({ flightId, userId });

    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain('ST_Segmentize');
  });

  it('writes only pilot-scoped personal contributions', async () => {
    const { database, execute } = processingDatabaseDouble();
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await service.process({ flightId, userId });

    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('user_grid_claims');
    expect(query).toContain('candidate_events');
    expect(query).not.toContain('competition_grid_claims');
  });

  it('returns an empty FeatureCollection when the user owns no cells', async () => {
    const { database, execute } = projectionDatabaseDouble();
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

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
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.get({ userId })).resolves.toEqual(geojson);
  });

  it('returns full-cell viewport stats with distinct contributing flights', async () => {
    const stats = {
      claimedCellCount: 2,
      claimedAreaSquareMeters: 2_000_000,
      flightCount: 2,
      visibleCellCount: 8,
      claimedPercentage: 25,
    };
    const { database, execute } = projectionDatabaseDouble([stats]);
    const service = createPersonalGridClaimService(database as never, { cellSize: 1_000 });

    await expect(service.getViewportStats({
      userId,
      west: -1,
      south: -1,
      east: 1,
      north: 1,
    })).resolves.toEqual(stats);

    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('ST_Intersects');
    expect(query).toContain('COUNT(DISTINCT claim_flight)');
    expect(query).toContain('viewport_grid_total');
  });
});
