import { describe, expect, it } from 'vitest';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

describe('Activity page rendering', () => {
  it('renders Monthly by default, a hidden Daily panel, winner links, and no All filter', async () => {
    const shell = createAuthenticatedShellModel({
      page: 'activity',
      user: { displayName: 'Viewer' },
      showFooter: true,
    });
    const html = await createAuthenticatedPageRenderer()({
      ...shell,
      page: 'activity',
      events: [],
      activitySearch: '',
      activityPilotResults: [],
      activityReturnTo: '/activity?scope=following',
      activityScope: 'following',
      activityScopeLinks: {
        following: '/activity?scope=following',
        yours: '/activity?scope=yours',
      },
      activityLoadMoreHref: '',
      activityLoadMoreEndpoint: '',
      activityStats: {
        monthly: {
          flightCount: '2',
          mostAccomplishments: { href: '/flights/accomplishments-flight', value: '4 accomplishments' },
          mostCells: { href: '/flights/cells-flight', value: '32 cells' },
          greatestFivePointDistance: { href: '/flights/distance-flight', value: '18.4 km' },
        },
        daily: {
          flightCount: '0',
          mostAccomplishments: null,
          mostCells: null,
          greatestFivePointDistance: null,
        },
      },
    });

    expect(html).toContain('data-activity-stats-button="monthly"');
    expect(html).toMatch(/data-activity-stats-button="monthly"[^>]+aria-pressed="true"/);
    expect(html).toMatch(/data-activity-stats-panel="daily"[^>]+hidden/);
    expect(html).toContain('href="/flights/accomplishments-flight"');
    expect(html).toContain('href="/flights/cells-flight"');
    expect(html).toContain('href="/flights/distance-flight"');
    expect(html.match(/No qualifying flight/g)).toHaveLength(3);
    expect(html).toContain('>Following</a>');
    expect(html).toContain('>Yours</a>');
    expect(html).not.toContain('>All</a>');
  });
});
