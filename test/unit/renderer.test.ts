import { describe, expect, it } from 'vitest';
import { createAdminAreaPageRenderer, createAdminPageRenderer, createErrorPageRenderer, createPageRenderer } from '../../src/views/renderer.js';

describe('Vento page renderer', () => {
  const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });

  it('compiles and renders the anonymous page state', async () => {
    const anonymous = await render({ currentUser: null });

    expect(anonymous).toContain('<title>GlideHero</title>');
    expect(anonymous).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
    expect(anonymous).toContain('<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">');
    expect(anonymous).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">');
    expect(anonymous).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">');
    expect(anonymous).toContain('<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">');
    expect(anonymous).toContain('Paint the sky with your friends.');
    expect(anonymous).toContain('class="landing" data-auth-landing data-auth-initial="login"');
    expect(anonymous).toContain('<script type="module" src="/scripts/landing.js"></script>');
    expect(anonymous).not.toContain('data-auth-tab');
    expect(anonymous).toMatch(/data-auth-panel="login" aria-labelledby="login-heading"\s*>/);
    expect(anonymous).toMatch(/data-auth-panel="signup" aria-labelledby="signup-heading"\s+hidden>/);
    expect(anonymous).toContain('action="/login"');
    expect(anonymous).toContain('action="/signup"');
    expect(anonymous).not.toContain('data-onboarding-trigger');
    expect(anonymous).not.toContain('data-onboarding-dialog');
    expect(anonymous).not.toContain('action="/logout"');
  });

  it('renders the authenticated dashboard scaffold with working account workflows', async () => {
    const authenticated = await render({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'pilot@example.com',
        displayName: 'Sky Pilot',
        territoryColor: '#1769AA',
      },
    });

    expect(authenticated).toContain('Sky Pilot');
    expect(authenticated).toContain('<img class="brand-logo" src="/android-chrome-192x192.png" alt="">');
    expect(authenticated).toContain('aria-label="Glide Hero dashboard"');
    expect(authenticated).toContain('<span class="brand-name">GLIDE HERO</span>');
    expect(authenticated).not.toContain('class="brand-wing"');
    expect(authenticated).toContain('pilot@example.com');
    expect(authenticated).toContain('action="/logout"');
    expect(authenticated).toContain('action="/profile/territory-color"');
    expect(authenticated).toContain('value="#1769AA"');
    expect(authenticated).toContain('data-competition-coverage="global"');
    expect(authenticated).toContain('data-coverage-map');
    expect(authenticated).toContain('data-onboarding-trigger');
    expect(authenticated).toContain('aria-controls="glide-hero-onboarding"');
    expect(authenticated).not.toContain('data-stub="help"');
    expect(authenticated).toContain('<dialog id="glide-hero-onboarding"');
    expect(authenticated).toContain('data-onboarding-dialog');
    expect(authenticated.match(/data-onboarding-step/g)).toHaveLength(3);
    expect([...authenticated.matchAll(/<h2[^>]*data-onboarding-heading[^>]*tabindex="-1"[^>]*>/g)]).toHaveLength(3);
    expect(authenticated).toContain('Welcome to Glide Hero!');
    expect(authenticated).toContain('Claim cells as you fly');
    expect(authenticated).toContain('Close the loop');
    expect(authenticated).toContain('data-onboarding-back');
    expect(authenticated).toContain('data-onboarding-next');
    expect(authenticated).toContain('data-onboarding-done');
    expect(authenticated).toContain('data-onboarding-close');
    expect(authenticated.match(/data-onboarding-progress/g)).toHaveLength(3);
    expect(authenticated).toContain('style="--territory-color: #1769AA"');
    expect(authenticated).toContain('data-mobile-sheet');
    expect(authenticated).toContain('data-account-popover');
    expect(authenticated).toContain('Help &amp; walkthrough');
    expect(authenticated.indexOf('data-account-popover')).toBeLessThan(
      authenticated.indexOf('data-onboarding-trigger'),
    );
    expect(authenticated).toContain('href="/global" data-competition-period-link="/global" class="mode-tab is-active" aria-current="page">Competitive</a>');
    expect(authenticated).toContain('href="/personal" class="mode-tab">Personal</a>');
    expect(authenticated).toContain('data-territory-color="#1769AA"');
    expect(authenticated).toContain('data-current-user-id="00000000-0000-4000-8000-000000000001"');
    expect(authenticated).toContain('<script type="module" src="/scripts/dashboard.js"></script>');
    expect(authenticated).toContain('<h2>Coverage leaderboard</h2>');
    expect(authenticated).toContain('data-coverage-overview');
    expect(authenticated).toContain('data-coverage-cell-popup');
    expect(authenticated).toContain('data-competition-period');
    expect(authenticated).toContain('aria-label="Coverage time period"');
    expect(authenticated).toContain('data-current-month-option');
    expect(authenticated).not.toContain('<h2>Stats</h2>');
    expect(authenticated).not.toContain('data-personal-stats');
    expect(authenticated).toContain('data-arena-search-input');
    expect(authenticated).toContain('aria-current="page">Global</span>');
    expect(authenticated).not.toContain('Visible Map Claimed');
    expect(authenticated).not.toContain('claimed-percentage');
    expect(authenticated).not.toContain('data-competition-my-flights');
    expect(authenticated).not.toContain('No territory data is available for this viewport yet.');
    expect(authenticated).toContain('https://api.maptiler.com/maps/outdoor-v2/style.json?key=maptiler-test-key');
    expect(authenticated).not.toContain('action="/login"');
    expect(authenticated).not.toContain('action="/signup"');
    expect(authenticated).not.toContain('href="/admin"');
  });

  it('shows the admin link only when the renderer is told the user is an admin', async () => {
    const html = await render({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'admin@example.com',
        displayName: 'Admin',
        territoryColor: '#1769AA',
      },
      isAdmin: true,
    });

    expect(html).toContain('<a class="admin-link" href="/admin">Admin</a>');
  });

  it('renders dedicated Personal and Arena pages with separated scripts and search UI', async () => {
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'pilot@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };
    const personal = await render({ currentUser, page: 'personal' });
    expect(personal).toContain('href="/personal" class="mode-tab is-active" aria-current="page">Personal</a>');
    expect(personal).toContain('data-personal-stats');
    expect(personal).not.toContain('data-arena-search');
    expect(personal).not.toContain('competition-breadcrumb');

    const arena = await render({
      currentUser,
      page: 'arena',
      arena: {
        id: '00000000-0000-4000-8000-000000000099',
        sourceId: 745,
        name: 'Boulder',
        city: 'Boulder',
        state: 'Colorado',
        country: 'United States',
        countryCode: 'us',
        path: '/arena/us/boulder-745',
        boundary: {
          type: 'Feature',
          properties: { sourceId: 745, name: 'Boulder' },
          geometry: { type: 'MultiPolygon', coordinates: [] },
          bbox: [-106, 39, -105, 40],
        },
      },
    });
    expect(arena).toContain('data-competition-coverage="arena"');
    expect(arena).toContain('data-coverage-map');
    expect(arena).toContain('data-arena-source-id="745"');
    expect(arena).toContain('<a href="/global" data-competition-period-link="/global">Global</a>');
    expect(arena).toContain('aria-current="page">Boulder</span>');
    expect(arena).toContain('data-arena-search-input');
    expect(arena).toContain('<script type="module" src="/scripts/arena.js"></script>');
  });

  it('renders the generic landing-out 404 without dashboard or landing scripts', async () => {
    const html = await createErrorPageRenderer()({ currentUser: null, status: 404 });

    expect(html).toContain('Well… that landing could have gone better.');
    expect(html).toContain('This route seems to be tangled in a tree.');
    expect(html).toContain('/error-mascot.webp');
    expect(html).toContain('href="/">Head home</a>');
    expect(html).toContain('class="error-page-body"');
    expect(html).not.toContain('/scripts/dashboard.js');
    expect(html).not.toContain('/scripts/landing.js');
  });

  it('renders a safe generic server error without exposing internal details', async () => {
    const html = await createErrorPageRenderer()({ currentUser: null, status: 500 });

    expect(html).toContain('We hit a little turbulence.');
    expect(html).toContain('Glide Hero hit an unexpected snag.');
    expect(html).not.toContain('stack');
    expect(html).not.toContain('Internal server error');
  });

  it('renders the admin flight table without dashboard map assets', async () => {
    const renderAdmin = createAdminPageRenderer();
    const html = await renderAdmin({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'admin@example.com',
        displayName: 'Admin',
        territoryColor: '#1769AA',
      },
      flights: [{
        id: '00000000-0000-4000-8000-000000000020',
        flightDate: '2026-07-14',
        pilotEmail: 'pilot@example.com',
        originalFilename: 'flight.igc',
        processingStatus: 'completed',
      }, {
        id: '00000000-0000-4000-8000-000000000021',
        flightDate: null,
        pilotEmail: 'failed@example.com',
        originalFilename: 'failed.igc',
        processingStatus: 'failed',
      }],
      reprocessSuccess: true,
    });

    expect(html).toContain('The 100 most recently uploaded flights.');
    expect(html).toContain('action="/admin/flights/00000000-0000-4000-8000-000000000020/reprocess"');
    expect(html).not.toContain('action="/admin/flights/00000000-0000-4000-8000-000000000021/reprocess"');
    expect(html).toContain('Flight cells were reprocessed.');
    expect(html).not.toContain('dashboard.js');
    expect(html).not.toContain('maplibre-gl');
    expect(html).toContain('href="/admin/areas"');
    expect(html).toContain('href="/admin" class="admin-tab is-active" aria-current="page">Flights</a>');
  });

  it('renders the area editor with only its dedicated map assets', async () => {
    const html = await createAdminAreaPageRenderer({ mapTilerApiKey: 'maptiler-test-key' })({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'admin@example.com',
        displayName: 'Admin',
        territoryColor: '#1769AA',
      },
    });

    expect(html).toContain('data-admin-area-editor');
    expect(html).toContain('data-map-style-url="https://api.maptiler.com/maps/outdoor-v2/style.json?key=maptiler-test-key"');
    expect(html).toContain('/styles/adminAreaEditor.css');
    expect(html).toContain('/scripts/admin/areaEditor.js');
    expect(html).toContain('data-map-tool="paint"');
    expect(html).toContain('data-map-tool="erase"');
    expect(html).toContain('data-cancel-area');
    expect(html).toContain('href="/admin/areas" class="admin-tab is-active" aria-current="page">Areas</a>');
    expect(html).not.toContain('/scripts/dashboard.js');
    expect(html).not.toContain('/scripts/arena.js');
  });

  it('autoescapes user-controlled values and never renders passwords', async () => {
    const html = await render({
      currentUser: null,
      signupError: 'An account with that email already exists.',
      signupEmail: '<pilot@example.com>',
      signupDisplayName: '<script>alert(1)</script>',
    });

    expect(html).toContain('An account with that email already exists.');
    expect(html).toContain('data-auth-initial="signup"');
    expect(html).not.toContain('data-auth-tab');
    expect(html).toMatch(/data-auth-panel="login" aria-labelledby="login-heading"\s+hidden>/);
    expect(html).toMatch(/data-auth-panel="signup" aria-labelledby="signup-heading"\s*>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('value="never-render-this-password"');
  });
});
