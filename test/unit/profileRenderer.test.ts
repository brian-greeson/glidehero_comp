import { describe, expect, it } from 'vitest';
import { createPageRenderer } from '../../src/views/renderer.js';

function uniqueProgress(displayName: string, current: number, target: number) {
  const remaining = target - current;
  return [{
    key: 'unique_cells' as const,
    achievementType: 'unique_cells_milestone' as const,
    badgeLabel: String(target), badgeAriaLabel: `Unique cell milestone progress toward ${target}`,
    typeLabel: 'Unique cell milestone', title: `${target} Unique Cells`,
    currentValue: current, targetValue: target, currentLabel: String(current), targetLabel: String(target),
    progressPercent: Math.round(current / target * 100),
    currentDescription: `Claim ${remaining} more ${remaining === 1 ? 'cell' : 'cells'} on your Personal Map.`,
    otherDescription: `${displayName} needs ${remaining} more ${remaining === 1 ? 'cell' : 'cells'} to reach this Personal Map milestone.`,
  }];
}

describe('pilot profile renderer', () => {
  it('renders the current and another pilot headings with the summary values', async () => {
    const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'viewer@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };
    const profile = {
      userId: '00000000-0000-4000-8000-000000000003',
      displayName: 'Cloud Dancer',
      territoryColor: '#A1B2C3',
      lifetimeUniqueCellCount: 12,
      nextUniqueCellMilestone: 25,
      uniqueCellsToNextMilestone: 13,
      nextUniqueCellMilestoneProgressPercent: 48,
      achievementProgress: [
        ...uniqueProgress('Cloud Dancer', 12, 25),
        {
          key: 'general_coverage' as const, achievementType: 'threshold' as const, achievementCategory: 'general' as const,
          badgeLabel: '75%', badgeAriaLabel: 'General Arena coverage progress toward 75%',
          typeLabel: 'General Arena coverage', title: '75% General Arena Coverage',
          currentValue: 50, targetValue: 75, currentLabel: '50%', targetLabel: '75%', progressPercent: 67,
          currentDescription: 'Keep claiming cells in Boulder to reach 75% coverage.',
          otherDescription: 'Cloud Dancer is working toward 75% coverage in Boulder.',
          arenaPath: '/arena/us/boulder-745',
        },
      ],
      completedFlightCount: 3,
      lifetimeDirectCellCount: 20,
      lifetimeEnclosedCellCount: 4,
      currentTotalCellRecord: 11,
      currentEnclosedCellRecord: 3,
      achievementCount: 2,
      achievements: [],
      recentFlights: [],
      currentArenaLeaderships: [],
    };

    const current = await render({ currentUser, page: 'profile', profile: { ...profile, userId: currentUser.userId }, profileIsCurrent: true });
    expect(current).toContain('>Achievements</h1>');
    expect(current).toContain('Achievements earned');
    expect(current).toContain('Unique cells');
    expect(current).toContain('Next milestone');
    expect(current).toContain('Claim 13 more cells on your Personal Map.');
    expect(current).toContain('value="12"');
    expect(current).toContain('aria-label="Progress toward 25 Unique Cells"');
    expect(current).toContain('<span aria-hidden="true">48%</span>');
    expect(current).toContain('2 milestones');
    expect(current).toContain('data-achievement-progress="general_coverage"');
    expect(current).toContain('href="/arena/us/boulder-745"');
    expect(current).toContain('50% / 75%');
    expect(current).toContain('Keep claiming cells in Boulder to reach 75% coverage.');
    expect(current).toContain('48%');
    expect(current).toContain('Achievement types');
    expect(current).toContain('How progress works');
    expect(current).toContain('whenever a pilot sets or improves a record.');
    expect(current).toContain('href="/personal"');
    expect(current).toContain('/styles/profile.css');
    expect(current).toContain('/scripts/profile.js');
    expect(current).not.toContain('/scripts/dashboard.js');

    const other = await render({ currentUser, page: 'profile', profile, profileIsCurrent: false });
    expect(other).toContain('Cloud Dancer’s Achievements');
    expect(other).toContain('Cloud Dancer needs 13 more cells to reach this Personal Map milestone.');
    expect(other).toContain('Cloud Dancer is working toward 75% coverage in Boulder.');
    expect(other).not.toContain('Claim 13 more cells on your Personal Map.');
    expect(other).not.toContain('your record');
    expect(other).toContain('No achievements yet.</p>');
    expect(other).not.toContain('Complete a flight to start building your history.');
    expect(other).toContain('No completed flights yet.</p>');
    expect(other).not.toContain('Upload a flight to see it here.');
  });

  it('renders singular next milestone copy', async () => {
    const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'viewer@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };
    const html = await render({
      currentUser,
      page: 'profile',
      profile: {
        userId: currentUser.userId,
        displayName: 'Sky Pilot',
        territoryColor: '#1769AA',
        lifetimeUniqueCellCount: 24,
        nextUniqueCellMilestone: 25,
        uniqueCellsToNextMilestone: 1,
        nextUniqueCellMilestoneProgressPercent: 96,
        achievementProgress: uniqueProgress('Sky Pilot', 24, 25),
        completedFlightCount: 1,
        lifetimeDirectCellCount: 20,
        lifetimeEnclosedCellCount: 4,
        currentTotalCellRecord: 24,
        currentEnclosedCellRecord: 4,
        achievementCount: 0,
        achievements: [],
        recentFlights: [],
        currentArenaLeaderships: [],
      },
      profileIsCurrent: true,
    });

    expect(html).toContain('Claim 1 more cell on your Personal Map.');
    expect(html).not.toContain('Claim 1 more cells on your Personal Map.');
  });

  it('renders achievement and flight history without exposing private fields', async () => {
    const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'viewer@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };
    const profile = {
      userId: currentUser.userId,
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
      lifetimeUniqueCellCount: 30,
      nextUniqueCellMilestone: 50,
      uniqueCellsToNextMilestone: 20,
      nextUniqueCellMilestoneProgressPercent: 60,
      achievementProgress: uniqueProgress('Sky Pilot', 30, 50),
      completedFlightCount: 1,
      lifetimeDirectCellCount: 20,
      lifetimeEnclosedCellCount: 4,
      currentTotalCellRecord: 24,
      currentEnclosedCellRecord: 4,
      achievementCount: 3,
      achievements: [
        {
          id: 'achievement-1',
          achievementType: 'unique_cells_milestone',
          typeLabel: 'Unique cell milestone',
          earnedDate: 'Jul 20, 2026',
          sourceFlightId: null,
          title: '25 Unique Cells',
          description: 'Reached 25 unique Personal Map cells, adding 17 new cells to a total of 25.',
          badgeLabel: '25',
        },
        {
          id: 'achievement-2',
          achievementType: 'personal_best_total_cells',
          typeLabel: 'Total-cell personal best',
          earnedDate: 'Jul 19, 2026',
          sourceFlightId: currentUser.userId,
          title: 'New Flight Cell Record',
          description: 'Established an initial total-cell record of 24 cells (20 direct and 4 enclosed).',
          badgeLabel: 'PB',
        },
        {
          id: 'achievement-3',
          achievementType: 'personal_best_enclosed_cells',
          typeLabel: 'Enclosed-cell personal best',
          earnedDate: 'Jul 18, 2026',
          sourceFlightId: null,
          title: 'New Enclosed Cell Record',
          description: 'Established an initial enclosed-cell record of 4 cells (20 direct and 4 enclosed).',
          badgeLabel: 'Loop',
        },
      ],
      recentFlights: [{
        flightId: 'flight-1',
        flightDate: 'Jul 20, 2026',
        distance: '12.5 km',
        duration: '1h 01m',
        directCellCount: 20,
        enclosedCellCount: 4,
        totalCellCount: 24,
        newPersonalCellCount: 17,
      }],
      currentArenaLeaderships: [],
    };

    const html = await render({ currentUser, page: 'profile', profile, profileIsCurrent: true });

    expect(html).toContain('Earned achievements');
    expect(html).toContain('25 Unique Cells');
    expect(html).toContain('New Flight Cell Record');
    expect(html).toContain('New Enclosed Cell Record');
    expect(html).toContain('class="achievement-earned-mark" aria-hidden="true"');
    expect(html).not.toContain('class="achievement-earned-mark" aria-label="Earned"');
    expect(html).toContain('Recent flights');
    expect(html).toContain('Total cells claimed');
    expect(html).toContain('New Personal Map cells');
    expect(html).toContain('12.5 km');
    expect(html).toContain('1h 01m');
    expect(html).not.toContain('Flight achievement-1');
    expect(html).not.toContain('viewer@example.com');

    const truncatedHistory = await render({
      currentUser,
      page: 'profile',
      profile: {
        ...profile,
        achievementCount: 55,
        achievements: Array.from({ length: 50 }, (_, index) => ({
          ...profile.achievements[0]!,
          id: `achievement-${index}`,
        })),
        recentFlights: Array.from({ length: 4 }, (_, index) => ({
          ...profile.recentFlights[0]!,
          flightId: `flight-${index}`,
        })),
      },
      profileIsCurrent: true,
    });
    expect(truncatedHistory).toContain('Latest 50 of 55');
    expect(truncatedHistory.match(/data-profile-list-toggle/g)).toHaveLength(2);
    expect(truncatedHistory).toContain('aria-controls="profile-achievement-list" aria-expanded="false" hidden>Show all</button>');
    expect(truncatedHistory).toContain('aria-controls="profile-flight-list" aria-expanded="false" hidden>Show all</button>');

    const zeroCellFlight = await render({
      currentUser,
      page: 'profile',
      profile: {
        ...profile,
        recentFlights: [{
          flightId: 'flight-zero',
          flightDate: 'Jul 17, 2026',
          distance: '0 km',
          duration: '1m 00s',
          directCellCount: 0,
          enclosedCellCount: 0,
          totalCellCount: 0,
          newPersonalCellCount: 0,
        }],
      },
      profileIsCurrent: true,
    });
    expect(zeroCellFlight.match(/<dd>0<\/dd>/g)).toHaveLength(4);
  });

  it('renders Release 2 Arena categories, thresholds, and personal-best event copy accessibly', async () => {
    const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'viewer@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };
    const html = await render({
      currentUser,
      page: 'profile',
      profile: {
        userId: currentUser.userId,
        displayName: currentUser.displayName,
        territoryColor: currentUser.territoryColor,
        lifetimeUniqueCellCount: 3,
        nextUniqueCellMilestone: 5,
        uniqueCellsToNextMilestone: 2,
        nextUniqueCellMilestoneProgressPercent: 60,
        achievementProgress: uniqueProgress('Sky Pilot', 3, 5),
        completedFlightCount: 1,
        lifetimeDirectCellCount: 3,
        lifetimeEnclosedCellCount: 0,
        currentTotalCellRecord: 3,
        currentEnclosedCellRecord: 0,
        achievementCount: 5,
        achievements: [
          {
            id: 'launch', achievementType: 'threshold', achievementCategory: 'launch', typeLabel: 'Launch Arena',
            earnedDate: 'Jul 20, 2026', sourceFlightId: null, title: '3 Launch Arenas Visited',
            description: 'Visit 3 Launch Arenas.', badgeLabel: '3', badgeAriaLabel: 'Launch Arena threshold achievement: 3',
          },
          {
            id: 'general', achievementType: 'threshold', achievementCategory: 'general', typeLabel: 'General Arena',
            earnedDate: 'Jul 19, 2026', sourceFlightId: null, title: '10% General Arena Coverage',
            description: 'Reach 10% coverage in any General Arena.', badgeLabel: '10%', badgeAriaLabel: 'General Arena threshold achievement: 10%',
          },
          {
            id: 'state', achievementType: 'threshold', achievementCategory: 'state', typeLabel: 'State',
            earnedDate: 'Jul 18, 2026', sourceFlightId: null, title: '1 State Flown in',
            description: 'Claim a cell in 1 State Arena.', badgeLabel: '1', badgeAriaLabel: 'State threshold achievement: 1',
          },
          {
            id: 'country', achievementType: 'threshold', achievementCategory: 'country', typeLabel: 'Country',
            earnedDate: 'Jul 17, 2026', sourceFlightId: null, title: '1 Country Flown in',
            description: 'Claim a cell in 1 Country Arena.', badgeLabel: '1', badgeAriaLabel: 'Country threshold achievement: 1',
          },
          {
            id: 'record-event:one', achievementType: 'record', achievementCategory: 'launch', typeLabel: 'Launch Arena personal best',
            earnedDate: 'Jul 16, 2026', sourceFlightId: null, title: 'Most Launches Tagged During One Flight',
            description: 'Tagged 1 Launch Arena during one flight, establishing an initial record.', badgeLabel: '1',
            badgeAriaLabel: 'Launch Arena personal-best record: 1 tagged',
          },
        ],
        recentFlights: [],
        currentArenaLeaderships: [],
      },
      profileIsCurrent: true,
    });

    expect(html).toContain('3 Launch Arenas Visited');
    expect(html).toContain('10% General Arena Coverage');
    expect(html).toContain('1 State Flown in');
    expect(html).toContain('1 Country Flown in');
    expect(html).toContain('Most Launches Tagged During One Flight');
    expect(html).toContain('Tagged 1 Launch Arena during one flight, establishing an initial record.');
    expect(html).toContain('role="img" aria-label="Launch Arena personal-best record: 1 tagged"');
    expect(html).toContain('Launch Arena achievements');
    expect(html).toContain('Arena leadership achievements');
    expect(html).toContain('States Flown in counts a State Arena once you claim at least one cell there.');
    expect(html).toContain('Countries Flown in counts a Country Arena once you claim at least one cell there.');
    expect(html).not.toContain('most_launches_tagged_one_flight');
  });

  it('renders clear empty states for a pilot with no history', async () => {
    const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'viewer@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };
    const html = await render({
      currentUser,
      page: 'profile',
      profile: {
        userId: currentUser.userId,
        displayName: 'Sky Pilot',
        territoryColor: '#1769AA',
        lifetimeUniqueCellCount: 0,
        nextUniqueCellMilestone: 10,
        uniqueCellsToNextMilestone: 10,
        nextUniqueCellMilestoneProgressPercent: 0,
        achievementProgress: uniqueProgress('Sky Pilot', 0, 10),
        completedFlightCount: 0,
        lifetimeDirectCellCount: 0,
        lifetimeEnclosedCellCount: 0,
        currentTotalCellRecord: null,
        currentEnclosedCellRecord: null,
        achievementCount: 0,
        achievements: [],
        recentFlights: [],
        currentArenaLeaderships: [],
      },
      profileIsCurrent: true,
    });

    expect(html).toContain('No achievements yet. Complete a flight to start building your history.');
    expect(html).toContain('No completed flights yet. Upload a flight to see it here.');
  });
});
