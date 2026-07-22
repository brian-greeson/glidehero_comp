import { describe, expect, it } from 'vitest';
import { createAchievementsPageModel } from '../../src/views/authenticated/adapters/achievementView.js';
import { authenticatedPageFixture } from '../../src/views/authenticated/fixtures.js';
import type { PilotAchievementsSummary } from '../../src/services/profileService.js';

function profile(): PilotAchievementsSummary {
  return {
    userId: 'pilot-1',
    displayName: 'Alex Summit',
    achievementProgress: [
      {
        key: 'unique_cells',
        achievementType: 'unique_cells_milestone',
        badgeLabel: '10',
        badgeAriaLabel: 'Unique cell milestone progress toward 10',
        typeLabel: 'Unique cell milestone',
        title: '10 Unique Cells',
        currentValue: 0,
        targetValue: 10,
        currentLabel: '0',
        targetLabel: '10',
        progressPercent: 0,
        currentDescription: 'Claim 10 more cells on your Personal Map.',
        otherDescription: 'Alex needs 10 more cells.',
      },
      {
        key: 'general_coverage',
        achievementType: 'threshold',
        achievementCategory: 'general',
        badgeLabel: '10%',
        badgeAriaLabel: 'General Arena coverage progress toward 10%',
        typeLabel: 'General Arena coverage',
        title: '10% General Arena Coverage',
        currentValue: 0,
        targetValue: 10,
        currentLabel: '0%',
        targetLabel: '10%',
        progressPercent: 0,
        currentDescription: 'Claim cells in a General Arena.',
        otherDescription: 'Alex needs to claim cells.',
      },
    ],
    achievementCount: 4,
    achievements: [
      {
        id: 'a1', achievementKey: 'unique_cells_milestone', achievementType: 'unique_cells_milestone', typeLabel: 'Unique cell milestone',
        earnedDate: 'Jun 5, 2026', sourceFlightId: null, title: 'First Steps',
        description: 'Claim 10 unique cells.', badgeLabel: '10',
      },
      {
        id: 'a2', achievementKey: 'most_launches_tagged_one_flight', achievementType: 'record', achievementCategory: 'launch', typeLabel: 'Launch Arena personal best',
        earnedDate: 'Jun 6, 2026', sourceFlightId: null, title: 'Launch Record',
        description: 'Tagged 3 Launch Arenas.', badgeLabel: '3',
      },
      {
        id: 'a3', achievementKey: 'general_arenas_explored_1', achievementType: 'threshold', achievementCategory: 'general', typeLabel: 'General Arena',
        earnedDate: 'Jun 7, 2026', sourceFlightId: null, title: 'Arena Explorer',
        description: 'Explore a General Arena.', badgeLabel: '1',
      },
      {
        id: 'a4', achievementKey: 'took_lead_in_arena', achievementType: 'special', achievementCategory: 'leadership', typeLabel: 'Arena Leadership',
        earnedDate: 'Jun 8, 2026', sourceFlightId: null, title: 'Arena Leader',
        description: 'Take the lead in an Arena.', badgeLabel: '★',
      },
    ],
  };
}

describe('achievements page adapter', () => {
  it('maps service semantics to the four badge families and keeps the newest three', () => {
    const fixture = authenticatedPageFixture('achievements');
    if (fixture.page !== 'achievements') throw new Error('Expected achievements fixture.');
    const { page: _page, metrics: _metrics, earned: _earned, inProgress: _progress, recentlyEarned: _recent, ...shell } = fixture;
    const model = createAchievementsPageModel(profile(), shell);

    expect(model.metrics.map((metric) => metric.value)).toEqual(['4', '2']);
    expect(model.earned.map((achievement) => achievement.tone)).toEqual(['green', 'blue', 'orange', 'purple']);
    expect(model.earned.map((achievement) => achievement.artworkKey)).toEqual(['cell-explorer', 'distance-record', 'mapper', 'top-cell-holder']);
    expect(model.inProgress.map((achievement) => achievement.tone)).toEqual(['green', 'orange']);
    expect(model.inProgress.map((achievement) => achievement.artworkKey)).toEqual(['cell-explorer', 'mapper']);
    expect(model.recentlyEarned).toHaveLength(3);
    expect(model.inProgress[0]).toMatchObject({ current: '0', target: '10', percent: 0 });
    expect(model.inProgress[0]).not.toHaveProperty('reward');
    expect(model.earned[0]).not.toHaveProperty('points');
  });
});
