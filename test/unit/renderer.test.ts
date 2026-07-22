import { describe, expect, it } from 'vitest';
import {
  createAdminAreaPageRenderer,
  createAdminMapSettingsPageRenderer,
  createAdminPageRenderer,
  createAdminUserPageRenderer,
  createErrorPageRenderer,
  createPageRenderer,
} from '../../src/views/renderer.js';

const user = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'pilot@example.com',
  displayName: 'Sky Pilot',
  territoryColor: '#1769AA',
};

describe('Vento page renderer', () => {
  it('renders the anonymous landing page', async () => {
    const html = await createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' })({ currentUser: null });
    expect(html).toContain('<title>GlideHero</title>');
    expect(html).toContain('Paint the sky with your friends.');
    expect(html).toContain('action="/login"');
    expect(html).toContain('action="/signup"');
    expect(html).toContain('<script type="module" src="/scripts/landing.js"></script>');
    expect(html).not.toContain('data-dashboard-map');
  });

  it('keeps landing form errors and values available for auth responses', async () => {
    const html = await createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' })({
      currentUser: null,
      loginError: 'Invalid credentials.',
      loginEmail: 'pilot@example.com',
      signupDisplayName: 'Sky Pilot',
    });
    expect(html).toContain('Invalid credentials.');
    expect(html).toContain('value="pilot@example.com"');
    expect(html).toContain('value="Sky Pilot"');
  });

  it('renders generic errors without dashboard scripts', async () => {
    const html = await createErrorPageRenderer()({ currentUser: null, status: 404 });
    expect(html).toContain('Well… that landing could have gone better.');
    expect(html).toContain('/error-mascot.webp');
    expect(html).not.toContain('/scripts/dashboard.js');
  });

  it('renders admin pages without user dashboard assets', async () => {
    const html = await createAdminPageRenderer()({ currentUser: user, flights: [], reprocessSuccess: true });
    expect(html).toContain('The 100 most recently uploaded flights.');
    expect(html).not.toContain('dashboard.js');
    expect(html).not.toContain('maplibre-gl');
  });

  it('renders admin area, map settings, and user management templates', async () => {
    const area = await createAdminAreaPageRenderer({ mapTilerApiKey: 'maptiler-test-key' })({ currentUser: user });
    expect(area).toContain('data-admin-area-editor');

    const settings = await createAdminMapSettingsPageRenderer()({
      currentUser: user,
      settings: {
        personal: { minimumZoom: 4, maximumZoom: 14 },
        competition: { minimumZoom: 6, maximumZoom: 12 },
      },
    });
    expect(settings).toContain('<h1>Map settings</h1>');

    const users = await createAdminUserPageRenderer()({
      currentUser: user,
      users: [],
      flights: [],
      deletableFlightCount: 0,
      search: '',
      searchParam: '',
      mode: 'empty',
    });
    expect(users).toContain('admin-user-page');
  });
});
