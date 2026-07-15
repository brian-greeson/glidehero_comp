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

  it('builds a full-cell viewport leaderboard from a YYYY-MM value', async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: [{
      userId: '00000000-0000-4000-8000-000000000001',
      displayName: 'Alpha Pilot',
      claimedCellCount: 2,
      claimedAreaSquareMeters: 2_000_000,
      rank: 1,
      isCurrentPilotOnly: false,
      displayPosition: 1,
      claimedCellCountTotal: 2,
      claimedAreaSquareMetersTotal: 2_000_000,
      flightCount: 1,
      pilotCount: 1,
      currentPilotFlightCount: 1,
      visibleCellCount: 20,
      claimedPercentage: 10,
    }] }));
    const service = createCompetitionGridClaimService({ execute } as never, { cellSize: 1_000 });

    await expect(service.getViewportLeaderboard({
      competitionMonth: '2026-07',
      west: -107,
      south: 39,
      east: -105,
      north: 41,
      currentUserId: '00000000-0000-4000-8000-000000000001',
    })).resolves.toEqual({
      leaders: [{
        userId: '00000000-0000-4000-8000-000000000001',
        displayName: 'Alpha Pilot',
        claimedCellCount: 2,
        claimedAreaSquareMeters: 2_000_000,
        rank: 1,
      }],
      currentPilot: null,
      stats: {
        claimedCellCount: 2,
        claimedAreaSquareMeters: 2_000_000,
        flightCount: 1,
        pilotCount: 1,
        currentPilotFlightCount: 1,
        visibleCellCount: 20,
        claimedPercentage: 10,
      },
    });

    const query = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(query).toContain('2026-07-01');
    expect(query).toContain('ST_Intersects');
    expect(query).toContain('display_position <= 10');
  });

  it('rejects a full date before executing a leaderboard query', async () => {
    const execute = vi.fn();
    const service = createCompetitionGridClaimService({ execute } as never, { cellSize: 1_000 });

    await expect(service.getViewportLeaderboard({
      competitionMonth: '2026-07-14',
      west: -107,
      south: 39,
      east: -105,
      north: 41,
      currentUserId: '00000000-0000-4000-8000-000000000001',
    })).rejects.toThrow(RangeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
