import { describe, expect, it, vi } from 'vitest';
import { createTerritoryTileService } from '../../src/services/territoryTileService.js';

describe('group competition territory tiles', () => {
  it('requests a group-scoped tile and returns an empty tile when no cells match', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const service = createTerritoryTileService({ execute } as any, { cellSize: 500 });
    const result = await service.getGroupCompetitionTile?.({
      z: 8,
      x: 40,
      y: 90,
      groupId: '00000000-0000-0000-0000-000000000001',
      period: { competitionMonth: '2026-08' },
      pilotUserId: '00000000-0000-0000-0000-000000000002',
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ data: Buffer.alloc(0), featureCount: 0 });
  });
});
