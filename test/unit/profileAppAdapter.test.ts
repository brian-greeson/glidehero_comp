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
      launchTime: '10:00 AM',
      launchTimestamp: Date.UTC(2026, 5, 5, 10),
      distance: '12.0 km',
      distanceMeters: 12_000,
      duration: '1h',
      durationSeconds: 3_600,
      directCellCount: 0,
      enclosedCellCount: 0,
      totalCellCount: 0,
      newPersonalCellCount: 0,
    },
  ],
  personalRecords: [],
  recentAchievements: [],
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
    expect(view.flights[0]).toMatchObject({
      id: 'flight-1', href: '/flights/flight-1', distanceMeters: 12_000, durationSeconds: 3_600,
    });
    expect(view.profileIsFollowed).toBe(true);
    expect(view.glider).toBeNull();
    expect(view.gliderEditor).toMatchObject({ hours: '0', error: '', isOpen: false });
  });

  it('formats persisted glider hours to one decimal place for display and editing', () => {
    const view = pilotProfileToView({
      ...summary,
      glider: {
        modelId: '00000000-0000-4000-8000-000000000017',
        manufacturer: 'Ozone',
        model: 'Ultralite 5',
        size: '17',
        year: 2025,
        competitionId: 'USA 42',
        enRating: 'C',
        hours: 12.25,
      },
    }, { isCurrent: true });

    expect(view.glider).toMatchObject({ model: 'Ultralite 5', hours: '12.3', enRating: 'C' });
    expect(view.gliderEditor).toMatchObject({ manufacturer: 'Ozone', size: '17', hours: '12.3' });
  });
});
