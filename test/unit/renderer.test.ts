import { describe, expect, it } from 'vitest';
import {
  createAdminAreaPageRenderer,
  createAdminMapSettingsPageRenderer,
  createAdminPageRenderer,
  createAdminUserPageRenderer,
  createErrorPageRenderer,
  createPageRenderer,
} from '../../src/views/renderer.js';
import { createTerritoryTileSettingsService } from '../../src/services/territoryTileSettingsService.js';

describe('Vento page renderer', () => {
  const render = createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' });

  it('compiles and renders the anonymous page state', async () => {
    const anonymous = await render({ currentUser: null });

    expect(anonymous).toContain('<title>GlideHero</title>');
    expect(anonymous).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
    expect(anonymous).toContain(
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    );
    expect(anonymous).toContain(
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    );
    expect(anonymous).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    );
    expect(anonymous).toContain(
      '<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">',
    );
    expect(anonymous).toContain('Turn every flight into progress.');
    expect(anonymous).toContain('Upload your flights. Expand your Personal Map.');
    expect(anonymous).toContain('Set new records. Compete when you want.');
    expect(anonymous).toContain('Start building your Personal Map.');
    expect(anonymous).toContain('class="landing" data-auth-landing data-auth-initial="login"');
    expect(anonymous).toContain('<script type="module" src="/scripts/landing.js"></script>');
    expect(anonymous).not.toContain('data-auth-tab');
    expect(anonymous).toMatch(/data-auth-panel="login" aria-labelledby="login-heading"\s*>/);
    expect(anonymous).toMatch(
      /data-auth-panel="signup" aria-labelledby="signup-heading"\s+hidden>/,
    );
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
    expect(authenticated).toContain(
      '<img class="brand-logo" src="/android-chrome-192x192.png" alt="">',
    );
    expect(authenticated).toContain('class="brand" href="/personal" aria-label="Glide Hero dashboard"');
    expect(authenticated).toContain('<span class="brand-name">GLIDE HERO</span>');
    expect(authenticated).toContain('pilot@example.com');
    expect(authenticated).toContain('action="/logout"');
    expect(authenticated).toContain('action="/profile/territory-color"');
    expect(authenticated).toContain('class="territory-color-control"><input class="territory-color-input"');
    expect(authenticated).toContain('data-territory-color-input required><span>Territory color</span>');
    expect(authenticated).not.toContain('>Save map color</button>');
    expect(authenticated).toContain('href="/profile">My Progress</a>');
    expect(authenticated).toContain('value="#1769AA"');
    expect(authenticated).not.toContain('data-competition-coverage="global"');
    expect(authenticated).toContain('data-dashboard-map');
    expect(authenticated).toContain('data-onboarding-trigger');
    expect(authenticated).toContain('aria-controls="glide-hero-onboarding"');
    expect(authenticated).toContain('<dialog id="glide-hero-onboarding"');
    expect(authenticated).toContain('data-onboarding-dialog');
    expect(authenticated.match(/data-onboarding-step/g)).toHaveLength(6);
    expect([
      ...authenticated.matchAll(/<h2[^>]*data-onboarding-heading[^>]*tabindex="-1"[^>]*>/g),
    ]).toHaveLength(6);
    expect(authenticated).toContain('Welcome to Glide Hero!');
    expect(authenticated).toContain('Every flight grows your permanent Personal Map and can unlock new achievements. Competition is there when you want it.');
    expect(authenticated).toContain('Claim cells as you fly');
    expect(authenticated).toContain('Close the loop');
    expect(authenticated).toContain('Compare your progress');
    expect(authenticated).toContain('Explore Global and Arenas');
    expect(authenticated).toContain('Choose your challenge');
    expect(authenticated).toContain('Competitive maps let pilots compare coverage. Shared cells count for everyone, and competition never changes your Personal Map.');
    expect(authenticated).toContain('Global compares coverage in the visible map.');
    expect(authenticated).toContain('Arenas compare coverage inside a fixed boundary.');
    expect(authenticated).toContain('Both are optional ways to challenge yourself and other pilots.');
    expect(authenticated).toContain('View competition All Time or focus on the Current Month. Your Personal Map and achievements remain permanent.');
    expect(authenticated).toContain('data-onboarding-back');
    expect(authenticated).toContain('data-onboarding-next');
    expect(authenticated).toContain('data-onboarding-done');
    expect(authenticated).toContain('data-onboarding-close');
    expect(authenticated.match(/data-onboarding-progress/g)).toHaveLength(6);
    expect(authenticated).toContain('style="--territory-color: #1769AA"');
    const onboarding =
      authenticated.match(/<dialog id="glide-hero-onboarding"[\s\S]*?<\/dialog>/)?.[0] ?? '';
    expect(onboarding).toContain('id="onboarding-shared-stripes"');
    expect(onboarding).toContain('onboarding-orange-score');
    expect(onboarding).toContain('onboarding-blue-score');
    expect(onboarding).toContain('Global compares coverage in the visible map. Arenas compare coverage inside a fixed boundary. Both are optional ways to challenge yourself and other pilots.');
    expect(onboarding.toLowerCase()).not.toContain('most recent pilot');
    expect(onboarding.toLowerCase()).not.toContain('transfers ownership');
    expect(onboarding.toLowerCase()).not.toContain('map resets');
    expect(authenticated).toContain('data-mobile-sheet');
    expect(authenticated).toContain('data-account-popover');
    expect(authenticated).toContain('Help &amp; walkthrough');
    expect(authenticated).toContain('data-upload-trigger aria-controls="flight-upload-dialog"');
    expect(authenticated).toContain('data-upload-close aria-label="Close upload status"');
    expect(authenticated).toContain('href="/profile" hidden>View my progress</a>');
    expect(authenticated).toContain('Choose flights<input data-upload-more-input');
    expect(authenticated).toContain('accept=".igc,.zip"');
    expect(authenticated).not.toContain('data-upload-input');
    expect(authenticated.indexOf('data-account-popover')).toBeLessThan(
      authenticated.indexOf('data-onboarding-trigger'),
    );
    expect(authenticated).toContain(
      'href="/personal" class="mode-tab is-active" aria-current="page">Personal</a>',
    );
    expect(authenticated).toContain('href="/global" data-competition-period-link="/global" class="mode-tab">Competitive</a>');
    expect(authenticated).toContain('data-territory-color="#1769AA"');
    expect(authenticated).toContain('data-territory-tile-minimum-zoom="4"');
    expect(authenticated).toContain('data-territory-tile-maximum-zoom="14"');
    expect(authenticated).toContain('data-current-user-id="00000000-0000-4000-8000-000000000001"');
    expect(authenticated).toContain('<script type="module" src="/scripts/dashboard.js"></script>');
    expect(authenticated).not.toContain('<h2>Territory leaderboard</h2>');
    expect(authenticated).not.toContain('data-territory-allpilots');
    expect(authenticated).not.toContain('data-territory-cell-popup');
    expect(authenticated).toContain('data-map-flight-aid-status');
    expect(authenticated).toContain('role="status" aria-live="polite"');
    expect(authenticated).not.toContain('aria-label="Coverage time period"');
    expect(authenticated).not.toContain('data-current-month-option');
    expect(authenticated).toContain('data-personal-stats');
    expect(authenticated).not.toContain('data-arena-search-input');
    expect(authenticated).toContain(
      'https://api.maptiler.com/maps/outdoor-v2/style.json?key=maptiler-test-key',
    );
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
    expect(personal).toContain(
      'href="/personal" class="mode-tab is-active" aria-current="page">Personal</a>',
    );
    expect(personal).toContain('data-personal-stats');
    expect(personal).toContain('data-territory-tile-minimum-zoom="4"');
    expect(personal).toContain('data-territory-tile-maximum-zoom="14"');
    expect(personal).toContain('data-map-flight-aid-status');
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
    expect(arena).toContain('data-territory-map');
    expect(arena).toContain('data-arena-source-id="745"');
    expect(arena).toContain('data-territory-tile-minimum-zoom="4"');
    expect(arena).toContain('data-territory-tile-maximum-zoom="14"');
    expect(arena).toContain('data-map-flight-aid-status');
    expect(arena).toContain('<a href="/global" data-competition-period-link="/global">Global</a>');
    expect(arena).toContain('aria-current="page">Boulder</span>');
    expect(arena).toContain('data-arena-search-input');
    expect(arena).toContain('<script type="module" src="/scripts/arena.js"></script>');
  });

  it('reads current runtime tile settings for each new dashboard render', async () => {
    const territoryTileSettings = createTerritoryTileSettingsService();
    const runtimeRender = createPageRenderer({
      mapTilerApiKey: 'maptiler-test-key',
      territoryTileSettings,
    });
    territoryTileSettings.update({
      personal: { minimumZoom: 0, maximumZoom: 0 },
      competition: { minimumZoom: 0, maximumZoom: 0 },
    });
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'pilot@example.com',
      displayName: 'Sky Pilot',
      territoryColor: '#1769AA',
    };

    const personal = await runtimeRender({ currentUser, page: 'personal' });
    const global = await runtimeRender({ currentUser, page: 'global' });

    expect(personal).toContain('data-territory-tile-minimum-zoom="0"');
    expect(personal).toContain('data-territory-tile-maximum-zoom="0"');
    expect(global).toContain('data-territory-tile-minimum-zoom="0"');
    expect(global).toContain('data-territory-tile-maximum-zoom="0"');
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
      flights: [
        {
          id: '00000000-0000-4000-8000-000000000020',
          flightDate: '2026-07-14',
          pilotEmail: 'pilot@example.com',
          originalFilename: 'flight.igc',
          processingStatus: 'completed',
        },
        {
          id: '00000000-0000-4000-8000-000000000021',
          flightDate: null,
          pilotEmail: 'failed@example.com',
          originalFilename: 'failed.igc',
          processingStatus: 'failed',
        },
      ],
      reprocessSuccess: true,
    });

    expect(html).toContain('The 100 most recently uploaded flights.');
    expect(html).toContain(
      'action="/admin/flights/00000000-0000-4000-8000-000000000020/reprocess"',
    );
    expect(html).not.toContain(
      'action="/admin/flights/00000000-0000-4000-8000-000000000021/reprocess"',
    );
    expect(html).toContain('Flight cells were reprocessed.');
    expect(html).not.toContain('dashboard.js');
    expect(html).not.toContain('maplibre-gl');
    expect(html).toContain('href="/admin/areas"');
    expect(html).toContain('href="/admin" class="admin-tab is-active" aria-current="page">System</a>');
    expect(html).toContain('aria-label="System sections"');
    expect(html).toContain('href="/admin" class="admin-system-tab is-active" aria-current="page">Recent activity</a>');
    expect(html).toContain('href="/admin/map-settings" class="admin-system-tab">Map settings</a>');
    expect(html).toContain('href="/admin/users"');
  });

  it('renders all four runtime map settings in one System form', async () => {
    const html = await createAdminMapSettingsPageRenderer()({
      currentUser: {
        userId: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
        email: 'admin@example.com',
        displayName: 'Admin',
        territoryColor: '#1769AA',
      },
      settings: {
        personal: { minimumZoom: 0, maximumZoom: 11 },
        competition: { minimumZoom: 0, maximumZoom: 12 },
      },
      saveSuccess: true,
    });

    expect(html).toContain('href="/admin" class="admin-tab is-active" aria-current="page">System</a>');
    expect(html).toContain('href="/admin/map-settings" class="admin-system-tab is-active" aria-current="page">Map settings</a>');
    expect(html).toContain('action="/admin/map-settings"');
    expect(html).toContain('name="personalMinimumZoom" min="0" max="22" step="1" required value="0"');
    expect(html).toContain('name="personalMaximumZoom" min="0" max="22" step="1" required value="11"');
    expect(html).toContain('name="competitionMinimumZoom" min="0" max="22" step="1" required value="0"');
    expect(html).toContain('name="competitionMaximumZoom" min="0" max="22" step="1" required value="12"');
    expect(html).toContain('Save settings');
    expect(html).toContain('Map settings were updated for this runtime.');
  });

  it('renders user management with protected self-service and terminal flight actions', async () => {
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'admin@example.com', displayName: 'Admin', territoryColor: '#1769AA',
    };
    const html = await createAdminUserPageRenderer()({
      currentUser,
      users: [{ id: currentUser.userId, email: currentUser.email, displayName: currentUser.displayName }],
      selectedUser: {
        id: currentUser.userId, email: currentUser.email, displayName: currentUser.displayName,
        hasPassword: true, lastLogin: new Date(), createdAt: new Date(), updatedAt: new Date(),
      },
      flights: [
        { id: '00000000-0000-4000-8000-000000000020', flightDate: '2026-07-14', originalFilename: 'done.igc', processingStatus: 'completed' },
        { id: '00000000-0000-4000-8000-000000000021', flightDate: null, originalFilename: 'active.igc', processingStatus: 'processing' },
      ],
      deletableFlightCount: 1,
      search: 'admin@', searchParam: 'admin%40', mode: 'edit',
    });

    expect(html).toContain('href="/admin/users" class="admin-tab is-active"');
    expect(html).toContain('Your signed-in admin account is protected');
    expect(html).toContain('/flights/00000000-0000-4000-8000-000000000020/igc');
    expect(html).toContain('/flights/00000000-0000-4000-8000-000000000020/reprocess');
    expect(html).not.toContain('/flights/00000000-0000-4000-8000-000000000021/delete');
    expect(html).toContain(`/admin/users/${currentUser.userId}/flights/delete-all`);
    expect(html).toContain('data-confirm="Are you sure you want to delete 1 flight?"');
    expect(html).toContain('>Delete all flights</button>');
    expect(html).toContain('/styles/adminUserManagement.css');
    expect(html).toContain('/scripts/admin/userManagement.js');
  });

  it('disables bulk flight deletion when a selected user has no terminal flights', async () => {
    const currentUser = {
      userId: '00000000-0000-4000-8000-000000000001',
      sessionId: '00000000-0000-4000-8000-000000000002',
      email: 'admin@example.com', displayName: 'Admin', territoryColor: '#1769AA',
    };
    const html = await createAdminUserPageRenderer()({
      currentUser,
      users: [{ id: currentUser.userId, email: currentUser.email, displayName: currentUser.displayName }],
      selectedUser: {
        id: currentUser.userId, email: currentUser.email, displayName: currentUser.displayName,
        hasPassword: true, lastLogin: new Date(), createdAt: new Date(), updatedAt: new Date(),
      },
      flights: [{
        id: '00000000-0000-4000-8000-000000000021', flightDate: null,
        originalFilename: 'active.igc', processingStatus: 'processing',
      }],
      deletableFlightCount: 0,
      search: '', searchParam: '', mode: 'edit',
    });

    expect(html).toContain('data-confirm="Are you sure you want to delete 0 flights?"');
    expect(html).toContain('class="admin-user-danger" disabled>Delete all flights</button>');
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
    expect(html).toContain('<link rel="stylesheet" href="/styles/color-palette.css">');
    expect(html).toContain(
      'data-map-style-url="https://api.maptiler.com/maps/outdoor-v2/style.json?key=maptiler-test-key"',
    );
    expect(html).toContain('/styles/adminAreaEditor.css');
    expect(html).toContain('maplibre-gl@5.24.0');
    expect(html).toContain('/scripts/admin/polygonAreaEditor.js');
    expect(html).toContain('data-geojson-import');
    expect(html).toContain('data-field="city"');
    expect(html).toContain('data-cancel-area');
    expect(html).toContain(
      'href="/admin/areas" class="admin-tab is-active" aria-current="page">Areas</a>',
    );
    expect(html).not.toContain('/scripts/dashboard.js');
    expect(html).not.toContain('/scripts/arena.js');
    expect(html).not.toContain('/admin/areas/large');
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
    expect(html).toMatch(/data-auth-panel="login" aria-labelledby="login-heading"\s+hidden>/);
    expect(html).toMatch(/data-auth-panel="signup" aria-labelledby="signup-heading"\s*>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('value="never-render-this-password"');
  });
});
