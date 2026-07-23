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
    const pilot = {
      userId: 'pilot-id',
      displayName: 'Alex Summit',
      initials: 'AS',
      color: '#1769aa',
      href: '/pilots/pilot-id',
    };
    const achievements = [1, 2, 3].map((value) => ({
      key: `achievement-${value}`,
      artworkKey: 'cell-explorer' as const,
      title: `${value} Cells`,
      description: 'Claim cells.',
      badgeLabel: String(value),
      tone: 'green' as const,
    }));
    const winner = (href: string, value: string, options: { achievements?: typeof achievements; overflow?: number } = {}) => ({
      href,
      value,
      pilot,
      achievements: options.achievements ?? [],
      achievementOverflowCount: options.overflow ?? 0,
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
          mostAccomplishments: winner('/flights/accomplishments-flight', '4 achievements', { achievements, overflow: 1 }),
          mostCells: winner('/flights/cells-flight', '32 cells'),
          greatestFivePointDistance: winner('/flights/distance-flight', '18.4 km'),
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
    expect(html).toContain('Most achievements in one flight');
    expect(html).toContain('Most territory in one flight');
    expect(html).toContain('Longest 5 point flight');
    expect(html).toContain('activity-stat-tile__overflow">+1');
    expect(html.match(/No qualifying flight/g)).toHaveLength(3);
    expect(html).toContain('>Following</a>');
    expect(html).toContain('>My activity</a>');
    expect(html).not.toContain('>All</a>');
  });
});
