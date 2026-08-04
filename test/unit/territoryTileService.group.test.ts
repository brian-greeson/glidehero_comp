import { describe, expect, it, vi } from 'vitest';
import { createTerritoryTileService } from '../../src/services/territoryTileService.js';

describe('group competition territory tiles', () => {
  it('requests a group-scoped tile and returns an empty tile when no cells match', async () => {
    const execute = vi.fn(async () => ({ rows: [{ data: Buffer.alloc(0), featureCount: 0, authorized: true }] }));
    const service = createTerritoryTileService({ execute } as any, { cellSize: 500 });
    const result = await service.getGroupCompetitionTile?.({
      z: 8,
      x: 40,
      y: 90,
      groupId: '00000000-0000-0000-0000-000000000001',
      currentUserId: '00000000-0000-0000-0000-000000000003',
      period: { competitionMonth: '2026-08' },
      pilotUserId: '00000000-0000-0000-0000-000000000002',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: Buffer.alloc(0), featureCount: 0, authorized: true });
  });

  it('reports a missing accepted actor membership as unauthorized', async () => {
    const execute = vi.fn(async () => ({ rows: [{ data: Buffer.alloc(0), featureCount: 0, authorized: false }] }));
    const service = createTerritoryTileService({ execute } as any, { cellSize: 500 });

    await expect(service.getGroupCompetitionTile?.({
      z: 8,
      x: 40,
      y: 90,
      groupId: '00000000-0000-0000-0000-000000000001',
      currentUserId: '00000000-0000-0000-0000-000000000003',
      period: { competitionMonth: '2026-08' },
    })).resolves.toMatchObject({ authorized: false, featureCount: 0 });
    expect(execute).toHaveBeenCalledOnce();
  });
});
