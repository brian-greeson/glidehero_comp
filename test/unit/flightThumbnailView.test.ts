import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityFeedItemToView } from '../../src/views/authenticated/adapters/activityView.js';
import type { ActivityFeedItem } from '../../src/services/activityService.js';

describe('flight thumbnail view delivery', () => {
  it('keeps adapter flight-only behavior and exposes signed URLs', () => {
    const base: ActivityFeedItem = {
      id: 'activity-1', actorUserId: 'user-1', actorDisplayName: 'Pilot', activityType: 'challenge', sourceFlightId: null,
      publishedAt: new Date(), publishedAtIso: '', publishedAtLabel: '', accomplishments: [], likeCount: 0,
      viewerHasLiked: false, isOwn: false,
    };
    expect(activityFeedItemToView(base).flight).toBeUndefined();
    const flight = activityFeedItemToView({
      ...base, activityType: 'flight', sourceFlightId: 'flight-1', flightDate: 'Jul 22, 2026', distance: '1 km', totalCellCount: 2,
    }, { thumbnailUrls: new Map([['flight-1', { wideUrl: 'wide', squareUrl: 'square' }]]) });
    expect(flight.flight?.thumbnail).toEqual({ wideUrl: 'wide', squareUrl: 'square' });
    expect(flight.flight?.href).toBe('/flights/flight-1');
  });

  it('uses aspect-ratio responsive CSS and delegated image fallback handling', () => {
    const css = readFileSync('public/styles/app-ui/flight-thumbnails.css', 'utf8');
    const script = readFileSync('public/scripts/app-ui/app.js', 'utf8');
    const template = readFileSync('src/views/authenticated/components/flightMapPreview.vto', 'utf8');
    expect(css).toContain('aspect-ratio: 16 / 9');
    expect(css).toContain('aspect-ratio: 1');
    expect(script).toContain("data-flight-thumbnail");
    expect(script).toContain('/flight-thumbnail-fallback.webp');
    expect(template).not.toContain('onerror=');
  });
});
