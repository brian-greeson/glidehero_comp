import { describe, expect, it, vi } from 'vitest';
import { createCompetitionGridClaimService } from '../../src/services/competitionGridClaimService.js';

describe('CompetitionGridClaimService', () => {
  it('returns an empty FeatureCollection when the month has no claims', async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: [] }));
    const service = createCompetitionGridClaimService({ execute } as never, { cellSize: 1_000 });

    await expect(service.getCurrent({ competitionMonth: '2026-07-19' })).resolves.toEqual({
      type: 'FeatureCollection',
      features: [],
    });
  });

  it('normalizes the month and ranks by IGC time and processing tie-breakers', async () => {
    const geojson = { type: 'FeatureCollection' as const, features: [] };
    const execute = vi.fn(async (_query: unknown) => ({ rows: [{ geojson }] }));
    const service = createCompetitionGridClaimService({ execute } as never, { cellSize: 1_000 });

    await service.getCurrent({ competitionMonth: '2026-07-19' });

    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('2026-07-01');
    expect(query).toContain('ROW_NUMBER');
    expect(query).toContain('claim_timestamp');
    expect(query).toContain('created_at');
    expect(query).toContain('claim_flight');
    expect(query).toContain('ownerUserId');
  });

  it('rejects an invalid competition date before querying', async () => {
    const execute = vi.fn();
    const service = createCompetitionGridClaimService({ execute } as never, { cellSize: 1_000 });

    await expect(service.getCurrent({ competitionMonth: '2026-02-29' })).rejects.toThrow(RangeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
