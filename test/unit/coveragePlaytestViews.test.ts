import { describe, expect, it } from 'vitest';
import { createCoveragePlaytestPageRenderer } from '../../src/views/renderer.js';

const currentUser = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'pilot@example.com',
  displayName: 'Pilot',
  territoryColor: '#1769AA',
  sessionId: '00000000-0000-4000-8000-000000000099',
};

describe('coverage playtest views', () => {
  it('renders the isolated Global playtest route contract', async () => {
    const html = await createCoveragePlaytestPageRenderer({ mapTilerApiKey: 'map-key' })({
      currentUser,
      page: 'coverage-global',
    });
    expect(html).toContain('data-coverage-playtest="global"');
    expect(html).toContain('Coverage leaderboard');
    expect(html).toContain('/scripts/coveragePlaytestGlobal.js');
    expect(html).toContain('data-coverage-overview');
  });

  it('renders Arena identity and the Arena controller', async () => {
    const html = await createCoveragePlaytestPageRenderer({ mapTilerApiKey: 'map-key' })({
      currentUser,
      page: 'coverage-arena',
      arena: {
        id: '00000000-0000-4000-8000-000000000002',
        sourceId: 745,
        name: 'Boulder',
        city: 'Boulder',
        state: 'Colorado',
        country: 'United States',
        countryCode: 'us',
        path: '/arena/us/boulder-745',
        boundary: {
          type: 'Feature', properties: { sourceId: 745, name: 'Boulder' },
          geometry: { type: 'MultiPolygon', coordinates: [] }, bbox: [-106, 39, -105, 40],
        },
      },
    });
    expect(html).toContain('data-coverage-playtest="arena"');
    expect(html).toContain('data-arena-source-id="745"');
    expect(html).toContain('/scripts/coveragePlaytestArena.js');
  });
});
