import { describe, expect, it } from 'vitest';
import { createAuthenticatedShellModel } from '../../src/views/authenticated/adapters/shellModel.js';
import { createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';

describe('group app renderer', () => {
  it('renders the members-only monthly competition controls and accessible owner actions', async () => {
    const shell = createAuthenticatedShellModel({ page: 'group', user: { displayName: 'Sky Pilot' } });
    const html = await createAuthenticatedPageRenderer()({
      ...shell,
      page: 'group',
      group: {
        id: '00000000-0000-4000-8000-000000000101', name: 'Weekend XC', initials: 'WX', month: '2026-08', monthLabel: 'August 2026',
        memberCount: '200', capacity: '200', isOwner: true,
        inviteHref: '#group-member-management',
        deleteHref: '/groups/group/delete', inviteSearchHref: '/v1/groups/group/invite-candidates', inviteSubmitHref: '/groups/group/invitations',
        members: [{ userId: 'pilot', displayName: 'Cloud Dancer', status: 'pending', cancelHref: '/groups/group/invitations/pilot/cancel' }],
      },
      standings: [{ userId: 'pilot', displayName: 'Cloud Dancer', initials: 'CD', color: '#1769AA', rank: null, cells: '0', fivePointDistance: '—', isDistanceLeader: false, isCurrent: false, filterHref: '/groups/group?month=2026-08&pilot=pilot' }],
      flights: [{ id: 'flight', pilotName: 'Cloud Dancer', pilotInitials: 'CD', pilotColor: '#1769AA', launchTime: 'Aug 3, 8:15 AM', fivePointDistance: '42 km', duration: '2h 10m', thumbnail: { wideUrl: 'https://example.test/wide.webp', squareUrl: 'https://example.test/square.webp' }, detailHref: '/flights/flight', trackHref: '/v1/groups/group/flights/flight/track?month=2026-08' }],
      mapStyleUrl: 'https://example.test/style.json', tileUrl: '/tiles/{z}/{x}/{y}', pilotColorsJson: '{"pilot":"#1769AA"}', standingsLoadMoreHref: '/v1/groups/group/standings?month=2026-08&offset=25',
      flightsLoadMoreHref: '/v1/groups/group/flights?month=2026-08&cursor=next',
    });
    expect(html).toContain('Not ranked yet');
    expect(html).toContain('data-group-pilot-colors');
    expect(html).toContain('data-group-flight-track');
    expect(html).toContain('https://example.test/wide.webp');
    expect(html).toContain('data-group-flights-load-more');
    expect(html).toContain('name="userId"');
    expect(html).toContain('Load more');
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain('August 2026');
    expect(html).toContain('href="#group-member-management"');
    expect(html).toContain('data-flight-thumbnail');
    expect(html).toContain('aria-pressed="false"');
  });
});
