import { describe, expect, it } from 'vitest';
import { pilotProfileToView } from '../../src/views/authenticated/adapters/profileView.js';
import type { PilotProfileSummary } from '../../src/services/profileService.js';

const summary: PilotProfileSummary = {
  userId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Cloud Dancer',
  territoryColor: '#A1B2C3',
  lifetimeUniqueCellCount: 0,
  nextUniqueCellMilestone: 10,
  uniqueCellsToNextMilestone: 10,
  nextUniqueCellMilestoneProgressPercent: 0,
  completedFlightCount: 2,
  lifetimeDirectCellCount: 0,
  lifetimeEnclosedCellCount: 0,
  currentTotalCellRecord: null,
  currentEnclosedCellRecord: null,
  achievementCount: 0,
  followerCount: 0,
  followingCount: 0,
  recentFlights: [
    {
      flightId: 'flight-1',
      flightDate: 'Jun 5, 2026',
      distance: '12.0 km',
      duration: '1h',
      directCellCount: 0,
      enclosedCellCount: 0,
      totalCellCount: 0,
      newPersonalCellCount: 0,
    },
  ],
  currentArenaLeaderships: [{
    arenaId: 'arena-1',
    arenaName: 'Colorado',
    arenaType: 'state',
    arenaPath: '/arena/us/colorado-1',
    status: 'sole',
    cellsClaimed: 0,
    coveragePercent: null,
    leadMarginCells: 0,
    leadingSince: 'Jun 1, 2026',
  }],
};

describe('refreshed profile adapter', () => {
  it('keeps service values and omits fields absent from the production summary', () => {
    const view = pilotProfileToView(summary, { isCurrent: false, isFollowed: true });
    expect(view.profile.displayName).toBe('Cloud Dancer');
    expect(view.profile.followers).toBe('0');
    expect(view.profile.following).toBe('0');
    expect(view.profile).not.toHaveProperty('bio');
    expect(view.metrics.map((metric) => metric.value)).toEqual(['0', '2', '0']);
    expect(view.titles[0]).toMatchObject({ name: 'Colorado', detail: 'Top cell holder · 0 cells', isInitiallyVisible: true });
    expect(view.flights[0]).toMatchObject({ id: 'flight-1', href: '/flights/flight-1', cells: '0', isInitiallyVisible: true });
    expect(view.glider).toBeUndefined();
    expect(view.profileIsFollowed).toBe(true);
  });

  it('only exposes preview glider metadata when explicitly requested', () => {
    expect(pilotProfileToView(summary, { preview: true }).glider).toEqual(expect.objectContaining({
      imageSrc: '/images/app-ui/glider-premium.png',
    }));
  });
});
