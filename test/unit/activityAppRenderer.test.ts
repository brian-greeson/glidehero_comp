import { describe, expect, it } from 'vitest';
import { authenticatedPageFixture } from '../../src/views/authenticated/fixtures.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

describe('refreshed Activity search UI', () => {
  it('renders server-backed pilot results with follow controls and preserves scope/query links', async () => {
    const model = structuredClone(authenticatedPageFixture('activity'));
    if (model.page !== 'activity') throw new Error('Expected Activity fixture.');
    model.activitySearch = 'cloud';
    model.activityReturnTo = '/activity?q=cloud&scope=following';
    model.activityScope = 'following';
    model.activityScopeLinks = {
      all: '/activity?q=cloud',
      following: '/activity?q=cloud&scope=following',
      yours: '/activity?q=cloud&scope=yours',
    };
    model.activityPilotResults = [{
      userId: '00000000-0000-4000-8000-000000000001',
      displayName: 'Cloud Dancer',
      initials: 'CD',
      color: '#1769aa',
      href: '/pilots/00000000-0000-4000-8000-000000000001',
      isFollowing: false,
    }];

    const html = await createAuthenticatedPageRenderer()(model);

    expect(html).toContain('id="activity-pilot-query"');
    expect(html).toContain('Cloud Dancer');
    expect(html).toContain('action="/pilots/00000000-0000-4000-8000-000000000001/follow"');
    expect(html).toContain('value="/activity?q=cloud&amp;scope=following"');
    expect(html).toContain('href="/activity?q=cloud&amp;scope=yours"');
    expect(html).toContain('aria-current="page">Following');
  });

  it('renders an explicit empty state for a pilot search with no matches', async () => {
    const model = structuredClone(authenticatedPageFixture('activity'));
    if (model.page !== 'activity') throw new Error('Expected Activity fixture.');
    model.activitySearch = 'missing';
    model.activityPilotResults = [];
    const html = await createAuthenticatedPageRenderer()(model);
    expect(html).toContain('No pilots matched “missing”.');
  });
});
