import { describe, expect, it } from 'vitest';
import { createAchievementsPageModel } from '../../src/views/app/adapters/achievementView.js';
import { pilotProfileToView } from '../../src/views/app/adapters/profileView.js';
import { createAppShellModel } from '../../src/views/app/adapters/shellModel.js';
import { createAppPageRenderer } from '../../src/views/app/appRenderer.js';
import type { PilotProfileSummary } from '../../src/services/profileService.js';

function productionProfile(overrides: Partial<PilotProfileSummary> = {}): PilotProfileSummary {
  return {
    userId: '00000000-0000-4000-8000-000000000099',
    displayName: 'Production Pilot',
    territoryColor: '#1769AA',
    lifetimeUniqueCellCount: 42,
    nextUniqueCellMilestone: 50,
    uniqueCellsToNextMilestone: 8,
    nextUniqueCellMilestoneProgressPercent: 84,
    achievementProgress: [{
      key: 'unique_cells',
      achievementType: 'unique_cells_milestone',
      badgeLabel: '50',
      badgeAriaLabel: 'Unique cell milestone progress toward 50',
      typeLabel: 'Unique cell milestone',
      title: '50 Unique Cells',
      currentValue: 42,
      targetValue: 50,
      currentLabel: '42',
      targetLabel: '50',
      progressPercent: 84,
      currentDescription: 'Claim 8 more cells on your Personal Map.',
      otherDescription: 'Production Pilot needs 8 more cells.',
    }],
    completedFlightCount: 4,
    lifetimeDirectCellCount: 35,
    lifetimeEnclosedCellCount: 7,
    currentTotalCellRecord: 12,
    currentEnclosedCellRecord: 4,
    achievementCount: 4,
    followerCount: 3,
    followingCount: 2,
    achievements: [0, 1, 2, 3].map((index) => ({
      id: `achievement-${index}`,
      achievementType: index === 1 ? 'record' : index === 2 ? 'threshold' : index === 3 ? 'special' : 'unique_cells_milestone',
      achievementCategory: index === 1 ? 'launch' : index === 2 ? 'general' : index === 3 ? 'leadership' : undefined,
      typeLabel: index === 1 ? 'Personal best' : 'Milestone',
      earnedDate: `Jun ${index + 1}, 2026`,
      sourceFlightId: null,
      title: `Production Achievement ${index}`,
      description: 'A production achievement.',
      badgeLabel: String(index + 1),
    })),
    recentFlights: [0, 1, 2, 3].map((index) => ({
      flightId: `production-flight-${index}`,
      flightDate: `Jun ${index + 1}, 2026`,
      distance: `${index + 1}.0 km`,
      duration: '1h',
      directCellCount: index,
      enclosedCellCount: 0,
      totalCellCount: index,
      newPersonalCellCount: index,
    })),
    currentArenaLeaderships: [0, 1, 2, 3].map((index) => ({
      arenaId: `arena-${index}`,
      arenaName: `Production Arena ${index}`,
      arenaType: 'state' as const,
      arenaPath: `/arena/production/${index}`,
      status: 'sole' as const,
      cellsClaimed: index,
      coveragePercent: null,
      leadMarginCells: index,
      leadingSince: `Jun ${index + 1}, 2026`,
    })),
    ...overrides,
  };
}

describe('production Profile and Achievements rendering', () => {
  const render = createAppPageRenderer();

  it('renders a populated public profile with real counts, follow state, and disclosure rows', async () => {
    const profile = productionProfile();
    const shell = createAppShellModel({
      page: 'profile',
      user: { displayName: 'Viewer' },
      isAdmin: false,
      showFooter: true,
    });
    const html = await render({
      ...shell,
      page: 'profile',
      ...pilotProfileToView(profile, {
        isCurrent: false,
        isFollowed: false,
        currentPath: '/pilots/00000000-0000-4000-8000-000000000099',
      }),
    });

    expect(html).toContain('Production Pilot');
    expect(html).toMatch(/Followers<\/dt><dd>3<\/dd>/);
    expect(html).toMatch(/Following<\/dt><dd>2<\/dd>/);
    expect(html).toContain('action="/pilots/00000000-0000-4000-8000-000000000099/follow"');
    expect(html).toContain('value="/pilots/00000000-0000-4000-8000-000000000099"');
    expect(html).toContain('Show all');
    expect(html).toContain('Production Arena 3');
    expect(html).toContain('Jun 4, 2026');
    expect(html).not.toContain('Personal Map Preview');
    expect(html).not.toContain('Ozone');
    expect(html).not.toContain('Alex Summit');
  });

  it('renders followed state, empty sections, explicit zero values, and preview-only glider', async () => {
    const profile = productionProfile({
      displayName: 'Empty Pilot',
      lifetimeUniqueCellCount: 0,
      completedFlightCount: 0,
      achievementCount: 0,
      followerCount: 0,
      followingCount: 0,
      achievementProgress: [],
      achievements: [],
      recentFlights: [],
      currentArenaLeaderships: [],
    });
    const shell = createAppShellModel({ page: 'profile', user: { displayName: 'Viewer' }, showFooter: true });
    const html = await render({
      ...shell,
      page: 'profile',
      ...pilotProfileToView(profile, { isCurrent: false, isFollowed: true, currentPath: '/pilots/empty' }),
    });

    expect(html).toMatch(/Followers<\/dt><dd>0<\/dd>/);
    expect(html).toMatch(/Following<\/dt><dd>0<\/dd>/);
    expect(html).toContain('action="/pilots/00000000-0000-4000-8000-000000000099/unfollow"');
    expect(html).toContain('No current Arena titles yet.');
    expect(html).toContain('No completed flights yet.');
    expect(html).not.toContain('glider-premium.png');

    const preview = await render({
      ...shell,
      page: 'profile',
      ...pilotProfileToView(profile, { preview: true, isCurrent: true }),
    });
    expect(preview).toContain('/images/app-ui/glider-premium.png');
  });

  it('renders earned dates, categories, recent first three, and empty states without point concepts', async () => {
    const profile = productionProfile();
    const shell = createAppShellModel({ page: 'achievements', user: { displayName: 'Viewer' }, showFooter: true });
    const html = await render({ ...createAchievementsPageModel(profile, shell) });

    expect(html).toContain('Earned Jun 1, 2026');
    expect(html).not.toContain('Achievement Points');
    expect(html).not.toContain('Reward:');
    expect(html).not.toContain(' pts');
    expect(html).toContain('Personal best');
    expect(html.match(/Production Achievement 3/g)).toHaveLength(2);
    expect(html).not.toContain('Trending Achievements');
    expect(html).not.toContain('Settings');
    expect(html).not.toContain('Notification');

    const empty = productionProfile({ achievementCount: 0, achievements: [], achievementProgress: [] });
    const emptyHtml = await render({ ...createAchievementsPageModel(empty, shell) });
    expect(emptyHtml).toContain('Achievements Earned</span>');
    expect(emptyHtml).toContain('>0<');
    expect(emptyHtml).toContain('No achievements earned yet.');
    expect(emptyHtml).toContain('You have no unfinished achievements right now.');
    expect(emptyHtml).toContain('No recently earned achievements.');
    expect(emptyHtml).toContain('Nothing in progress.');
  });
});
