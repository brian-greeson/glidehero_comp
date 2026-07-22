import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appPageFixture } from '../../src/views/app/fixtures.js';
import { createAppPageRenderer } from '../../src/views/app/appRenderer.js';
import { activityFeedItemToView } from '../../src/views/app/adapters/activityView.js';
import type { ActivityFeedItem } from '../../src/services/activityService.js';

describe('flight thumbnail view delivery', () => {
  it('renders thumbnails only for flight activity rows with responsive sources and exact alt text', async () => {
    const model = structuredClone(appPageFixture('activity'));
    if (model.page !== 'activity') throw new Error('Expected activity fixture.');
    const flightEvent = model.events[1]!;
    if (!flightEvent.flight) throw new Error('Expected fixture flight.');
    flightEvent.flight.thumbnail = { wideUrl: '/signed-wide.webp', squareUrl: '/signed-square.webp' };
    const html = await createAppPageRenderer()(model);

    expect(html).toContain('srcset="/signed-square.webp"');
    expect(html).toContain('src="/signed-wide.webp"');
    expect(html).toContain('alt="Flight territory preview"');
    expect(html).toContain('class="flight-thumbnail"');
    expect(html).not.toContain('srcset="/signed-square.webp""');
    const nonFlightStart = html.indexOf('data-activity-kind="achievements"');
    const nonFlightEnd = html.indexOf('</article>', nonFlightStart);
    expect(html.slice(nonFlightStart, nonFlightEnd)).not.toContain('flight-thumbnail');
  });

  it('uses the square-safe fallback when a profile flight has no signed pair', async () => {
    const model = structuredClone(appPageFixture('profile'));
    if (model.page !== 'profile') throw new Error('Expected profile fixture.');
    const html = await createAppPageRenderer()(model);

    expect(html).toContain('src="/flight-thumbnail-fallback.webp"');
    expect(html.match(/alt="Flight territory preview"/g)?.length).toBe(model.flights.length);
  });

  it('keeps adapter flight-only behavior and exposes signed URLs', () => {
    const base: ActivityFeedItem = {
      id: 'activity-1', actorUserId: 'user-1', actorDisplayName: 'Pilot', activityType: 'challenge', sourceFlightId: null,
      publishedAt: new Date(), publishedAtIso: '', publishedAtLabel: '', accomplishments: [], thermalCount: 0,
      viewerHasReacted: false, isOwn: false,
    };
    expect(activityFeedItemToView(base).flight).toBeUndefined();
    const flight = activityFeedItemToView({
      ...base, activityType: 'flight', sourceFlightId: 'flight-1', flightDate: 'Jul 22, 2026', distance: '1 km', totalCellCount: 2,
    }, { thumbnailUrls: new Map([['flight-1', { wideUrl: 'wide', squareUrl: 'square' }]]) });
    expect(flight.flight?.thumbnail).toEqual({ wideUrl: 'wide', squareUrl: 'square' });
  });

  it('uses aspect-ratio responsive CSS and delegated image fallback handling', () => {
    const css = readFileSync('public/styles/app-ui/flight-thumbnails.css', 'utf8');
    const script = readFileSync('public/scripts/app-ui/app.js', 'utf8');
    const template = readFileSync('src/views/app/components/flightMapPreview.vto', 'utf8');
    expect(css).toContain('aspect-ratio: 16 / 9');
    expect(css).toContain('aspect-ratio: 1');
    expect(script).toContain("data-flight-thumbnail");
    expect(script).toContain('/flight-thumbnail-fallback.webp');
    expect(template).not.toContain('onerror=');
  });
});
