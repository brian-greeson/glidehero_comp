import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { AuthFailure, type AuthService } from '../../src/services/authService.js';
import {
  emptyGridClaimGeoJson,
  type GridClaimGeoJson,
} from '../../src/domain/territory/gridClaimGeoJson.js';
import {
  emptyCompetitionGridClaimGeoJson,
  type CompetitionGridClaimGeoJson,
} from '../../src/domain/territory/competitionGridClaimGeoJson.js';
import type { ProfileService } from '../../src/services/profileService.js';
import type { FlightProcessingOutcome } from '../../src/services/flightProcessingService.js';
import type { GridClaimService } from '../../src/services/gridClaimService.js';
import type { CompetitionGridClaimService } from '../../src/services/competitionGridClaimService.js';
import type { AdminFlightService } from '../../src/services/adminFlightService.js';
import { createPageRenderer } from '../../src/views/renderer.js';
import { createCurrentUserMiddleware } from '../../src/web/currentUserMiddleware.js';
import { createSessionCookie } from '../../src/web/sessionCookie.js';
import { createWebRouter } from '../../src/web/webRouter.js';
import { withServer } from '../support/http.js';

const viewportStats = {
  claimedCellCount: 2,
  claimedAreaSquareMeters: 2_000_000,
  flightCount: 1,
  visibleCellCount: 20,
  claimedPercentage: 10,
};

const competitionStats = {
  ...viewportStats,
  pilotCount: 1,
  currentPilotFlightCount: 1,
};

const user = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'pilot@example.com',
  displayName: 'Sky Pilot',
  territoryColor: '#1769AA',
};

function dependencies(
  outcome: FlightProcessingOutcome = {
    status: 'completed',
    flightId: '00000000-0000-4000-8000-000000000020',
  },
) {
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
      `<div>${model.loginError ?? model.signupError ?? model.uploadError ?? ''}</div></body></html>`,
  );
  const middleware = createCurrentUserMiddleware(auth, cookie);
  const igcFiles = { upload: vi.fn(async () => outcome) };
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
  const expectedCompetitionGeoJson: CompetitionGridClaimGeoJson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        ownerUserId: user.userId,
        cellId: '2026-07-01:1000:0:0',
        competitionMonth: '2026-07-01',
        cellSize: 1_000,
        x: 0,
        y: 0,
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
  const competitionGridClaim: CompetitionGridClaimService = {
    process: vi.fn(async () => undefined),
    getCurrent: vi.fn(async () => expectedCompetitionGeoJson),
    getViewportLeaderboard: vi.fn(async () => ({
      leaders: [{
        userId: user.userId,
        displayName: user.displayName,
        claimedCellCount: 2,
        claimedAreaSquareMeters: 2_000_000,
        rank: 1,
      }],
      currentPilot: null,
      stats: competitionStats,
    })),
  };
  const router = createWebRouter({
    auth,
    cookie,
    igcFiles,
    profiles,
    gridClaim,
    competitionGridClaim,
    renderPage,
  });
  return {
    auth,
    igcFiles,
    profiles,
    gridClaim,
    competitionGridClaim,
    expectedGridGeoJson,
    expectedCompetitionGeoJson,
    renderPage,
    cookie,
    app: createApp({ webMiddleware: [middleware, router] }),
  };
}

describe('webRouter', () => {
  it('limits admin routes to configured admin emails and redirects completed reprocessing', async () => {
    const { auth, cookie, igcFiles, profiles, gridClaim, competitionGridClaim, renderPage } = dependencies();
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
    };
    const renderAdminPage = vi.fn(async () => '<html><body>Admin flights</body></html>');
    const router = createWebRouter({
      auth,
      cookie,
      igcFiles,
      profiles,
      gridClaim,
      competitionGridClaim,
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
      expect(response.headers.get('location')).toBe('/');
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
      igcFiles: {
        upload: vi.fn(async (): Promise<FlightProcessingOutcome> => ({
          status: 'completed',
          flightId: '00000000-0000-4000-8000-000000000020',
        })),
      },
      profiles: { updateTerritoryColor: vi.fn(async () => undefined) },
      gridClaim: {
        get: vi.fn(async () => emptyGridClaimGeoJson()),
        getViewportStats: vi.fn(async () => viewportStats),
        process: vi.fn(async () => ({
          flightId: 'flight-id', cellSize: 1_000, directCellCount: 0, enclosedCellCount: 0,
        })),
        reprocess: vi.fn(async () => ({ status: 'not_found' as const })),
      },
      competitionGridClaim: {
        getCurrent: vi.fn(async () => emptyCompetitionGridClaimGeoJson()),
        getViewportLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null, stats: competitionStats })),
      },
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

  it('renders the successful processing message from the success query', async () => {
    const { auth } = dependencies();
    const cookie = createSessionCookie({
      name: 'glidehero_session',
      secure: false,
      maxAgeSeconds: 604800,
    });
    const app = createApp({
      webMiddleware: [
        createCurrentUserMiddleware(auth, cookie),
        createWebRouter({
          auth,
          cookie,
          igcFiles: {
            upload: vi.fn(async (): Promise<FlightProcessingOutcome> => ({
              status: 'completed',
              flightId: '00000000-0000-4000-8000-000000000020',
            })),
          },
          profiles: { updateTerritoryColor: vi.fn(async () => undefined) },
          gridClaim: {
            get: vi.fn(async () => emptyGridClaimGeoJson()),
            getViewportStats: vi.fn(async () => viewportStats),
            process: vi.fn(async () => ({
              flightId: 'flight-id', cellSize: 1_000, directCellCount: 0, enclosedCellCount: 0,
            })),
            reprocess: vi.fn(async () => ({ status: 'not_found' as const })),
          },
          competitionGridClaim: {
            getCurrent: vi.fn(async () => emptyCompetitionGridClaimGeoJson()),
            getViewportLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null, stats: competitionStats })),
          },
          renderPage: createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' }),
        }),
      ],
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/?igcUpload=success`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('IGC flight processed successfully.');
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
        body: new URLSearchParams({ territoryColor: '#a1b2c3' }),
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/?territoryColor=success');
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
      const response = await fetch(`${baseUrl}/v1/personal-territory`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual(expectedGridGeoJson);
      expect(gridClaim.get).toHaveBeenCalledWith({ userId: user.userId });
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

  it('returns current competition ownership for the browser date', async () => {
    const { app, competitionGridClaim, expectedCompetitionGeoJson } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory?date=2026-07-14`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual(expectedCompetitionGeoJson);
      expect(competitionGridClaim.getCurrent).toHaveBeenCalledWith({ competitionMonth: '2026-07-14' });
    });
  });

  it.each(['', '2026-02-29', '07-14-2026'])('rejects invalid competition date %j', async (date) => {
    const { app, competitionGridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory?date=${encodeURIComponent(date)}`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: 'invalid_request', message: 'Competition date must be a valid ISO calendar date.' },
      });
      expect(competitionGridClaim.getCurrent).not.toHaveBeenCalled();
    });
  });

  it('rejects an anonymous competition-territory request without reading claims', async () => {
    const { app, competitionGridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/competition-territory?date=2026-07-14`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'Sign in to view competition territory.' },
      });
      expect(competitionGridClaim.getCurrent).not.toHaveBeenCalled();
    });
  });

  it('returns the leaderboard for an authenticated YYYY-MM viewport request', async () => {
    const { app, competitionGridClaim } = dependencies();
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
          claimedAreaSquareMeters: 2_000_000,
          rank: 1,
        }],
        currentPilot: null,
        stats: competitionStats,
      });
      expect(competitionGridClaim.getViewportLeaderboard).toHaveBeenCalledWith({
        competitionMonth: '2026-07',
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
    const { app, competitionGridClaim } = dependencies();
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
      expect(competitionGridClaim.getViewportLeaderboard).not.toHaveBeenCalled();
    });
  });

  it('accepts a date-line-crossing viewport', async () => {
    const { app, competitionGridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/competition-leaderboard?month=2026-07&west=179.9&south=-1&east=-179.9&north=1`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );

      expect(response.status).toBe(200);
      expect(competitionGridClaim.getViewportLeaderboard).toHaveBeenCalledWith(expect.objectContaining({
        west: 179.9,
        east: -179.9,
      }));
    });
  });

  it('rejects an anonymous leaderboard request without querying claims', async () => {
    const { app, competitionGridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/competition-leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41`,
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'Sign in to view the competition leaderboard.' },
      });
      expect(competitionGridClaim.getViewportLeaderboard).not.toHaveBeenCalled();
    });
  });

  it('rejects an unauthenticated IGC upload without storing a file', async () => {
    const { app, igcFiles } = dependencies();
    const form = new FormData();
    form.set('igcFile', new Blob(['AXXX']), 'flight.igc');

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/igc-files`, { method: 'POST', body: form });
      expect(response.status).toBe(401);
      expect(igcFiles.upload).not.toHaveBeenCalled();
    });
  });

  it('redirects after a completed IGC processing result', async () => {
    const { app, igcFiles } = dependencies({
      status: 'completed',
      flightId: '00000000-0000-4000-8000-000000000020',
    });
    const form = new FormData();
    form.set('igcFile', new Blob(['AXXX IGC flight']), 'flight.igc');

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/igc-files`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
        body: form,
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/?igcUpload=success');
      expect(igcFiles.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerUserId: user.userId,
          originalFilename: 'flight.igc',
          bytes: Buffer.from('AXXX IGC flight'),
        }),
      );
    });
  });

  it('renders the processing failure returned by the service', async () => {
    const { app } = dependencies({
      status: 'failed',
      flightId: '00000000-0000-4000-8000-000000000020',
      message: 'This IGC file has no valid GPS fixes to process.',
    });
    const form = new FormData();
    form.set('igcFile', new Blob(['AXXX IGC flight']), 'flight.igc');

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/igc-files`, {
        method: 'POST',
        headers: { cookie: 'glidehero_session=valid-token' },
        body: form,
      });

      expect(response.status).toBe(422);
      expect(await response.text()).toContain('This IGC file has no valid GPS fixes to process.');
    });
  });

  it('renders a duplicate IGC upload as a validation error', async () => {
    const { app } = dependencies({
      status: 'duplicate',
      message: 'This flight has already been uploaded.',
    });
    const form = new FormData();
    form.set('igcFile', new Blob(['AXXX IGC flight']), 'flight.igc');

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/igc-files`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
        body: form,
      });

      expect(response.status).toBe(422);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toContain('This flight has already been uploaded.');
    });
  });

  it('rejects a non-IGC filename without storing a file', async () => {
    const { app, igcFiles } = dependencies();
    const form = new FormData();
    form.set('igcFile', new Blob(['not an IGC']), 'flight.txt');

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/igc-files`, {
        method: 'POST',
        headers: { cookie: 'glidehero_session=valid-token' },
        body: form,
      });
      expect(response.status).toBe(422);
      expect(await response.text()).toContain('Choose an IGC file with a .igc filename.');
      expect(igcFiles.upload).not.toHaveBeenCalled();
    });
  });

  it('rejects an IGC upload larger than 10 MB without storing a file', async () => {
    const { app, igcFiles } = dependencies();
    const form = new FormData();
    form.set('igcFile', new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]), 'flight.igc');

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/igc-files`, {
        method: 'POST',
        headers: { cookie: 'glidehero_session=valid-token' },
        body: form,
      });
      expect(response.status).toBe(422);
      expect(await response.text()).toContain('IGC files must be 10 MB or smaller.');
      expect(igcFiles.upload).not.toHaveBeenCalled();
    });
  });
});
