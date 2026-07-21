import { describe, expect, it } from 'vitest';
import { createPageRenderer } from '../../src/views/renderer.js';

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
      completedFlightCount: 3,
      lifetimeDirectCellCount: 20,
      lifetimeEnclosedCellCount: 4,
      currentTotalCellRecord: 11,
      currentEnclosedCellRecord: 3,
      achievementCount: 2,
      achievements: [],
      recentFlights: [],
    };

    const current = await render({ currentUser, page: 'profile', profile: { ...profile, userId: currentUser.userId }, profileIsCurrent: true });
    expect(current).toContain('>My Progress</h1>');
    expect(current).toContain('Unique cells');
    expect(current).toContain('Next milestone');
    expect(current).toContain('13 more cells to reach 25.');
    expect(current).toContain('Lifetime direct cells');
    expect(current).toContain('>12</dd>');
    expect(current).toContain('>11</dd>');
    expect(current).toContain('--profile-territory-color: #A1B2C3');
    expect(current).toContain('href="/personal"');
    expect(current).toContain('/styles/profile.css');
    expect(current).not.toContain('/scripts/dashboard.js');

    const other = await render({ currentUser, page: 'profile', profile, profileIsCurrent: false });
    expect(other).toContain('Cloud Dancer’s Progress');
    expect(other).toContain('13 more cells to reach 25.');
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
        completedFlightCount: 1,
        lifetimeDirectCellCount: 20,
        lifetimeEnclosedCellCount: 4,
        currentTotalCellRecord: 24,
        currentEnclosedCellRecord: 4,
        achievementCount: 0,
        achievements: [],
        recentFlights: [],
      },
      profileIsCurrent: true,
    });

    expect(html).toContain('1 more cell to reach 25.');
    expect(html).not.toContain('1 more cells to reach 25.');
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
        },
        {
          id: 'achievement-2',
          achievementType: 'personal_best_total_cells',
          typeLabel: 'Total-cell personal best',
          earnedDate: 'Jul 19, 2026',
          sourceFlightId: currentUser.userId,
          title: 'New Flight Cell Record',
          description: 'Established an initial total-cell record of 24 cells (20 direct and 4 enclosed).',
        },
        {
          id: 'achievement-3',
          achievementType: 'personal_best_enclosed_cells',
          typeLabel: 'Enclosed-cell personal best',
          earnedDate: 'Jul 18, 2026',
          sourceFlightId: null,
          title: 'New Enclosed Cell Record',
          description: 'Established an initial enclosed-cell record of 4 cells (20 direct and 4 enclosed).',
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
    };

    const html = await render({ currentUser, page: 'profile', profile, profileIsCurrent: true });

    expect(html).toContain('Achievements');
    expect(html).toContain('25 Unique Cells');
    expect(html).toContain('New Flight Cell Record');
    expect(html).toContain('New Enclosed Cell Record');
    expect(html).toContain('Recent flights');
    expect(html).toContain('Total cells claimed');
    expect(html).toContain('New Personal Map cells');
    expect(html).toContain('12.5 km');
    expect(html).toContain('1h 01m');
    expect(html).not.toContain('Flight achievement-1');
    expect(html).not.toContain('viewer@example.com');
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
        completedFlightCount: 0,
        lifetimeDirectCellCount: 0,
        lifetimeEnclosedCellCount: 0,
        currentTotalCellRecord: null,
        currentEnclosedCellRecord: null,
        achievementCount: 0,
        achievements: [],
        recentFlights: [],
      },
      profileIsCurrent: true,
    });

    expect(html).toContain('No achievements yet. Complete a flight to start building your history.');
    expect(html).toContain('No completed flights yet. Upload a flight to see it here.');
  });
});
