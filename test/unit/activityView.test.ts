import { describe, expect, it } from 'vitest';
import { activityFeedItemToView } from '../../src/views/authenticated/adapters/activityView.js';

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
});
