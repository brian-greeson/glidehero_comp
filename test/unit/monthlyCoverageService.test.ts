import { describe, expect, it, vi } from 'vitest';
import { createMonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';

describe('MonthlyCoverageService', () => {
  it('rejects invalid months before querying', async () => {
    const execute = vi.fn();
    const service = createMonthlyCoverageService({ execute } as never, { cellSize: 1_000 });
    await expect(service.getGlobalTerritory({ competitionMonth: '2026-13' })).rejects.toThrow(RangeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
