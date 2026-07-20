import { describe, expect, it, vi } from 'vitest';
import { createMonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';

describe('MonthlyCoverageService', () => {
  it('rejects invalid months before querying', async () => {
    const execute = vi.fn();
    const service = createMonthlyCoverageService({ execute } as never, { cellSize: 1_000 });
    await expect(service.getGlobalLeaderboard({
      competitionMonth: '2026-13', west: -180, south: -89, east: 180, north: 89,
      currentUserId: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow(RangeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
