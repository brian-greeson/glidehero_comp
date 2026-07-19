import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { AuthFailure, type AuthService } from '../../src/services/authService.js';
import {
  emptyGridClaimGeoJson,
  type GridClaimGeoJson,
} from '../../src/domain/territory/gridClaimGeoJson.js';
import {
  emptyMonthlyCoverageGeoJson,
  type MonthlyCoverageGeoJson,
} from '../../src/domain/competition/monthlyCoverage.js';
import type { ProfileService } from '../../src/services/profileService.js';
import type { GridClaimService } from '../../src/services/gridClaimService.js';
import type { MonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';
import type { AdminFlightService } from '../../src/services/adminFlightService.js';
import type { ArenaService } from '../../src/services/arenaService.js';
import type { MapGridService } from '../../src/services/mapGridService.js';
import type { FlightUploadQueueService } from '../../src/services/flightUploadQueueService.js';
import type { FailedFlightCleanupService } from '../../src/services/failedFlightCleanupService.js';
import { createPageRenderer } from '../../src/views/renderer.js';
import { createCurrentUserMiddleware } from '../../src/web/currentUserMiddleware.js';
import { createSessionCookie } from '../../src/web/sessionCookie.js';
import { createWebRouter } from '../../src/web/webRouter.js';
import { withServer } from '../support/http.js';

const viewportStats = {
  claimedCellCount: 2,
  claimedAreaSquareMeters: 2_000_000,
  flightCount: 1,
};

const user = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'pilot@example.com',
  displayName: 'Sky Pilot',
  territoryColor: '#1769AA',
};

const arena = {
  id: '00000000-0000-4000-8000-000000000099',
  sourceId: 745,
  name: 'Boulder',
  city: 'Boulder',
  state: 'Colorado',
  country: 'United States',
  countryCode: 'us',
  path: '/arena/us/boulder-745',
  boundary: {
    type: 'Feature' as const,
    properties: { sourceId: 745, name: 'Boulder' },
    geometry: { type: 'MultiPolygon' as const, coordinates: [] },
    bbox: [-106, 39, -105, 40] as [number, number, number, number],
  },
};

function arenaService(): ArenaService {
  return {
    search: vi.fn(async () => []),
    getBySourceId: vi.fn(async () => null),
    getByRoute: vi.fn(async () => null),
  };
}

function mapGridService(): MapGridService {
  return {
    getViewport: vi.fn(async () => ({
      status: 'ok' as const,
      geojson: { type: 'FeatureCollection' as const, features: [] },
    })),
    getArena: vi.fn(async () => ({ status: 'ok' as const, geojson: { type: 'FeatureCollection' as const, features: [] } })),
  };
}

function dependencies() {
  const auth: AuthService = {
    signup: vi.fn(async () => ({ token: 'new-token', expiresAt: new Date(), user })),
    login: vi.fn(async () => ({ token: 'login-token', expiresAt: new Date(), user })),
    authenticate: vi.fn(async (token) => (token === 'valid-token' ? user : null)),
    logout: vi.fn(async () => undefined),
  };
  const cookie = createSessionCookie({
    name: 'glidehero_session',
    secure: false,
    maxAgeSeconds: 604800,
  });
  const renderPage = vi.fn(
    async (model) =>
      `<html><body><h1>GlideHero</h1><div>${model.currentUser?.displayName ?? 'anonymous'}</div>` +
      `<div>${model.loginError ?? model.signupError ?? ''}</div></body></html>`,
  );
  const middleware = createCurrentUserMiddleware(auth, cookie);
  const profiles: ProfileService = { updateTerritoryColor: vi.fn(async () => undefined) };
  const expectedGridGeoJson: GridClaimGeoJson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-105, 40],
          [-104.99, 40],
          [-104.99, 40.01],
          [-105, 40.01],
          [-105, 40],
        ]],
      },
    }],
  };
  const gridClaim: GridClaimService = {
    get: vi.fn(async (): Promise<GridClaimGeoJson> => expectedGridGeoJson),
    getViewportStats: vi.fn(async () => viewportStats),
    process: vi.fn(async () => ({
      flightId: '00000000-0000-4000-8000-000000000020',
      cellSize: 1_000,
      directCellCount: 0,
      enclosedCellCount: 0,
    })),
    reprocess: vi.fn(async () => ({ status: 'not_found' as const })),
  };
  const expectedCoverageGeoJson: MonthlyCoverageGeoJson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        cellId: '1000:0:0',
        cellSize: 1_000,
        x: 0,
        y: 0,
        claimantCount: 1,
        isShared: false,
        pilotUserId: user.userId,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-105, 40],
          [-104.99, 40],
          [-104.99, 40.01],
          [-105, 40.01],
          [-105, 40],
        ]],
      },
    }],
  };
  const coverage: MonthlyCoverageService = {
    getGlobalTerritory: vi.fn(async () => expectedCoverageGeoJson),
    getArenaTerritory: vi.fn(async () => expectedCoverageGeoJson),
    getGlobalLeaderboard: vi.fn(async () => ({
      leaders: [{
        userId: user.userId,
        displayName: user.displayName,
        claimedCellCount: 2,
        exclusiveCellCount: 1,
        sharedCellCount: 1,
        claimedAreaSquareMeters: 2_000_000,
        rank: 1,
      }],
      currentPilot: null,
    })),
    getArenaLeaderboard: vi.fn(async () => ({
      leaders: [], currentPilot: null,
    })),
    getCellClaimants: vi.fn(async () => [{ userId: user.userId, displayName: user.displayName }]),
  };
  const arenas = arenaService();
  const mapGrid = mapGridService();
  const router = createWebRouter({
    auth,
    cookie,
    profiles,
    gridClaim,
    mapGrid,
    coverage,
    arenas,
    renderPage,
  });
  return {
    auth,
    profiles,
    gridClaim,
    mapGrid,
    coverage,
    arenas,
    expectedGridGeoJson,
    expectedCoverageGeoJson,
    renderPage,
    cookie,
    app: createApp({ webMiddleware: [middleware, router] }),
  };
}

describe('webRouter', () => {
  it('serves bounded viewport and Arena grids only to authenticated users', async () => {
    const { app, mapGrid, arenas } = dependencies();
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/v1/grid?west=-107&south=39&east=-105&north=41`);
      expect(anonymous.status).toBe(401);

      const invalid = await fetch(`${baseUrl}/v1/grid?west=nope&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(invalid.status).toBe(400);

      const valid = await fetch(`${baseUrl}/v1/grid?west=-107&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(valid.status).toBe(200);
      expect(valid.headers.get('content-type')).toContain('application/geo+json');
      expect(mapGrid.getViewport).toHaveBeenCalledWith({ west: -107, south: 39, east: -105, north: 41 });

      vi.mocked(mapGrid.getViewport).mockResolvedValueOnce({ status: 'too_large' });
      const tooLarge = await fetch(`${baseUrl}/v1/grid?west=-107&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(tooLarge.status).toBe(422);
      expect(await tooLarge.json()).toEqual({
        error: { code: 'grid_viewport_too_large', message: 'Zoom in to view grid.' },
      });

      vi.mocked(arenas.getBySourceId).mockResolvedValueOnce(arena);
      const arenaGrid = await fetch(`${baseUrl}/v1/arenas/745/grid?west=-106&south=39&east=-105&north=40`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(arenaGrid.status).toBe(200);
      expect(mapGrid.getArena).toHaveBeenCalledWith({ arenaId: arena.id, west: -106, south: 39, east: -105, north: 40 });

      const unknown = await fetch(`${baseUrl}/v1/arenas/999/grid?west=-106&south=39&east=-105&north=40`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(unknown.status).toBe(404);
    });
  });

  it('creates, completes, reports, and clears authenticated queued uploads', async () => {
    const base = dependencies();
    const uploadQueue = {
      createIntent: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000030', uploadUrl: 'https://objects.example.test/signed' })),
      complete: vi.fn(async () => undefined),
      cancel: vi.fn(async () => true),
      progress: vi.fn(async () => ({
        total: 2, finished: 1, queued: 1, processing: 0, failed: 1,
      })),
      listJobs: vi.fn(async () => ({
        total: 2, page: 1, pageSize: 100,
        jobs: [{ id: 'job-1', originalFilename: 'flight.igc', status: 'failed' as const, error: 'bad track' }],
      })),
      queueSummary: vi.fn(async () => ({ queued: 1, processing: 0, failed: 1, oldestQueuedAgeSeconds: 12 })),
    } as unknown as FlightUploadQueueService;
    const failedFlightCleanup: FailedFlightCleanupService = { clearForUser: vi.fn(async () => 1) };
    const router = createWebRouter({
      auth: base.auth,
      cookie: base.cookie,
      uploadQueue,
      failedFlightCleanup,
      profiles: base.profiles,
      gridClaim: base.gridClaim,
      mapGrid: base.mapGrid,
      coverage: base.coverage,
      arenas: base.arenas,
      renderPage: base.renderPage,
    });
    const app = createApp({ webMiddleware: [createCurrentUserMiddleware(base.auth, base.cookie), router] });

    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/v1/igc-upload-progress`);
      expect(anonymous.status).toBe(401);

      const headers = { cookie: 'glidehero_session=valid-token', 'content-type': 'application/json' };
      const intent = await fetch(`${baseUrl}/v1/igc-uploads/intents`, {
        method: 'POST', headers, body: JSON.stringify({ originalFilename: 'flight.igc', contentType: 'text/plain', byteSize: 100 }),
      });
      expect(intent.status).toBe(201);
      expect(uploadQueue.createIntent).toHaveBeenCalledWith({ userId: user.userId, originalFilename: 'flight.igc', contentType: 'text/plain', byteSize: 100 });

      const completed = await fetch(`${baseUrl}/v1/igc-uploads/00000000-0000-4000-8000-000000000030/complete`, { method: 'POST', headers, body: '{}' });
      expect(completed.status).toBe(202);
      expect(uploadQueue.complete).toHaveBeenCalledWith({ userId: user.userId, id: '00000000-0000-4000-8000-000000000030' });

      const cancelled = await fetch(`${baseUrl}/v1/igc-uploads/00000000-0000-4000-8000-000000000030`, { method: 'DELETE', headers });
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toEqual({ removed: true });
      expect(uploadQueue.cancel).toHaveBeenCalledWith({ userId: user.userId, id: '00000000-0000-4000-8000-000000000030' });

      expect((await fetch(`${baseUrl}/v1/igc-upload-progress`, { headers })).status).toBe(200);
      const details = await fetch(`${baseUrl}/v1/igc-upload-jobs?page=1`, { headers });
      expect((await details.json() as { jobs: unknown[] }).jobs).toHaveLength(1);
      expect(uploadQueue.listJobs).toHaveBeenCalledWith(user.userId, { page: 1, pageSize: 100 });
      const cleared = await fetch(`${baseUrl}/v1/igc-upload-failures`, { method: 'DELETE', headers });
      expect(await cleared.json()).toEqual({ cleared: 1 });
      expect(failedFlightCleanup.clearForUser).toHaveBeenCalledWith(user.userId);
    });
  });

  it('limits admin routes to configured admin emails and redirects completed reprocessing', async () => {
    const { auth, cookie, profiles, gridClaim, mapGrid, coverage, arenas, renderPage } = dependencies();
    const adminFlights: AdminFlightService = {
      listRecentFlights: vi.fn(async () => [{
        id: '00000000-0000-4000-8000-000000000020',
        flightDate: '2026-07-14',
        pilotEmail: 'pilot@example.com',
        originalFilename: 'flight.igc',
        processingStatus: 'completed' as const,
      }]),
      reprocessFlight: vi.fn(async () => ({
        status: 'completed' as const,
        result: { flightId: '00000000-0000-4000-8000-000000000020', cellSize: 1000, directCellCount: 1, enclosedCellCount: 0 },
      })),
      listUserFlights: vi.fn(async () => []),
      deleteFlight: vi.fn(async () => 'deleted' as const),
      deleteAllUserFlights: vi.fn(async () => ({ deleted: 0, skipped: 0, failed: 0 })),
      createDownloadUrl: vi.fn(async () => null),
    };
    const renderAdminPage = vi.fn(async () => '<html><body>Admin flights</body></html>');
    const router = createWebRouter({
      auth,
      cookie,
      profiles,
      gridClaim,
      mapGrid,
      coverage,
      arenas,
      renderPage,
      adminEmails: ['PILOT@example.com'],
      adminFlights,
      renderAdminPage,
    });
    const app = createApp({ webMiddleware: [createCurrentUserMiddleware(auth, cookie), router] });

    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/admin`);
      expect(anonymous.status).toBe(403);

      const admin = await fetch(`${baseUrl}/admin`, { headers: { cookie: 'glidehero_session=valid-token' } });
      expect(admin.status).toBe(200);
      expect(await admin.text()).toContain('Admin flights');
      expect(adminFlights.listRecentFlights).toHaveBeenCalledOnce();

      const reprocess = await fetch(`${baseUrl}/admin/flights/00000000-0000-4000-8000-000000000020/reprocess`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(reprocess.status).toBe(303);
      expect(reprocess.headers.get('location')).toBe('/admin?reprocess=success');
      expect(adminFlights.reprocessFlight).toHaveBeenCalledWith({ flightId: '00000000-0000-4000-8000-000000000020' });
    });
  });

  it('renders anonymous and authenticated page states over HTTP', async () => {
    const { app } = dependencies();
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/`);
      expect(anonymous.status).toBe(200);
      expect(anonymous.headers.get('content-type')).toContain('text/html');
      expect(await anonymous.text()).toContain('anonymous');

      const authenticated = await fetch(`${baseUrl}/`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(authenticated.status).toBe(200);
      expect(await authenticated.text()).toContain('Sky Pilot');
    });
  });

  it('protects dashboard routes and renders canonical Arenas with a basic 404', async () => {
    const { app, arenas, renderPage } = dependencies();
    vi.mocked(arenas.getByRoute).mockResolvedValueOnce(arena).mockResolvedValueOnce(null);
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/global`, { redirect: 'manual' });
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get('location')).toBe('/');

      const found = await fetch(`${baseUrl}/arena/us/boulder-745`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(found.status).toBe(200);
      expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ page: 'arena', arena }));

      vi.mocked(renderPage).mockClear();
      const missing = await fetch(`${baseUrl}/arena/us/missing-999`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('text/html');
      expect(await missing.text()).toContain('/error-mascot.webp');
      expect(renderPage).not.toHaveBeenCalled();
    });
  });

  it('renders the site-wide 404 page model for every unmatched route', async () => {
    const { app, renderPage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/somewhere-remote`);
      expect(anonymous.status).toBe(404);
      expect(await anonymous.text()).toContain('Well… that landing could have gone better.');

      const authenticated = await fetch(`${baseUrl}/arena/us/boulder-745/extra`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(authenticated.status).toBe(404);
      expect(await authenticated.text()).toContain('/error-mascot.webp');

      expect(renderPage).not.toHaveBeenCalled();
    });
  });

  it('searches Arenas and returns fixed-area territory and leaderboard data', async () => {
    const { app, arenas, coverage, expectedCoverageGeoJson } = dependencies();
    vi.mocked(arenas.search).mockResolvedValueOnce([arena]);
    vi.mocked(arenas.getBySourceId).mockResolvedValue(arena);
    await withServer(app, async (baseUrl) => {
      const headers = { cookie: 'glidehero_session=valid-token' };
      const search = await fetch(`${baseUrl}/v1/arenas?q=Boulder`, { headers });
      expect(search.status).toBe(200);
      expect(await search.json()).toEqual({ arenas: [arena] });

      const territory = await fetch(`${baseUrl}/v1/arenas/745/competition-territory?month=2026-07&pilot=${user.userId}&west=-107&south=39&east=-105&north=41`, { headers });
      expect(territory.status).toBe(200);
      expect(await territory.json()).toEqual(expectedCoverageGeoJson);
      expect(coverage.getArenaTerritory).toHaveBeenCalledWith({
        competitionMonth: '2026-07', arenaId: arena.id, pilotUserId: user.userId,
        west: -107, south: 39, east: -105, north: 41,
      });

      const leaderboard = await fetch(`${baseUrl}/v1/arenas/745/competition-leaderboard?month=2026-07`, { headers });
      expect(leaderboard.status).toBe(200);
      expect(coverage.getArenaLeaderboard).toHaveBeenCalledWith({
        competitionMonth: '2026-07', arenaId: arena.id, currentUserId: user.userId,
      });

      const allTimeTerritory = await fetch(
        `${baseUrl}/v1/arenas/745/competition-territory?west=-107&south=39&east=-105&north=41`,
        { headers },
      );
      expect(allTimeTerritory.status).toBe(200);
      expect(coverage.getArenaTerritory).toHaveBeenCalledWith({
        period: 'all-time', arenaId: arena.id, west: -107, south: 39, east: -105, north: 41,
      });

      const allTimeLeaderboard = await fetch(
        `${baseUrl}/v1/arenas/745/competition-leaderboard`,
        { headers },
      );
      expect(allTimeLeaderboard.status).toBe(200);
      expect(coverage.getArenaLeaderboard).toHaveBeenCalledWith({
        period: 'all-time', arenaId: arena.id, currentUserId: user.userId,
      });

      const claimants = await fetch(
        `${baseUrl}/v1/competition-cells/1/2/claimants?month=2026-07`,
        { headers },
      );
      expect(claimants.status).toBe(200);
      expect(await claimants.json()).toEqual({
        claimants: [{ userId: user.userId, displayName: user.displayName }],
      });
      expect(coverage.getCellClaimants).toHaveBeenCalledWith({
        competitionMonth: '2026-07', x: 1, y: 2,
      });
    });
  });

  it('treats a malformed session cookie as an anonymous request', async () => {
    const { app, auth } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`, {
        headers: { cookie: 'glidehero_session=%' },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('anonymous');
      expect(auth.authenticate).not.toHaveBeenCalled();
    });
  });

  it('serves the stylesheet before authentication middleware', async () => {
    const { app, auth } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/styles/app.css`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/css');
      expect(await response.text()).toContain('.landing-hero');
      expect(auth.authenticate).not.toHaveBeenCalled();
    });
  });

  it('signs up, sets the protected cookie, and redirects with 303', async () => {
    const { app, auth } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
          displayName: 'Sky Pilot',
        }),
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/global?onboarding=1');
      expect(response.headers.get('set-cookie')).toContain(
        'glidehero_session=new-token; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
      );
      expect(auth.signup).toHaveBeenCalledWith({
        email: 'pilot@example.com',
        password: 'correct horse battery staple',
        displayName: 'Sky Pilot',
      });
    });
  });

  it('logs in, sets the protected cookie, and redirects with 303', async () => {
    const { app } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
        }),
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(response.headers.get('set-cookie')).toContain(
        'glidehero_session=login-token; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax',
      );
    });
  });

  it('renders a generic login error', async () => {
    const { app, auth } = dependencies();
    vi.mocked(auth.login).mockRejectedValueOnce(new AuthFailure('invalid_credentials'));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'never-render-this-password',
        }),
      });
      const html = await response.text();
      expect(response.status).toBe(401);
      expect(html).toContain('Email or password is incorrect.');
    });
  });

  it('renders a generic duplicate signup error', async () => {
    const { app, auth } = dependencies();
    vi.mocked(auth.signup).mockRejectedValueOnce(new AuthFailure('duplicate_email'));
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'never-render-this-password',
          displayName: 'Sky Pilot',
        }),
      });
      const html = await response.text();
      expect(response.status).toBe(409);
      expect(html).toContain('An account with that email already exists.');
    });
  });

  it('renders a controlled login response when the request body is absent', async () => {
    const { app } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/login`, { method: 'POST' });

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('Email or password is incorrect.');
    });
  });

  it('renders a controlled signup response when the request body is absent', async () => {
    const { app } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, { method: 'POST' });

      expect(response.status).toBe(422);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain(
        'Enter a valid email, an optional display name of up to 48 characters, and a password of 12 to 128 characters.',
      );
    });
  });

  it('uses real Vento HTML to redisplay safe signup fields without the password', async () => {
    const { auth } = dependencies();
    vi.mocked(auth.signup).mockRejectedValueOnce(new AuthFailure('duplicate_email'));
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: false,
      maxAgeSeconds: 604800,
    });
    const middleware = createCurrentUserMiddleware(auth, cookie);
    const router = createWebRouter({
      auth,
      cookie,
      profiles: { updateTerritoryColor: vi.fn(async () => undefined) },
      gridClaim: {
        get: vi.fn(async () => emptyGridClaimGeoJson()),
        getViewportStats: vi.fn(async () => viewportStats),
        process: vi.fn(async () => ({
          flightId: 'flight-id', cellSize: 1_000, directCellCount: 0, enclosedCellCount: 0,
        })),
        reprocess: vi.fn(async () => ({ status: 'not_found' as const })),
      },
      mapGrid: mapGridService(),
      coverage: {
        getGlobalTerritory: vi.fn(async () => emptyMonthlyCoverageGeoJson()),
        getArenaTerritory: vi.fn(async () => emptyMonthlyCoverageGeoJson()),
        getGlobalLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null })),
        getArenaLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null })),
        getCellClaimants: vi.fn(async () => []),
      },
      arenas: arenaService(),
      renderPage: createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' }),
    });
    const app = createApp({ webMiddleware: [middleware, router] });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'never-render-this-password',
          displayName: 'Sky Pilot',
        }),
      });
      const html = await response.text();

      expect(response.status).toBe(409);
      expect(html).toContain('value="pilot@example.com"');
      expect(html).toContain('value="Sky Pilot"');
      expect(html).not.toContain('never-render-this-password');
    });
  });

  it('logs out, revokes the token, clears the cookie, and redirects', async () => {
    const { app, auth } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(response.headers.get('set-cookie')).toContain(
        'glidehero_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
      );
      expect(auth.logout).toHaveBeenCalledWith('valid-token');
    });
  });

  it('persists an authenticated pilot map color and redirects with success', async () => {
    const { app, profiles, renderPage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/profile/territory-color`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: 'glidehero_session=valid-token',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          territoryColor: '#a1b2c3',
          returnTo: '/arena/us/boulder-745?month=2026-07',
        }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        '/arena/us/boulder-745?month=2026-07&territoryColor=success',
      );
      expect(profiles.updateTerritoryColor).toHaveBeenCalledWith({
        userId: user.userId,
        territoryColor: '#A1B2C3',
      });
    });
  });

  it('rejects malformed territory colors without updating a profile', async () => {
    const { app, profiles, renderPage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/profile/territory-color`, {
        method: 'POST',
        headers: {
          cookie: 'glidehero_session=valid-token',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ territoryColor: '#ABC' }),
      });

      expect(response.status).toBe(422);
      await response.text();
      expect(profiles.updateTerritoryColor).not.toHaveBeenCalled();
      expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({
        territoryColorError: 'Choose a valid six-digit hex color.',
      }));
    });
  });

  it('does not update a profile for an unauthenticated territory-color request', async () => {
    const { app, profiles } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/profile/territory-color`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ territoryColor: '#A1B2C3' }),
      });

      expect(response.status).toBe(401);
      expect(profiles.updateTerritoryColor).not.toHaveBeenCalled();
    });
  });

  it('returns the grid territory', async () => {
    const { app, expectedGridGeoJson, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/personal-territory?west=-107&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual(expectedGridGeoJson);
      expect(gridClaim.get).toHaveBeenCalledWith({
        userId: user.userId, west: -107, south: 39, east: -105, north: 41,
      });
    });
  });

  it('rejects an anonymous personal-territory request without reading a projection', async () => {
    const { app, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/personal-territory`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'Sign in to view your personal territory.' },
      });
      expect(gridClaim.get).not.toHaveBeenCalled();
    });
  });

  it('rejects personal territory without viewport bounds', async () => {
    const { app, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/personal-territory`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'invalid_request', message: 'Personal territory requires valid viewport bounds.' },
      });
      expect(gridClaim.get).not.toHaveBeenCalled();
    });
  });

  it('returns personal stats for an authenticated viewport request', async () => {
    const { app, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/personal-stats?west=-107&south=39&east=-105&north=41`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(viewportStats);
      expect(gridClaim.getViewportStats).toHaveBeenCalledWith({
        userId: user.userId,
        west: -107,
        south: 39,
        east: -105,
        north: 41,
      });
    });
  });

  it.each([
    'west=nope&south=39&east=-105&north=41',
    'west=-181&south=39&east=-105&north=41',
    'west=-107&south=41&east=-105&north=39',
    'west=-107&south=39&east=-107&north=41',
    'west=-107&south=39&east=-105',
    'west=-107&south=39&east=-105&north=41&extra=value',
  ])('rejects invalid personal stats query %s', async (query) => {
    const { app, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/personal-stats?${query}`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'invalid_request', message: 'Personal stats require valid viewport bounds.' },
      });
      expect(gridClaim.getViewportStats).not.toHaveBeenCalled();
    });
  });

  it('rejects anonymous personal stats without querying claims', async () => {
    const { app, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/personal-stats?west=-107&south=39&east=-105&north=41`);

      expect(response.status).toBe(401);
      expect(gridClaim.getViewportStats).not.toHaveBeenCalled();
    });
  });

  it('returns selected-pilot coverage for the URL month', async () => {
    const { app, coverage, expectedCoverageGeoJson } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory?month=2026-07&pilot=${user.userId}&west=-107&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual(expectedCoverageGeoJson);
      expect(coverage.getGlobalTerritory).toHaveBeenCalledWith({
        competitionMonth: '2026-07', pilotUserId: user.userId, west: -107, south: 39, east: -105, north: 41,
      });
    });
  });

  it('returns all-time competition ownership', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory?west=-107&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(coverage.getGlobalTerritory).toHaveBeenCalledWith({
        period: 'all-time', west: -107, south: 39, east: -105, north: 41,
      });
    });
  });

  it.each(['', '2026-13', '07-2026'])('rejects invalid competition month %j', async (month) => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory?month=${encodeURIComponent(month)}&west=-107&south=39&east=-105&north=41`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'invalid_request', message: 'Competition territory requires a valid YYYY-MM month and viewport bounds.' },
      });
      expect(coverage.getGlobalTerritory).not.toHaveBeenCalled();
    });
  });

  it('rejects an anonymous competition-territory request without reading claims', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'Sign in to view competition territory.' },
      });
      expect(coverage.getGlobalTerritory).not.toHaveBeenCalled();
    });
  });

  it('rejects competition territory without viewport bounds', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'invalid_request', message: 'Competition territory requires a valid YYYY-MM month and viewport bounds.' },
      });
      expect(coverage.getGlobalTerritory).not.toHaveBeenCalled();
    });
  });

  it('returns the leaderboard for an authenticated YYYY-MM viewport request', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/competition-leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        leaders: [{
          userId: user.userId,
          displayName: user.displayName,
          claimedCellCount: 2,
          exclusiveCellCount: 1,
          sharedCellCount: 1,
          claimedAreaSquareMeters: 2_000_000,
          rank: 1,
        }],
        currentPilot: null,
      });
      expect(coverage.getGlobalLeaderboard).toHaveBeenCalledWith({
        competitionMonth: '2026-07',
        west: -107,
        south: 39,
        east: -105,
        north: 41,
        currentUserId: user.userId,
      });
    });
  });

  it('returns the all-time viewport leaderboard and stats', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/competition-leaderboard?west=-107&south=39&east=-105&north=41`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );

      expect(response.status).toBe(200);
      expect(coverage.getGlobalLeaderboard).toHaveBeenCalledWith({
        period: 'all-time',
        west: -107,
        south: 39,
        east: -105,
        north: 41,
        currentUserId: user.userId,
      });
    });
  });

  it.each([
    'month=2026-07-14&west=-107&south=39&east=-105&north=41',
    'month=2026-13&west=-107&south=39&east=-105&north=41',
    'month=2026-07&west=nope&south=39&east=-105&north=41',
    'month=2026-07&west=-181&south=39&east=-105&north=41',
    'month=2026-07&west=-107&south=91&east=-105&north=41',
    'month=2026-07&west=-107&south=41&east=-105&north=39',
    'month=2026-07&west=-107&south=39&east=-107&north=41',
    'month=2026-07&west=-107&south=39&east=-105',
    'month=2026-07&west=-107&south=39&east=-105&north=41&extra=value',
  ])('rejects invalid leaderboard query %s', async (query) => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-leaderboard?${query}`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'invalid_request',
          message: 'Competition leaderboard requires a valid YYYY-MM month and viewport bounds.',
        },
      });
      expect(coverage.getGlobalLeaderboard).not.toHaveBeenCalled();
    });
  });

  it('accepts a date-line-crossing viewport', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/competition-leaderboard?month=2026-07&west=179.9&south=-1&east=-179.9&north=1`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );

      expect(response.status).toBe(200);
      expect(coverage.getGlobalLeaderboard).toHaveBeenCalledWith(expect.objectContaining({
        west: 179.9,
        east: -179.9,
      }));
    });
  });

  it('rejects an anonymous leaderboard request without querying claims', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/competition-leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41`,
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'Sign in to view the competition leaderboard.' },
      });
      expect(coverage.getGlobalLeaderboard).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid and anonymous cell claimant requests without querying coverage', async () => {
    const { app, coverage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const invalid = await fetch(
        `${baseUrl}/v1/competition-cells/not-an-integer/2/claimants?month=2026-07`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        error: { code: 'invalid_request', message: 'Cell claimants require valid coordinates and a YYYY-MM month.' },
      });

      const anonymous = await fetch(`${baseUrl}/v1/competition-cells/1/2/claimants?month=2026-07`);
      expect(anonymous.status).toBe(401);
      expect(coverage.getCellClaimants).not.toHaveBeenCalled();
    });
  });

});
