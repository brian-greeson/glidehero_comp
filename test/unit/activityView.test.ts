import { describe, expect, it } from 'vitest';
import { activityFeedItemToView, activityStatsToView } from '../../src/views/authenticated/adapters/activityView.js';

describe('activityFeedItemToView', () => {
  it('keeps real pilot and flight links while exposing badge metadata', () => {
    const view = activityFeedItemToView({
      id: 'activity-id', actorUserId: 'pilot-id', actorDisplayName: 'Alex Summit', activityType: 'flight',
      sourceFlightId: 'flight-id', publishedAt: new Date(Date.now() - 3_600_000), publishedAtIso: '', publishedAtLabel: 'Jul 22, 2026',
      flightDate: 'Jul 22, 2026', duration: '1h 00m', distance: '12 km', totalCellCount: 42, location: 'Alpine Arena',
      launchArenaName: 'Alpine Arena', launchArenaPath: '/arena/us/alpine-arena-1', likeCount: 2, viewerHasLiked: true, isOwn: false,
      accomplishments: [{ id: 'achievement-id', achievementKey: 'unique_cells_milestone', title: 'First Steps', description: 'Claim 10 cells.', badgeLabel: '10', category: 'general', kind: 'threshold', tone: 'green' }],
    });
    expect(view.pilot).toMatchObject({ displayName: 'Alex Summit', initials: 'AS', href: '/pilots/pilot-id' });
    expect(view.flight).toMatchObject({ id: 'flight-id', date: 'Jul 22, 2026', distance: '12 km', cells: '42' });
    expect(view.achievements[0]).toMatchObject({ badgeLabel: '10', tone: 'green', artworkKey: 'cell-explorer' });
    expect(view.activityId).toBe('activity-id');
    expect(view.likeCount).toBe(2);
    expect(view.viewerHasLiked).toBe(true);
  });

  it('formats both statistics periods and preserves missing winners', () => {
    const accomplishments = [1, 2, 3, 4].map((value) => ({
      id: `achievement-${value}`,
      achievementKey: 'unique_cells_milestone',
      title: `${value} Cells`,
      description: 'Claim cells.',
      badgeLabel: String(value),
      category: 'general',
      kind: 'threshold',
      tone: 'green' as const,
    }));
    const winner = (flightId: string, value: number, flightAccomplishments = accomplishments.slice(0, 1)) => ({
      flightId,
      value,
      actorUserId: 'pilot-id',
      actorDisplayName: 'Alex Summit',
      accomplishments: flightAccomplishments,
    });
    const view = activityStatsToView({
      monthly: {
        flightCount: 12,
        mostAccomplishments: winner('monthly-accomplishments', 4, accomplishments),
        mostCells: winner('monthly-cells', 1),
        greatestFivePointDistance: winner('monthly-distance', 12_345),
      },
      daily: {
        flightCount: 0,
        mostAccomplishments: null,
        mostCells: null,
        greatestFivePointDistance: null,
      },
    });

    expect(view.monthly).toMatchObject({
      flightCount: '12',
      mostAccomplishments: {
        href: '/flights/monthly-accomplishments',
        value: '4 achievements',
        pilot: { displayName: 'Alex Summit', initials: 'AS', href: '/pilots/pilot-id' },
        achievementOverflowCount: 1,
      },
      mostCells: { href: '/flights/monthly-cells', value: '1 cell' },
      greatestFivePointDistance: { href: '/flights/monthly-distance', value: '12.3 km' },
    });
    expect(view.monthly.mostAccomplishments?.achievements).toHaveLength(3);
    expect(view.daily).toEqual({
      flightCount: '0',
      mostAccomplishments: null,
      mostCells: null,
      greatestFivePointDistance: null,
    });
  });
});
