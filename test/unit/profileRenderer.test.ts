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
      completedFlightCount: 3,
      lifetimeDirectCellCount: 20,
      lifetimeEnclosedCellCount: 4,
      currentTotalCellRecord: 11,
      currentEnclosedCellRecord: 3,
      achievementCount: 2,
    };

    const current = await render({ currentUser, page: 'profile', profile: { ...profile, userId: currentUser.userId }, profileIsCurrent: true });
    expect(current).toContain('>My Progress</h1>');
    expect(current).toContain('Unique cells');
    expect(current).toContain('Lifetime direct cells');
    expect(current).toContain('>12</dd>');
    expect(current).toContain('>11</dd>');
    expect(current).toContain('--profile-territory-color: #A1B2C3');
    expect(current).toContain('href="/personal"');
    expect(current).toContain('/styles/profile.css');
    expect(current).not.toContain('/scripts/dashboard.js');

    const other = await render({ currentUser, page: 'profile', profile, profileIsCurrent: false });
    expect(other).toContain('Cloud Dancer’s Progress');
  });
});
