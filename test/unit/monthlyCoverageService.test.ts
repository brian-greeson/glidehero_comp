import { describe, expect, it, vi } from 'vitest';
import { createMonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';

describe('MonthlyCoverageService', () => {
  it('builds additive coverage queries without current-owner ranking', async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: [] }));
    const service = createMonthlyCoverageService({ execute } as never, { cellSize: 1_000 });
    await service.getGlobalTerritory({ competitionMonth: '2026-07', pilotUserId: '00000000-0000-4000-8000-000000000001' });
    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('SELECT DISTINCT');
    expect(query).toContain('cell_claimants');
    expect(query).toContain('claimantCount');
    expect(query).not.toContain('ROW_NUMBER');
  });

  it('rejects invalid months before querying', async () => {
    const execute = vi.fn();
    const service = createMonthlyCoverageService({ execute } as never, { cellSize: 1_000 });
    await expect(service.getGlobalTerritory({ competitionMonth: '2026-13' })).rejects.toThrow(RangeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
