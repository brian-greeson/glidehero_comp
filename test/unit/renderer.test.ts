import { describe, expect, it } from 'vitest';
import {
  createErrorPageRenderer,
  createPageRenderer,
} from '../../src/views/renderer.js';
import {
  createAdminAreaPageRenderer,
  createAdminFlightProcessingPageRenderer,
  createAdminMapSettingsPageRenderer,
  createAdminPageRenderer,
  createAdminUserPageRenderer,
} from '../../src/views/admin/renderer.js';

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
    const html = await createAdminPageRenderer()({
      currentUser: user,
      flights: [],
      queueSummary: { queued: 0, processing: 0, failed: 0, oldestQueuedAgeSeconds: 0 },
      reprocessSuccess: true,
    });
    expect(html).toContain('The 100 most recently uploaded flights.');
    expect(html).toContain('<dd>0</dd>');
    expect(html).not.toContain('Global control state');
    expect(html).not.toContain('dashboard.js');
    expect(html).not.toContain('maplibre-gl');

    const flightProcessing = await createAdminFlightProcessingPageRenderer()({
      currentUser: user,
      queueSummary: { queued: 0, processing: 0, failed: 0, oldestQueuedAgeSeconds: 0 },
      workerControlState: 'paused',
      sixPointSolverState: 'enabled',
      workers: [{
        workerId: 'worker-1',
        state: 'processing',
        currentJobId: 'job-1',
        heartbeatAt: 1_750_000_000_000,
        processedCount: 3,
        failedCount: 1,
        lastError: 'temporary read failure',
        heartbeat: '2026-07-22T00:00:00.000Z',
        online: true,
      }],
    });
    expect(flightProcessing).toContain('<h1>Flight Processing</h1>');
    expect(flightProcessing).toContain('Current state: <strong>enabled</strong>');
    expect(flightProcessing).toContain('Disable solver');
    expect(flightProcessing).toContain('Global control state: <strong>paused</strong>');
    expect(flightProcessing).toContain('worker-1');
    expect(flightProcessing).toContain('<td>3</td>');
    expect(flightProcessing).toContain('<td>1</td>');
    expect(flightProcessing).toContain('temporary read failure');
    expect(flightProcessing).toContain('Online');
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
      completedFlightCount: 0,
      search: '',
      searchParam: '',
      flightSort: { field: 'uploadDate', direction: 'desc' },
      flightDateSortUrl: '',
      uploadDateSortUrl: '',
      mode: 'empty',
    });
    expect(users).toContain('admin-user-page');

    const sortedFlights = await createAdminUserPageRenderer()({
      currentUser: user,
      users: [{ id: user.userId, email: user.email, displayName: user.displayName }],
      selectedUser: {
        id: user.userId,
        email: user.email,
        displayName: user.displayName,
        hasPassword: true,
        lastLogin: new Date('2026-07-15T12:00:00Z'),
        createdAt: new Date('2026-07-01T12:00:00Z'),
        updatedAt: new Date('2026-07-15T12:00:00Z'),
      },
      flights: [{
        id: '00000000-0000-4000-8000-000000000020',
        flightDate: '2026-07-14',
        uploadDate: '2026-07-15 08:30 UTC',
        originalFilename: 'flight.igc',
        processingStatus: 'completed',
      }],
      deletableFlightCount: 1,
      completedFlightCount: 1,
      search: 'pilot@example.com',
      searchParam: 'pilot%40example.com',
      flightSort: { field: 'flightDate', direction: 'asc' },
      flightDateSortUrl: `/admin/users/${user.userId}?sort=flightDate&direction=desc`,
      uploadDateSortUrl: `/admin/users/${user.userId}?sort=uploadDate&direction=asc`,
      mode: 'edit',
    });
    expect(sortedFlights).toContain('aria-sort="ascending"');
    expect(sortedFlights).toContain('Upload date');
    expect(sortedFlights).toContain('2026-07-15 08:30 UTC');
    expect(sortedFlights).toContain('name="sort" value="flightDate"');
    expect(sortedFlights).toContain('name="direction" value="asc"');
    expect(sortedFlights).toContain(`<form method="post" action="/admin/users/${user.userId}/history/rebuild"`);
    expect(sortedFlights).toContain('Rebuild Achievement and Activity History');
    expect(sortedFlights).toContain('Rebuild achievement and Activity history for pilot@example.com? Existing achievements, flight progress, activities, and Activity likes will be deleted and recreated in flown order.');
    expect(sortedFlights).toContain('name="q" value="pilot@example.com"');
    expect(sortedFlights.indexOf('<h2>History</h2>')).toBeLessThan(sortedFlights.indexOf('<h2>Delete user</h2>'));

    const noCompletedFlights = await createAdminUserPageRenderer()({
      currentUser: user,
      users: [{ id: user.userId, email: user.email, displayName: user.displayName }],
      selectedUser: {
        id: user.userId,
        email: user.email,
        displayName: user.displayName,
        hasPassword: true,
        lastLogin: new Date('2026-07-15T12:00:00Z'),
        createdAt: new Date('2026-07-01T12:00:00Z'),
        updatedAt: new Date('2026-07-15T12:00:00Z'),
      },
      flights: [{
        id: '00000000-0000-4000-8000-000000000021',
        flightDate: null,
        uploadDate: '2026-07-15 08:30 UTC',
        originalFilename: 'failed.igc',
        processingStatus: 'failed',
      }],
      deletableFlightCount: 1,
      completedFlightCount: 0,
      search: '',
      searchParam: '',
      flightSort: { field: 'uploadDate', direction: 'desc' },
      flightDateSortUrl: '',
      uploadDateSortUrl: '',
      mode: 'edit',
    });
    expect(noCompletedFlights).toMatch(/<button type="submit" disabled>Rebuild Achievement and Activity History<\/button>/);
  });
});
