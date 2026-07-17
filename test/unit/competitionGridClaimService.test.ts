import { describe, expect, it, vi } from 'vitest';
import { createCompetitionGridClaimService } from '../../src/services/competitionGridClaimService.js';

describe('CompetitionGridClaimService', () => {
  it('writes only competition history in its own transaction', async () => {
    const where = vi.fn(async () => undefined);
    const execute = vi.fn(async (_query: unknown) => ({ rows: [] }));
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      delete: vi.fn(() => ({ where })),
      execute,
    }));
    const service = createCompetitionGridClaimService({ transaction } as never, { cellSize: 1_000 });
    expect(Object.keys(service)).toEqual(['process']);

    await service.process({
      flightId: '00000000-0000-4000-8000-000000000020',
      userId: '00000000-0000-4000-8000-000000000030',
      launchTimezone: 'America/Denver',
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('competition_grid_claims');
    expect(query).toContain('AT TIME ZONE');
    expect(query).not.toContain('personal_grid_claims');
  });
});
