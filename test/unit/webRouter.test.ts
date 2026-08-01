import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { AuthFailure, type AuthService } from '../../src/services/authService.js';
import type { ProfileService } from '../../src/services/profileService.js';
import type { GridClaimService } from '../../src/services/gridClaimService.js';
import type { MonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';
import type { TerritoryTileService } from '../../src/services/territoryTileService.js';
import type { AdminFlightService } from '../../src/services/adminFlightService.js';
import type { ArenaService } from '../../src/services/arenaService.js';
import type { ArenaProgressService } from '../../src/services/arenaProgressService.js';
import type { MapGridService } from '../../src/services/mapGridService.js';
import type { FlightUploadQueueService } from '../../src/services/flightUploadQueueService.js';
import type { FlightUploadWorkflowService } from '../../src/services/flightUploadWorkflowService.js';
import type { WorkerControlService } from '../../src/services/workerControlService.js';
import type { FailedFlightCleanupService } from '../../src/services/failedFlightCleanupService.js';
import { PilotNotFoundError, type FollowService } from '../../src/services/followService.js';
import { ActivityNotFoundError, SelfLikeError, type ActivityService } from '../../src/services/activityService.js';
import { createTerritoryTileSettingsService } from '../../src/services/territoryTileSettingsService.js';
import { createPageRenderer } from '../../src/views/renderer.js';
import { createCurrentUserMiddleware } from '../../src/web/currentUserMiddleware.js';
import { createSessionCookie } from '../../src/web/sessionCookie.js';
import { createWebRouter } from '../../src/web/webRouter.js';
import { withServer } from '../support/http.js';
import type { FlightDetailService, FlightDetailSummary } from '../../src/services/flightDetailService.js';
import type { CellFlightTrackResult, CellFlightTrackService } from '../../src/services/cellFlightTrackService.js';
import type { MapReplayService } from '../../src/services/mapReplayService.js';
import type { OnboardingService } from '../../src/services/onboardingService.js';
import type { PlanService } from '../../src/services/planService.js';
import type { ThermalRasterCacheService } from '../../src/services/thermalRasterCacheService.js';

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

const pilotProfile = {
  userId: '00000000-0000-4000-8000-000000000003',
  displayName: 'Cloud Dancer',
  territoryColor: '#A1B2C3',
  lifetimeUniqueCellCount: 12,
  nextUniqueCellMilestone: 25,
  uniqueCellsToNextMilestone: 13,
  nextUniqueCellMilestoneProgressPercent: 48,
  achievementProgress: [{
    key: 'unique_cells' as const, achievementType: 'unique_cells_milestone' as const,
    badgeLabel: '25', badgeAriaLabel: 'Unique cell milestone progress toward 25',
    typeLabel: 'Unique cell milestone', title: '25 Unique Cells',
    currentValue: 12, targetValue: 25, currentLabel: '12', targetLabel: '25', progressPercent: 48,
    currentDescription: 'Claim 13 more cells on your Personal Map.',
    otherDescription: 'Cloud Dancer needs 13 more cells to reach this Personal Map milestone.',
  }],
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

const arena = {
  id: '00000000-0000-4000-8000-000000000099',
  sourceId: 745,
  name: 'Boulder',
  city: 'Boulder',
  state: 'Colorado',
  country: 'United States',
  countryCode: 'us',
  arenaType: 'general' as const,
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

function arenaProgressService(): ArenaProgressService {
  return { get: vi.fn(async () => ({ kind: 'general' as const, firstProgressDate: null, mostRecentProgressDate: null, claimedCells: 0, totalCells: 1, coveragePercentage: 0, nextMilestone: 10 })) };
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
  const renderAuthenticatedPage = vi.fn(async () => '<html><body>App page</body></html>');
  const renderAuthenticatedActivityFeed = vi.fn(async () => '<div data-activity-feed>App feed</div>');
  const middleware = createCurrentUserMiddleware(auth, cookie);
  const profiles: ProfileService = {
    updateTerritoryColor: vi.fn(async () => undefined),
    getDashboardAchievementProgress: vi.fn(async () => []),
    getPilotProfile: vi.fn(async () => null),
    getPilotAchievements: vi.fn(async () => null),
    searchGliderModels: vi.fn(async () => [{
      manufacturer: 'Ozone',
      model: 'Buzz Z7',
      sizes: [{ id: '00000000-0000-4000-8000-000000000017', value: 'XS', enRating: 'B' }],
    }]),
  };
  const follow: FollowService = {
    follow: vi.fn(async () => undefined),
    unfollow: vi.fn(async () => undefined),
    isFollowing: vi.fn(async () => false),
    searchPilots: vi.fn(async () => []),
  };
  const activity: ActivityService = {
    listFeed: vi.fn(async () => ({ items: [], nextCursor: null })),
    getStatistics: vi.fn(async () => ({
      daily: {
        flightCount: 0,
        mostAccomplishments: null,
        mostCells: null,
        greatestFivePointDistance: null,
      },
      monthly: {
        flightCount: 0,
        mostAccomplishments: null,
        mostCells: null,
        greatestFivePointDistance: null,
      },
    })),
    publishFlightInTransaction: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000010' })),
    regenerateFlightActivity: vi.fn(async () => 'completed' as const),
    toggleLike: vi.fn(async () => ({ reacted: true, totalCount: 1 })),
  };
  const onboarding: OnboardingService = {
    initializeInTransaction: vi.fn(async () => undefined),
    getState: vi.fn(async () => null),
    dismiss: vi.fn(async () => true),
    restore: vi.fn(async () => true),
    markPersonalMapViewed: vi.fn(async () => true),
    markCompetitiveMapViewed: vi.fn(async () => true),
  };
  const gridClaim: GridClaimService = {
    getViewportStats: vi.fn(async () => viewportStats),
    process: vi.fn(async () => ({
      flightId: '00000000-0000-4000-8000-000000000020',
      cellSize: 1_000,
      directCellCount: 0,
      enclosedCellCount: 0,
      newPersonalCellCount: 0,
      personalCellTotalAfter: 0,
      progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
      arenaAchievements: { newlyEarned: [], alreadyEarned: 0, record: null },
    })),
    reprocess: vi.fn(async () => ({ status: 'not_found' as const })),
  };
  const coverage: MonthlyCoverageService = {
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
  };
  const territoryTiles: TerritoryTileService = {
    getPersonalTile: vi.fn(async () => ({ data: Buffer.alloc(0), featureCount: 0 })),
    getGlobalCompetitionTile: vi.fn(async () => ({ data: Buffer.alloc(0), featureCount: 0 })),
    getArenaCompetitionTile: vi.fn(async () => ({ data: Buffer.alloc(0), featureCount: 0 })),
  };
  const cellTrackResult: CellFlightTrackResult = {
    cell: {
      type: 'Feature',
      properties: { cellId: '1000:1:2', x: 1, y: 2 },
      geometry: { type: 'Polygon', coordinates: [] },
    },
    tracks: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { flightId: '00000000-0000-4000-8000-000000000010', pilotUserId: user.userId },
        geometry: { type: 'LineString', coordinates: [[-105, 40], [-104.9, 40.1]] },
      }],
    },
  };
  const cellFlightTracks: CellFlightTrackService = {
    getPersonal: vi.fn(async () => cellTrackResult),
    getCompetition: vi.fn(async () => cellTrackResult),
  };
  const arenas = arenaService();
  const arenaProgress = arenaProgressService();
  const mapGrid = mapGridService();
  const mapReplay: MapReplayService = { getReplay: vi.fn(async () => ({ flights: [] })) };
  const plans: PlanService = { route: vi.fn(async (input) => ({
    anchors: input.anchors, route: input.anchors,
    legs: [{ directDistanceMeters: 1_000, maximumDistanceMeters: 1_200, routeDistanceMeters: 1_000 }],
    directDistanceMeters: 1_000, routeDistanceMeters: 1_000, actualDeviationPercent: 0,
    thermalCoverage: 'unavailable' as const, claims: { direct: [], enclosed: [], newPersonal: [] },
  })) };
  const thermalRasters: ThermalRasterCacheService = {
    get: vi.fn(async () => ({ body: Buffer.from('png'), contentType: 'image/png' as const, bucketKey: 'thermal_tiles/tile.png', cache: 'hit' as const })),
    cache: vi.fn(async () => null),
  };
  const router = createWebRouter({
    auth,
    cookie,
    profiles,
    follow,
    activity,
    onboarding,
    gridClaim,
    mapGrid,
    mapReplay,
    plans,
    thermalRasters,
    coverage,
    territoryTiles,
    cellFlightTracks,
    arenas,
    arenaProgress,
    renderPage,
    renderAuthenticatedPage,
    renderAuthenticatedActivityFeed,
  });
  return {
    auth,
    profiles,
    follow,
    activity,
    onboarding,
    gridClaim,
    mapGrid,
    mapReplay,
    plans,
    thermalRasters,
    coverage,
    territoryTiles,
    cellFlightTracks,
    arenas,
    arenaProgress,
    renderPage,
    renderAuthenticatedPage,
    renderAuthenticatedActivityFeed,
    cookie,
    app: createApp({ webMiddleware: [middleware, router] }),
  };
}

describe('webRouter', () => {
  it('serves the authenticated Plan page, cached raster tiles, and route calculations', async () => {
    const base = dependencies();
    await withServer(base.app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/plan`, { redirect: 'manual' });
      expect(anonymous.status).toBe(302);
      const headers = { cookie: 'glidehero_session=valid-token' };
      expect((await fetch(`${baseUrl}/plan`, { headers })).status).toBe(200);
      expect(base.renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 'plan', thermalTileUrl: '/v1/thermal/tiles/{z}/{x}/{y}.png', defaultDeviationPercent: 20,
      }));

      const tile = await fetch(`${baseUrl}/v1/thermal/tiles/12/2144/2717.png`, { headers });
      expect(tile.status).toBe(200);
      expect(tile.headers.get('x-glidehero-thermal-cache')).toBe('hit');
      expect(base.thermalRasters.get).toHaveBeenCalledWith({ zoom: 12, x: 2144, tmsY: 1378 });

      const invalidTile = await fetch(`${baseUrl}/v1/thermal/tiles/13/0/0.png`, { headers });
      expect(invalidTile.status).toBe(400);
      expect(base.thermalRasters.get).toHaveBeenCalledTimes(1);

      const route = await fetch(`${baseUrl}/v1/plan/route`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39.1, longitude: -104.9 }],
          maximumDeviationPercent: 20,
        }),
      });
      expect(route.status).toBe(200);
      expect(base.plans.route).toHaveBeenCalledWith(expect.objectContaining({ userId: user.userId, maximumDeviationPercent: 20 }));

      vi.mocked(base.plans.route).mockRejectedValueOnce(new RangeError('Each planned leg must be 1,000 km or shorter.'));
      const oversizedRoute = await fetch(`${baseUrl}/v1/plan/route`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          anchors: [{ latitude: 39, longitude: -105 }, { latitude: 39.1, longitude: -104.9 }],
          maximumDeviationPercent: 20,
        }),
      });
      expect(oversizedRoute.status).toBe(422);
    });
  });

  it('returns typo-tolerant combined make/model glider search results only to authenticated pilots', async () => {
    const base = dependencies();
    await withServer(base.app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/profile/glider/search?q=Ozon%20Buz`);
      expect(anonymous.status).toBe(401);

      const response = await fetch(`${baseUrl}/profile/glider/search?q=Ozon%20Buz`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ manufacturer: 'Ozone', model: 'Buzz Z7' }),
      ]));
    });
  });

  it('serves completed flight detail HTML and map JSON to any authenticated pilot', async () => {
    const base = dependencies();
    const flightId = '00000000-0000-4000-8000-000000000020';
    const points = [
      { sequenceNumber: 1, recordedAt: '2026-07-23T14:00:00.000Z', latitude: 40, longitude: -105, gpsAltitudeMeters: 1_500 },
      { sequenceNumber: 2, recordedAt: '2026-07-23T14:10:00.000Z', latitude: 40.1, longitude: -104.9, gpsAltitudeMeters: 1_600 },
    ];
    const summary: FlightDetailSummary = {
      id: flightId,
      ownerUserId: pilotProfile.userId,
      ownerDisplayName: pilotProfile.displayName,
      territoryColor: pilotProfile.territoryColor,
      startedAt: new Date('2026-07-23T14:00:00.000Z'),
      endedAt: new Date('2026-07-23T15:00:00.000Z'),
      launchTimezone: 'America/Denver',
      durationSeconds: 3_600,
      launchLatitude: 40,
      launchLongitude: -105,
      progress: { directCellCount: 2, enclosedCellCount: 1, newPersonalCellCount: 1, personalCellTotalAfter: 10 },
      scores: {
        track: { distanceMeters: 12_345, calcVersion: 1, metadata: {} },
        threePoint: null,
        fourPoint: null,
        fivePoint: { distanceMeters: 10_005, calcVersion: 1, metadata: { points } },
        sixPoint: null,
      },
      accomplishments: [],
    };
    const flightDetail: FlightDetailService = {
      getSummary: vi.fn(async () => summary),
      getMapData: vi.fn(async () => ({
        track: points.map((point) => ({ ...point, recordedAt: new Date(point.recordedAt), pressureAltitudeMeters: point.gpsAltitudeMeters })),
        launch: { latitude: 40, longitude: -105 },
        landing: { latitude: 40.1, longitude: -104.9 },
        directCells: { type: 'FeatureCollection' as const, features: [] },
        enclosedCells: { type: 'FeatureCollection' as const, features: [] },
      })),
    };
    const router = createWebRouter({
      auth: base.auth,
      cookie: base.cookie,
      profiles: base.profiles,
      follow: base.follow,
      activity: base.activity,
      flightDetail,
      gridClaim: base.gridClaim,
      mapGrid: base.mapGrid,
      coverage: base.coverage,
      territoryTiles: base.territoryTiles,
      arenas: base.arenas,
      arenaProgress: base.arenaProgress,
      renderPage: base.renderPage,
      renderAuthenticatedPage: base.renderAuthenticatedPage,
      renderAuthenticatedActivityFeed: base.renderAuthenticatedActivityFeed,
      mapTilerStyleUrl: 'https://maps.example/style.json',
    });
    const app = createApp({ webMiddleware: [createCurrentUserMiddleware(base.auth, base.cookie), router] });

    await withServer(app, async (baseUrl) => {
      const anonymousPage = await fetch(`${baseUrl}/flights/${flightId}`, { redirect: 'manual' });
      expect(anonymousPage.status).toBe(302);
      const anonymousMap = await fetch(`${baseUrl}/v1/flights/${flightId}/map`);
      expect(anonymousMap.status).toBe(401);

      const headers = { cookie: 'glidehero_session=valid-token' };
      expect((await fetch(`${baseUrl}/flights/not-a-uuid`, { headers })).status).toBe(404);
      const page = await fetch(`${baseUrl}/flights/${flightId}`, { headers });
      expect(page.status).toBe(200);
      expect(base.renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 'flight',
        flight: expect.objectContaining({
          id: flightId,
          defaultDistance: 'fivePoint',
          mapStyleUrl: 'https://maps.example/style.json',
        }),
      }));

      const map = await fetch(`${baseUrl}/v1/flights/${flightId}/map`, { headers });
      expect(map.status).toBe(200);
      expect(map.headers.get('cache-control')).toBe('private, max-age=60');
      expect(await map.json()).toMatchObject({
        territoryColor: pilotProfile.territoryColor,
        track: { geometry: { coordinates: [[-105, 40], [-104.9, 40.1]] } },
        scores: { fivePoint: { turnpoints: { features: [{ properties: {} }, { properties: {} }] } } },
      });
    });

    vi.mocked(flightDetail.getSummary).mockResolvedValueOnce(null);
    await withServer(app, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/flights/${flightId}`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(missing.status).toBe(404);
    });
  });

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
        total: 2, finished: 1, completed: 1, completedIds: ['done-1'], queued: 1, processing: 0, failed: 1,
      })),
      listJobs: vi.fn(async () => ({
        total: 2, page: 1, pageSize: 100,
        jobs: [{ id: 'job-1', originalFilename: 'flight.igc', status: 'failed' as const, error: 'bad track' }],
      })),
      queueSummary: vi.fn(async () => ({ queued: 1, processing: 0, failed: 1, oldestQueuedAgeSeconds: 12 })),
      getJob: vi.fn(async () => null),
      saveJob: vi.fn(async () => undefined),
    } as unknown as FlightUploadQueueService;
    const failedFlightCleanup: FailedFlightCleanupService = { clearForUser: vi.fn(async () => 1) };
    const uploadWorkflow = {
      createRegularBatch: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000040', status: 'open' as const })),
      sealRegularBatch: vi.fn(async () => true),
      claimNextRegular: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000041',
        flightId: '00000000-0000-4000-8000-000000000042',
        startedAt: new Date('2026-07-20T12:00:00Z'),
        uploadJobId: 'regular-job',
        batchId: '00000000-0000-4000-8000-000000000040',
      })),
      createBulkImport: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000050', phase: 'preparing' as const })),
      sealBulkImport: vi.fn(async () => true),
      claimNextBulk: vi.fn(async () => null),
      beginBulkReplay: vi.fn(async () => true),
      cancelBulkImport: vi.fn(async () => ({ cancelled: true, jobs: [] })),
    } as unknown as FlightUploadWorkflowService;
    uploadQueue.activateJob = vi.fn(async () => true);
    const router = createWebRouter({
      auth: base.auth,
      cookie: base.cookie,
      uploadQueue,
      uploadWorkflow,
      failedFlightCleanup,
      profiles: base.profiles,
      gridClaim: base.gridClaim,
      mapGrid: base.mapGrid,
      coverage: base.coverage,
      territoryTiles: base.territoryTiles,
      arenas: base.arenas,
      arenaProgress: base.arenaProgress,
      renderPage: base.renderPage,
      renderAuthenticatedPage: base.renderAuthenticatedPage,
      renderAuthenticatedActivityFeed: base.renderAuthenticatedActivityFeed,
    });
    const app = createApp({ webMiddleware: [createCurrentUserMiddleware(base.auth, base.cookie), router] });

    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/v1/igc-upload-progress`);
      expect(anonymous.status).toBe(401);

      const headers = { cookie: 'glidehero_session=valid-token', 'content-type': 'application/json' };
      const intent = await fetch(`${baseUrl}/v1/igc-uploads/intents`, {
        method: 'POST', headers, body: JSON.stringify({
          originalFilename: 'flight.igc',
          contentType: 'text/plain',
          byteSize: 100,
          batchId: '00000000-0000-4000-8000-000000000040',
        }),
      });
      expect(intent.status).toBe(201);
      expect(uploadQueue.createIntent).toHaveBeenCalledWith({
        userId: user.userId,
        originalFilename: 'flight.igc',
        contentType: 'text/plain',
        byteSize: 100,
        batchId: '00000000-0000-4000-8000-000000000040',
      });

      const regularBatch = await fetch(`${baseUrl}/v1/flight-upload-batches`, {
        method: 'POST', headers, body: JSON.stringify({ kind: 'regular' }),
      });
      expect(regularBatch.status).toBe(201);
      const regularSeal = await fetch(`${baseUrl}/v1/flight-upload-batches/00000000-0000-4000-8000-000000000040/seal`, {
        method: 'POST', headers, body: '{}',
      });
      expect(regularSeal.status).toBe(202);
      expect(uploadQueue.activateJob).toHaveBeenCalledWith('regular-job', '00000000-0000-4000-8000-000000000041');

      const bulkImport = await fetch(`${baseUrl}/v1/flight-history-imports`, {
        method: 'POST', headers, body: '{}',
      });
      expect(bulkImport.status).toBe(201);
      const bulkSeal = await fetch(`${baseUrl}/v1/flight-history-imports/00000000-0000-4000-8000-000000000050/seal`, {
        method: 'POST', headers, body: '{}',
      });
      expect(bulkSeal.status).toBe(202);
      expect(uploadWorkflow.beginBulkReplay).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000050',
        user.userId,
      );
      const bulkCancel = await fetch(`${baseUrl}/v1/flight-history-imports/00000000-0000-4000-8000-000000000050`, {
        method: 'DELETE', headers,
      });
      expect(bulkCancel.status).toBe(200);
      expect(uploadWorkflow.cancelBulkImport).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000050',
        user.userId,
      );
      vi.mocked(uploadWorkflow.cancelBulkImport).mockResolvedValueOnce({ cancelled: false, jobs: [] });
      const lateBulkCancel = await fetch(`${baseUrl}/v1/flight-history-imports/00000000-0000-4000-8000-000000000050`, {
        method: 'DELETE', headers,
      });
      expect(lateBulkCancel.status).toBe(409);

      vi.mocked(uploadWorkflow.sealBulkImport).mockResolvedValueOnce(false);
      const lateBulkSeal = await fetch(`${baseUrl}/v1/flight-history-imports/00000000-0000-4000-8000-000000000050/seal`, {
        method: 'POST', headers, body: '{}',
      });
      expect(lateBulkSeal.status).toBe(409);

      const completed = await fetch(`${baseUrl}/v1/igc-uploads/00000000-0000-4000-8000-000000000030/complete`, { method: 'POST', headers, body: '{}' });
      expect(completed.status).toBe(202);
      expect(uploadQueue.complete).toHaveBeenCalledWith({ userId: user.userId, id: '00000000-0000-4000-8000-000000000030' });

      const cancelled = await fetch(`${baseUrl}/v1/igc-uploads/00000000-0000-4000-8000-000000000030`, { method: 'DELETE', headers });
      expect(cancelled.status).toBe(200);
      expect(await cancelled.json()).toEqual({ removed: true });
      expect(uploadQueue.cancel).toHaveBeenCalledWith({ userId: user.userId, id: '00000000-0000-4000-8000-000000000030' });

      const progress = await fetch(`${baseUrl}/v1/igc-upload-progress`, { headers });
      expect(progress.status).toBe(200);
      expect(await progress.json()).toMatchObject({ completedIds: ['done-1'] });
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
        result: {
          flightId: '00000000-0000-4000-8000-000000000020', cellSize: 1000,
          directCellCount: 1, enclosedCellCount: 0, newPersonalCellCount: 1,
          personalCellTotalAfter: 1, progressionVersion: 1,
          evaluatedAt: new Date('2026-07-20T00:00:00Z'),
          arenaAchievements: { newlyEarned: [], alreadyEarned: 0, record: null },
        },
      })),
      regenerateActivity: vi.fn(async () => 'completed' as const),
      listUserFlights: vi.fn(async () => []),
      deleteFlight: vi.fn(async () => 'deleted' as const),
      deleteAllUserFlights: vi.fn(async () => ({ deleted: 0, skipped: 0, failed: 0 })),
      createDownloadUrl: vi.fn(async () => null),
    };
    const workerControl: WorkerControlService = {
      getState: vi.fn(async (): Promise<'paused'> => 'paused'),
      setState: vi.fn(async () => undefined),
      initialize: vi.fn(async () => undefined),
      publishStatus: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => null),
      listStatuses: vi.fn(async () => [{
        workerId: 'worker-1', state: 'processing' as const, currentJobId: 'job-1', heartbeatAt: Date.now(),
        processedCount: 3, failedCount: 1, lastError: 'temporary read failure',
      }]),
      clearStatus: vi.fn(async () => undefined),
    };
    const flightProcessingControl = {
      getNPointSolverState: vi.fn(async () => 'enabled' as const),
      setNPointSolverState: vi.fn(async () => undefined),
      isNPointSolverEnabled: vi.fn(async () => true),
    };
    const uploadQueue = {
      queueSummary: vi.fn(async () => ({
        queued: 2,
        processing: 1,
        failed: 0,
        oldestQueuedAgeSeconds: 12,
      })),
    };
    const renderAdminPage = vi.fn(async () => '<html><body>Admin flights</body></html>');
    const renderAdminFlightProcessingPage = vi.fn(async () => '<html><body>Flight processing</body></html>');
    const router = createWebRouter({
      auth,
      cookie,
      profiles,
      gridClaim,
      mapGrid,
      coverage,
      territoryTiles: dependencies().territoryTiles,
      arenas,
      arenaProgress: dependencies().arenaProgress,
      renderPage,
      renderAuthenticatedPage: vi.fn(async () => '<html><body>App page</body></html>'),
      renderAuthenticatedActivityFeed: vi.fn(async () => '<div>App feed</div>'),
      adminEmails: ['PILOT@example.com'],
      adminFlights,
      uploadQueue: uploadQueue as never,
      workerControl,
      flightProcessingControl,
      renderAdminPage,
      renderAdminFlightProcessingPage,
    });
    const app = createApp({ webMiddleware: [createCurrentUserMiddleware(auth, cookie), router] });

    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/admin`);
      expect(anonymous.status).toBe(403);

      const admin = await fetch(`${baseUrl}/admin`, { headers: { cookie: 'glidehero_session=valid-token' } });
      expect(admin.status).toBe(200);
      expect(await admin.text()).toContain('Admin flights');
      expect(adminFlights.listRecentFlights).toHaveBeenCalledOnce();
      expect(renderAdminPage).toHaveBeenCalledWith(expect.objectContaining({
        queueSummary: { queued: 2, processing: 1, failed: 0, oldestQueuedAgeSeconds: 12 },
      }));
      expect(workerControl.getState).not.toHaveBeenCalled();

      const flightProcessing = await fetch(`${baseUrl}/admin/flight-processing`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(flightProcessing.status).toBe(200);
      expect(await flightProcessing.text()).toContain('Flight processing');
      expect(workerControl.getState).toHaveBeenCalledOnce();
      expect(workerControl.listStatuses).toHaveBeenCalledOnce();
      expect(flightProcessingControl.getNPointSolverState).toHaveBeenCalledOnce();
      expect(renderAdminFlightProcessingPage).toHaveBeenCalledWith(expect.objectContaining({
        queueSummary: { queued: 2, processing: 1, failed: 0, oldestQueuedAgeSeconds: 12 },
        workerControlState: 'paused',
        nPointSolverState: 'enabled',
        workers: [expect.objectContaining({ workerId: 'worker-1', online: true })],
      }));

      const anonymousControl = await fetch(`${baseUrl}/admin/worker-control`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'running' }),
      });
      expect(anonymousControl.status).toBe(403);

      const reprocess = await fetch(`${baseUrl}/admin/flights/00000000-0000-4000-8000-000000000020/reprocess`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(reprocess.status).toBe(303);
      expect(reprocess.headers.get('location')).toBe('/admin?reprocess=success');
      expect(adminFlights.reprocessFlight).toHaveBeenCalledWith({ flightId: '00000000-0000-4000-8000-000000000020' });

      const resume = await fetch(`${baseUrl}/admin/worker-control`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'running' }),
      });
      expect(resume.status).toBe(303);
      expect(resume.headers.get('location')).toBe('/admin/flight-processing?worker=running');
      expect(workerControl.setState).toHaveBeenCalledWith('running');

      vi.mocked(workerControl.setState).mockRejectedValueOnce(new Error('Valkey write failed'));
      const failedControl = await fetch(`${baseUrl}/admin/worker-control`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'paused' }),
      });
      expect(failedControl.status).toBe(303);
      expect(failedControl.headers.get('location')).toBe('/admin/flight-processing?worker=error');

      const invalidControl = await fetch(`${baseUrl}/admin/worker-control`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'stop' }),
      });
      expect(invalidControl.status).toBe(303);
      expect(invalidControl.headers.get('location')).toBe('/admin/flight-processing?worker=error');

      const disableSolver = await fetch(`${baseUrl}/admin/flight-processing/n-point-solver`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'disabled' }),
      });
      expect(disableSolver.status).toBe(303);
      expect(disableSolver.headers.get('location')).toBe('/admin/flight-processing?solver=disabled');
      expect(flightProcessingControl.setNPointSolverState).toHaveBeenCalledWith('disabled');

      flightProcessingControl.setNPointSolverState.mockRejectedValueOnce(new Error('Valkey write failed'));
      const failedSolver = await fetch(`${baseUrl}/admin/flight-processing/n-point-solver`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'enabled' }),
      });
      expect(failedSolver.status).toBe(303);
      expect(failedSolver.headers.get('location')).toBe('/admin/flight-processing?solver=error');

      const invalidSolver = await fetch(`${baseUrl}/admin/flight-processing/n-point-solver`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ state: 'maybe' }),
      });
      expect(invalidSolver.status).toBe(303);
      expect(invalidSolver.headers.get('location')).toBe('/admin/flight-processing?solver=error');
    });
  });

  it('updates admin map settings for subsequent renders and tile requests in the current runtime', async () => {
    const base = dependencies();
    const territoryTileSettings = createTerritoryTileSettingsService();
    const renderAdminMapSettingsPage = vi.fn(async () => '<html><body>Map settings</body></html>');
    const router = createWebRouter({
      auth: base.auth,
      cookie: base.cookie,
      profiles: base.profiles,
      gridClaim: base.gridClaim,
      mapGrid: base.mapGrid,
      coverage: base.coverage,
      territoryTiles: base.territoryTiles,
      arenas: base.arenas,
      arenaProgress: base.arenaProgress,
      renderPage: base.renderPage,
      renderAuthenticatedPage: base.renderAuthenticatedPage,
      renderAuthenticatedActivityFeed: base.renderAuthenticatedActivityFeed,
      adminEmails: ['PILOT@example.com'],
      territoryTileSettings,
      renderAdminMapSettingsPage,
    });
    const app = createApp({
      webMiddleware: [createCurrentUserMiddleware(base.auth, base.cookie), router],
    });
    const adminHeaders = { cookie: 'glidehero_session=valid-token' };

    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/admin/map-settings`)).status).toBe(403);
      expect((await fetch(`${baseUrl}/admin/map-settings`, { method: 'POST' })).status).toBe(403);

      const settingsPage = await fetch(`${baseUrl}/admin/map-settings`, { headers: adminHeaders });
      expect(settingsPage.status).toBe(200);
      expect(await settingsPage.text()).toContain('Map settings');
      expect(renderAdminMapSettingsPage).toHaveBeenCalledWith(expect.objectContaining({
        settings: {
          personal: { minimumZoom: 4, maximumZoom: 14 },
          competition: { minimumZoom: 4, maximumZoom: 14 },
        },
      }));

      const saved = await fetch(`${baseUrl}/admin/map-settings`, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...adminHeaders, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          personalMinimumZoom: '5',
          personalMaximumZoom: '11',
          competitionMinimumZoom: '6',
          competitionMaximumZoom: '12',
        }),
      });
      expect(saved.status).toBe(303);
      expect(saved.headers.get('location')).toBe('/admin/map-settings?save=success');
      expect(territoryTileSettings.get()).toEqual({
        personal: { minimumZoom: 5, maximumZoom: 11 },
        competition: { minimumZoom: 6, maximumZoom: 12 },
      });

      expect((await fetch(`${baseUrl}/v1/personal-territory/tiles/4/0/0.mvt`, { headers: adminHeaders })).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/personal-territory/tiles/5/0/0.mvt`, { headers: adminHeaders })).status).toBe(200);
      expect((await fetch(`${baseUrl}/v1/competition-territory/tiles/5/0/0.mvt`, { headers: adminHeaders })).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/competition-territory/tiles/6/0/0.mvt`, { headers: adminHeaders })).status).toBe(200);

      const invalid = await fetch(`${baseUrl}/admin/map-settings`, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...adminHeaders, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          personalMinimumZoom: '12',
          personalMaximumZoom: '11',
          competitionMinimumZoom: '6',
          competitionMaximumZoom: '23',
        }),
      });
      expect(invalid.status).toBe(303);
      expect(invalid.headers.get('location')).toBe('/admin/map-settings?save=error');
      expect(territoryTileSettings.get()).toEqual({
        personal: { minimumZoom: 5, maximumZoom: 11 },
        competition: { minimumZoom: 6, maximumZoom: 12 },
      });

      await fetch(`${baseUrl}/admin/map-settings?save=success`, { headers: adminHeaders });
      expect(renderAdminMapSettingsPage).toHaveBeenLastCalledWith(expect.objectContaining({
        saveSuccess: true,
        saveError: false,
      }));
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
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(authenticated.status).toBe(302);
      expect(authenticated.headers.get('location')).toBe('/activity');
    });
  });

  it('protects dashboard routes and renders canonical Arenas with a basic 404', async () => {
    const { app, arenas, renderAuthenticatedPage } = dependencies();
    vi.mocked(arenas.getByRoute).mockResolvedValueOnce(arena).mockResolvedValueOnce(null);
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/global`, { redirect: 'manual' });
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get('location')).toBe('/');

      const found = await fetch(`${baseUrl}/arena/us/boulder-745`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(found.status).toBe(200);
      expect(renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 'map', location: arena.name, arenaSourceId: arena.sourceId,
      }));
      const missing = await fetch(`${baseUrl}/arena/us/missing-999`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('text/html');
      expect(await missing.text()).toContain('/error-mascot.webp');
      expect(renderAuthenticatedPage).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the Following scope when rendering an Arena', async () => {
    const { app, arenas, renderAuthenticatedPage } = dependencies();
    vi.mocked(arenas.getByRoute).mockResolvedValueOnce(arena);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/arena/us/boulder-745?month=2026-07&view=following`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(200);
      expect(renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'following',
        location: arena.name,
        locationClearHref: '/following?month=2026-07',
        mapModeHrefs: expect.objectContaining({
          following: '/arena/us/boulder-745?month=2026-07&view=following',
          competitive: '/arena/us/boulder-745?month=2026-07',
        }),
      }));
    });
  });

  it('renders map pages as current-month by default and keeps all time explicit', async () => {
    const { app, onboarding, renderAuthenticatedPage } = dependencies();
    await withServer(app, async (baseUrl) => {
      const headers = { cookie: 'glidehero_session=valid-token' };

      expect((await fetch(`${baseUrl}/personal`, { headers })).status).toBe(200);
      expect(renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'personal',
        location: null,
        period: 'current-month',
        navigation: expect.arrayContaining([
          expect.objectContaining({ page: 'map', href: '/personal' }),
        ]),
      }));

      expect((await fetch(`${baseUrl}/global?period=all-time`, { headers })).status).toBe(200);
      expect(renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'competitive',
        location: null,
        period: 'all-time',
        mapModeHrefs: expect.objectContaining({
          following: '/following?period=all-time',
        }),
      }));

      expect((await fetch(`${baseUrl}/following?month=2026-07`, { headers })).status).toBe(200);
      expect(onboarding.markCompetitiveMapViewed).toHaveBeenCalledWith(user.userId);
      expect(renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'following',
        location: null,
        period: 'current-month',
        navigation: expect.arrayContaining([
          expect.objectContaining({ page: 'map', href: '/following?month=2026-07' }),
        ]),
        mapModeHrefs: expect.objectContaining({
          following: '/following?month=2026-07',
        }),
      }));

      expect((await fetch(`${baseUrl}/personal?month=2026-07`, { headers })).status).toBe(200);
      expect(renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'personal',
        period: 'current-month',
        navigation: expect.arrayContaining([
          expect.objectContaining({ page: 'map', href: '/personal?month=2026-07' }),
        ]),
      }));

      expect((await fetch(`${baseUrl}/global?month=2026-07&period=all-time`, { headers })).status).toBe(400);
    });
  });

  it('focuses Launch Arenas without scoping the map data to the launch area', async () => {
    const { app, arenas, renderAuthenticatedPage } = dependencies();
    vi.mocked(arenas.getByRoute).mockResolvedValueOnce({ ...arena, arenaType: 'launch' });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/arena/us/boulder-745`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(200);
      expect(renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 'map', location: arena.name, focusArenaSourceId: arena.sourceId,
      }));
      expect(renderAuthenticatedPage).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ arenaSourceId: arena.sourceId }),
      );
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

  it('searches Arenas and returns fixed-area leaderboard data', async () => {
    const { app, arenas, coverage } = dependencies();
    vi.mocked(arenas.search).mockResolvedValueOnce([arena]);
    vi.mocked(arenas.getBySourceId).mockResolvedValue(arena);
    await withServer(app, async (baseUrl) => {
      const headers = { cookie: 'glidehero_session=valid-token' };
      const search = await fetch(`${baseUrl}/v1/arenas?q=Boulder`, { headers });
      expect(search.status).toBe(200);
      expect(await search.json()).toEqual({ arenas: [arena] });

      const leaderboard = await fetch(`${baseUrl}/v1/arenas/745/competition-leaderboard?month=2026-07`, { headers });
      expect(leaderboard.status).toBe(200);
      expect(coverage.getArenaLeaderboard).toHaveBeenCalledWith({
        competitionMonth: '2026-07', arenaId: arena.id, currentUserId: user.userId,
      });

      const allTimeLeaderboard = await fetch(
        `${baseUrl}/v1/arenas/745/competition-leaderboard`,
        { headers },
      );
      expect(allTimeLeaderboard.status).toBe(200);
      expect(coverage.getArenaLeaderboard).toHaveBeenCalledWith({
        period: 'all-time', arenaId: arena.id, currentUserId: user.userId,
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
      expect(response.headers.get('location')).toBe('/activity?onboardingStep=first-flight');
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
      profiles: {
        updateTerritoryColor: vi.fn(async () => undefined),
        getDashboardAchievementProgress: vi.fn(async () => []),
        getPilotProfile: vi.fn(async () => null),
        getPilotAchievements: vi.fn(async () => null),
      },
      gridClaim: {
        getViewportStats: vi.fn(async () => viewportStats),
        process: vi.fn(async () => ({
          flightId: 'flight-id', cellSize: 1_000, directCellCount: 0, enclosedCellCount: 0,
          newPersonalCellCount: 0, personalCellTotalAfter: 0, progressionVersion: 1,
          evaluatedAt: new Date('2026-07-20T00:00:00Z'),
          arenaAchievements: { newlyEarned: [], alreadyEarned: 0, record: null },
        })),
        reprocess: vi.fn(async () => ({ status: 'not_found' as const })),
      },
      mapGrid: mapGridService(),
      coverage: {
        getGlobalLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null })),
        getArenaLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null })),
      },
      territoryTiles: dependencies().territoryTiles,
      arenas: arenaService(),
      arenaProgress: dependencies().arenaProgress,
      renderPage: createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' }),
      renderAuthenticatedPage: vi.fn(async () => '<html><body>App page</body></html>'),
      renderAuthenticatedActivityFeed: vi.fn(async () => '<div>App feed</div>'),
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

  it('serves the authenticated current pilot profile and passes only the summary to the page', async () => {
    const { app, profiles, renderAuthenticatedPage } = dependencies();
    vi.mocked(profiles.getPilotProfile).mockResolvedValueOnce({ ...pilotProfile, userId: user.userId });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/profile`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });

      expect(response.status).toBe(200);
      expect(profiles.getPilotProfile).toHaveBeenCalledWith(user.userId);
      expect(renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 'profile',
        profile: expect.objectContaining({ displayName: pilotProfile.displayName }),
      }));
    });
    expect(profiles.getPilotAchievements).not.toHaveBeenCalled();
  });

  it('uses the narrow achievements read model without loading the profile read model', async () => {
    const { app, profiles, renderAuthenticatedPage } = dependencies();
    vi.mocked(profiles.getPilotAchievements).mockResolvedValueOnce({
      userId: user.userId,
      displayName: user.displayName,
      achievementCount: 0,
      achievements: [],
      achievementProgress: [],
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/achievements`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(response.status).toBe(200);
      expect(profiles.getPilotAchievements).toHaveBeenCalledWith(user.userId);
      expect(profiles.getPilotProfile).not.toHaveBeenCalled();
      expect(renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({ page: 'achievements' }));
    });
  });

  it('serves a valid authenticated pilot profile without exposing the pilot email', async () => {
    const base = dependencies();
    vi.mocked(base.profiles.getPilotProfile).mockResolvedValueOnce(pilotProfile);
    const router = createWebRouter({
      auth: base.auth,
      cookie: base.cookie,
      profiles: base.profiles,
      gridClaim: base.gridClaim,
      mapGrid: base.mapGrid,
      coverage: base.coverage,
      territoryTiles: base.territoryTiles,
      arenas: base.arenas,
      arenaProgress: base.arenaProgress,
      renderPage: createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' }),
      renderAuthenticatedPage: base.renderAuthenticatedPage,
      renderAuthenticatedActivityFeed: base.renderAuthenticatedActivityFeed,
    });
    const app = createApp({ webMiddleware: [createCurrentUserMiddleware(base.auth, base.cookie), router] });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/pilots/${pilotProfile.userId}`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      await response.text();

      expect(response.status).toBe(200);
      expect(base.renderAuthenticatedPage).toHaveBeenCalledWith(expect.objectContaining({
        page: 'profile',
        profile: expect.objectContaining({ displayName: pilotProfile.displayName }),
      }));
    });
  });

  it('requires authentication and returns normal HTML 404s for invalid or missing pilot profiles', async () => {
    const { app, profiles } = dependencies();
    await withServer(app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/profile`, { redirect: 'manual' });
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get('location')).toBe('/');

      const anonymousPilot = await fetch(`${baseUrl}/pilots/${pilotProfile.userId}`, { redirect: 'manual' });
      expect(anonymousPilot.status).toBe(302);
      expect(anonymousPilot.headers.get('location')).toBe('/');

      const invalid = await fetch(`${baseUrl}/pilots/not-a-uuid`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(invalid.status).toBe(404);
      expect(invalid.headers.get('content-type')).toContain('text/html');
      expect(profiles.getPilotProfile).not.toHaveBeenCalled();

      const missing = await fetch(`${baseUrl}/pilots/${pilotProfile.userId}`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('content-type')).toContain('text/html');
      expect(profiles.getPilotProfile).toHaveBeenCalledWith(pilotProfile.userId);
    });
  });

  it('protects Activity, searches only for a non-empty trimmed query, and renders follow results', async () => {
    const base = dependencies();
    vi.mocked(base.follow.searchPilots).mockResolvedValueOnce([{
      userId: pilotProfile.userId,
      displayName: 'Cloud Dancer',
      isFollowing: true,
    }]);
    await withServer(base.app, async (baseUrl) => {
      const anonymous = await fetch(`${baseUrl}/activity`, { redirect: 'manual' });
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get('location')).toBe('/');

      const empty = await fetch(`${baseUrl}/activity?q=   `, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(empty.status).toBe(200);
      expect(base.follow.searchPilots).not.toHaveBeenCalled();
      expect(base.activity.listFeed).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        limit: 20,
        before: undefined,
        q: '',
        scope: 'following',
      });
      expect(base.activity.getStatistics).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        q: '',
        scope: 'following',
      });

      vi.mocked(base.activity.getStatistics).mockResolvedValueOnce({
        daily: {
          flightCount: 0,
          mostAccomplishments: null,
          mostCells: null,
          greatestFivePointDistance: null,
        },
        monthly: {
          flightCount: 3,
          mostAccomplishments: {
            flightId: pilotProfile.userId,
            value: 2,
            actorUserId: pilotProfile.userId,
            actorDisplayName: pilotProfile.displayName,
            accomplishments: [],
          },
          mostCells: {
            flightId: pilotProfile.userId,
            value: 42,
            actorUserId: pilotProfile.userId,
            actorDisplayName: pilotProfile.displayName,
            accomplishments: [],
          },
          greatestFivePointDistance: {
            flightId: pilotProfile.userId,
            value: 12_345,
            actorUserId: pilotProfile.userId,
            actorDisplayName: pilotProfile.displayName,
            accomplishments: [],
          },
        },
      });
      const search = await fetch(`${baseUrl}/activity?q=%20cloud%20`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(search.status).toBe(200);
      expect(base.follow.searchPilots).toHaveBeenCalledWith({
        viewerUserId: user.userId,
        query: 'cloud',
      });
      expect(base.activity.listFeed).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        limit: 20,
        before: undefined,
        q: 'cloud',
        scope: 'following',
      });
      expect(base.activity.getStatistics).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        q: 'cloud',
        scope: 'following',
      });
      expect(base.renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        page: 'activity',
        activitySearch: 'cloud',
        activityReturnTo: '/activity?q=cloud&scope=following',
        activityScope: 'following',
        activityScopeLinks: {
          following: '/activity?q=cloud&scope=following',
          yours: '/activity?q=cloud&scope=yours',
        },
        activityStats: expect.objectContaining({
          monthly: {
            flightCount: '3',
            mostAccomplishments: expect.objectContaining({
              href: `/flights/${pilotProfile.userId}`,
              value: '2 achievements',
              pilot: expect.objectContaining({ displayName: 'Cloud Dancer' }),
            }),
            mostCells: expect.objectContaining({
              href: `/flights/${pilotProfile.userId}`,
              value: '42 cells',
              pilot: expect.objectContaining({ displayName: 'Cloud Dancer' }),
            }),
            greatestFivePointDistance: expect.objectContaining({
              href: `/flights/${pilotProfile.userId}`,
              value: '12.3 km',
              pilot: expect.objectContaining({ displayName: 'Cloud Dancer' }),
            }),
          },
        }),
        activityPilotResults: [expect.objectContaining({
          userId: pilotProfile.userId,
          displayName: 'Cloud Dancer',
          isFollowing: true,
        })],
      }));
    });
  });

  it('uses the explicit yours Activity scope and does not fetch statistics for feed fragments', async () => {
    const base = dependencies();
    vi.mocked(base.activity.listFeed).mockResolvedValueOnce({ items: [], nextCursor: 'next-cursor' });
    await withServer(base.app, async (baseUrl) => {
      const yours = await fetch(`${baseUrl}/activity?q=cloud&scope=yours`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(yours.status).toBe(200);
      expect(base.activity.listFeed).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        limit: 20,
        before: undefined,
        q: 'cloud',
        scope: 'yours',
      });
      expect(base.activity.getStatistics).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        q: 'cloud',
        scope: 'yours',
      });
      expect(base.renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        activityReturnTo: '/activity?q=cloud&scope=yours',
        activityScope: 'yours',
        activityLoadMoreHref: '/activity?before=next-cursor&q=cloud&scope=yours',
        activityLoadMoreEndpoint: '/activity/feed?before=next-cursor&q=cloud&scope=yours',
      }));

      vi.mocked(base.activity.getStatistics).mockClear();
      const fragment = await fetch(`${baseUrl}/activity/feed?q=cloud&scope=yours`, {
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(fragment.status).toBe(200);
      expect(base.activity.listFeed).toHaveBeenLastCalledWith({
        viewerUserId: user.userId,
        limit: 20,
        before: undefined,
        q: 'cloud',
        scope: 'yours',
      });
      expect(base.activity.getStatistics).not.toHaveBeenCalled();
    });
  });

  it('renders and updates durable onboarding state only for authenticated users', async () => {
    const base = dependencies();
    vi.mocked(base.onboarding.getState).mockResolvedValue({
      dismissed: false,
      completeCount: 1,
      totalCount: 7,
      coreComplete: false,
      allComplete: false,
      shouldPoll: false,
      firstFlightId: null,
      firstFlightStatus: 'not-started',
      historyStatus: 'not-started',
      steps: { profile: true, 'first-flight': false, 'personal-map': false, 'follow-pilots': false, 'competitive-map': false, glider: false, history: false },
    });
    await withServer(base.app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/v1/onboarding/status`)).status).toBe(401);

      const headers = { cookie: 'glidehero_session=valid-token' };
      const activityResponse = await fetch(`${baseUrl}/activity?onboardingStep=history&onboardingDismissed=1`, { headers });
      expect(activityResponse.status).toBe(200);
      expect(base.renderAuthenticatedPage).toHaveBeenLastCalledWith(expect.objectContaining({
        onboarding: expect.objectContaining({
          completeCount: 1,
          selectedStep: expect.objectContaining({ key: 'history', uploadMode: 'history' }),
        }),
        onboardingDismissedNotice: false,
      }));

      const status = await fetch(`${baseUrl}/v1/onboarding/status`, { headers });
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({ onboarding: expect.objectContaining({ completeCount: 1, firstFlightComplete: false }) });

      const dismissed = await fetch(`${baseUrl}/onboarding/dismiss`, { method: 'POST', headers: { ...headers, accept: 'application/json' } });
      expect(dismissed.status).toBe(200);
      expect(await dismissed.json()).toEqual({ dismissed: true });
      expect(base.onboarding.dismiss).toHaveBeenCalledWith(user.userId);

      const restored = await fetch(`${baseUrl}/onboarding/restore`, { method: 'POST', redirect: 'manual', headers });
      expect(restored.status).toBe(303);
      expect(restored.headers.get('location')).toBe('/activity');
      expect(base.onboarding.restore).toHaveBeenCalledWith(user.userId);

      const mapViewed = await fetch(`${baseUrl}/onboarding/personal-map-viewed`, { method: 'POST', headers });
      expect(mapViewed.status).toBe(204);
      expect(base.onboarding.markPersonalMapViewed).toHaveBeenCalledWith(user.userId);
    });
  });

  it('toggles Like as JSON or redirects for HTML, with authenticated error mapping', async () => {
    const base = dependencies();
    await withServer(base.app, async (baseUrl) => {
      const json = await fetch(`${baseUrl}/activities/${pilotProfile.userId}/like`, {
        method: 'POST',
        headers: { cookie: 'glidehero_session=valid-token', accept: 'application/json' },
      });
      expect(json.status).toBe(200);
      expect(await json.json()).toEqual({ reacted: true, totalCount: 1 });
      expect(base.activity.toggleLike).toHaveBeenCalledWith({ viewerUserId: user.userId, activityId: pilotProfile.userId });

      const html = await fetch(`${baseUrl}/activities/${pilotProfile.userId}/like`, {
        method: 'POST', redirect: 'manual', headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(html.status).toBe(303);
      expect(html.headers.get('location')).toBe('/activity');

      vi.mocked(base.activity.toggleLike).mockRejectedValueOnce(new ActivityNotFoundError());
      const missing = await fetch(`${baseUrl}/activities/${pilotProfile.userId}/like`, {
        method: 'POST', headers: { cookie: 'glidehero_session=valid-token', accept: 'application/json' },
      });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'Activity not found.' } });

      vi.mocked(base.activity.toggleLike).mockRejectedValueOnce(new SelfLikeError());
      const self = await fetch(`${baseUrl}/activities/${pilotProfile.userId}/like`, {
        method: 'POST', headers: { cookie: 'glidehero_session=valid-token', accept: 'application/json' },
      });
      expect(self.status).toBe(403);
      expect(await self.json()).toEqual({ error: { code: 'forbidden', message: 'You cannot send a Like to your own activity.' } });
    });
  });

  it('calls follow actions, rejects self or invalid IDs, and constrains returnTo redirects', async () => {
    const base = dependencies();
    await withServer(base.app, async (baseUrl) => {
      const target = pilotProfile.userId;
      const followed = await fetch(`${baseUrl}/pilots/${target}/follow`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: 'glidehero_session=valid-token',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ returnTo: 'https://evil.example/fake' }),
      });
      expect(followed.status).toBe(303);
      expect(followed.headers.get('location')).toBe(`/pilots/${target}`);
      expect(base.follow.follow).toHaveBeenCalledWith({ followerUserId: user.userId, followedUserId: target });

      const unfollowed = await fetch(`${baseUrl}/pilots/${target}/unfollow`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie: 'glidehero_session=valid-token',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ returnTo: '/activity?q=cloud' }),
      });
      expect(unfollowed.status).toBe(303);
      expect(unfollowed.headers.get('location')).toBe('/activity?q=cloud');
      expect(base.follow.unfollow).toHaveBeenCalledWith({ followerUserId: user.userId, followedUserId: target });

      const self = await fetch(`${baseUrl}/pilots/${user.userId}/follow`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(self.status).toBe(400);

      const invalid = await fetch(`${baseUrl}/pilots/not-a-uuid/follow`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(invalid.status).toBe(400);
      expect(base.follow.follow).toHaveBeenCalledTimes(1);

      vi.mocked(base.follow.follow).mockRejectedValueOnce(new PilotNotFoundError());
      const missing = await fetch(`${baseUrl}/pilots/00000000-0000-4000-8000-000000000404/follow`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: 'glidehero_session=valid-token' },
      });
      expect(missing.status).toBe(404);
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

  it('returns personal stats for an authenticated viewport request', async () => {
    const { app, gridClaim } = dependencies();
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/personal-stats?month=2026-07&west=-107&south=39&east=-105&north=41`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(viewportStats);
      expect(gridClaim.getViewportStats).toHaveBeenCalledWith({
        userId: user.userId,
        period: { competitionMonth: '2026-07' },
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

  it('serves authenticated Personal and Competition MVT tiles with private one-minute caching', async () => {
    const { app, territoryTiles, arenas } = dependencies();
    vi.mocked(arenas.getBySourceId).mockResolvedValueOnce(arena);
    vi.mocked(territoryTiles.getPersonalTile).mockResolvedValueOnce({
      data: Buffer.from([1, 2, 3]), featureCount: 1,
    });
    vi.mocked(territoryTiles.getGlobalCompetitionTile).mockResolvedValueOnce({
      data: Buffer.alloc(0), featureCount: 0,
    });
    vi.mocked(territoryTiles.getArenaCompetitionTile).mockResolvedValueOnce({
      data: Buffer.from([4]), featureCount: 1,
    });
    await withServer(app, async (baseUrl) => {
      const headers = { cookie: 'glidehero_session=valid-token' };
      const personal = await fetch(`${baseUrl}/v1/personal-territory/tiles/4/8/7.mvt?month=2026-07`, { headers });
      expect(personal.status).toBe(200);
      expect(personal.headers.get('content-type')).toContain('application/vnd.mapbox-vector-tile');
      expect(personal.headers.get('cache-control')).toBe('private, max-age=60');
      expect(personal.headers.get('vary')).toBe('Cookie');
      expect(Buffer.from(await personal.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
      expect(territoryTiles.getPersonalTile).toHaveBeenCalledWith({
        z: 4, x: 8, y: 7, userId: user.userId,
        period: { competitionMonth: '2026-07' },
      });

      const global = await fetch(
        `${baseUrl}/v1/competition-territory/tiles/4/8/7.mvt?month=2026-07&pilot=${user.userId}`,
        { headers },
      );
      expect(global.status).toBe(200);
      expect(global.headers.get('cache-control')).toBe('private, max-age=60');
      expect(global.headers.get('vary')).toBeNull();
      expect((await global.arrayBuffer()).byteLength).toBe(0);
      expect(territoryTiles.getGlobalCompetitionTile).toHaveBeenCalledWith({
        z: 4, x: 8, y: 7,
        period: { competitionMonth: '2026-07' },
        pilotUserId: user.userId,
      });

      const following = await fetch(
        `${baseUrl}/v1/competition-territory/tiles/4/8/7.mvt?month=2026-07&scope=following`,
        { headers },
      );
      expect(following.status).toBe(200);
      expect(following.headers.get('vary')).toBe('Cookie');
      expect(territoryTiles.getGlobalCompetitionTile).toHaveBeenLastCalledWith({
        z: 4, x: 8, y: 7,
        period: { competitionMonth: '2026-07' },
        currentUserId: user.userId,
        scope: 'following',
      });

      const arenaResponse = await fetch(`${baseUrl}/v1/arenas/745/competition-territory/tiles/14/8192/8191.mvt`, { headers });
      expect(arenaResponse.status).toBe(200);
      expect(arenaResponse.headers.get('vary')).toBeNull();
      expect(territoryTiles.getArenaCompetitionTile).toHaveBeenCalledWith({
        z: 14, x: 8192, y: 8191,
        arenaId: arena.id,
        period: { period: 'all-time' },
      });
    });
  });

  it('does not expose the removed territory GeoJSON endpoints', async () => {
    const { app } = dependencies();
    await withServer(app, async (baseUrl) => {
      const headers = { cookie: 'glidehero_session=valid-token' };
      for (const path of [
        '/v1/personal-territory',
        '/v1/competition-territory',
        '/v1/arenas/745/competition-territory',
      ]) {
        expect((await fetch(`${baseUrl}${path}`, { headers })).status).toBe(404);
      }
    });
  });

  it('validates authentication, route-specific zooms, XYZ ranges, tile query values, and Arenas', async () => {
    const { app, territoryTiles } = dependencies();
    await withServer(app, async (baseUrl) => {
      const headers = { cookie: 'glidehero_session=valid-token' };
      for (const path of [
        '/v1/personal-territory/tiles/4/8/7.mvt',
        '/v1/competition-territory/tiles/4/8/7.mvt',
        '/v1/arenas/745/competition-territory/tiles/4/8/7.mvt',
      ]) {
        expect((await fetch(`${baseUrl}${path}`)).status).toBe(401);
      }
      for (const path of [
        '/v1/personal-territory/tiles/3/0/0.mvt',
        '/v1/personal-territory/tiles/4/16/0.mvt',
        `/v1/personal-territory/tiles/4/8/7.mvt?user=${user.userId}`,
        '/v1/competition-territory/tiles/3/0/0.mvt',
        '/v1/competition-territory/tiles/4/16/0.mvt',
        '/v1/competition-territory/tiles/4/8/7.mvt?month=2026-13',
        '/v1/competition-territory/tiles/4/8/7.mvt?pilot=not-a-uuid',
      ]) {
        expect((await fetch(`${baseUrl}${path}`, { headers })).status).toBe(400);
      }
      expect((await fetch(
        `${baseUrl}/v1/arenas/999/competition-territory/tiles/4/8/7.mvt`,
        { headers },
      )).status).toBe(404);
    });
    expect(territoryTiles.getPersonalTile).not.toHaveBeenCalled();
    expect(territoryTiles.getGlobalCompetitionTile).not.toHaveBeenCalled();
    expect(territoryTiles.getArenaCompetitionTile).not.toHaveBeenCalled();
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

  it('returns Personal and Competition tracks for a selected exact cell', async () => {
    const { app, cellFlightTracks } = dependencies();
    const headers = { cookie: 'glidehero_session=valid-token' };
    await withServer(app, async (baseUrl) => {
      const personal = await fetch(`${baseUrl}/v1/personal-cells/-1/2/tracks?month=2026-07`, { headers });
      expect(personal.status).toBe(200);
      expect(personal.headers.get('content-type')).toContain('application/geo+json');
      expect((await personal.json() as CellFlightTrackResult).cell.properties.cellId).toBe('1000:1:2');
      expect(cellFlightTracks.getPersonal).toHaveBeenCalledWith({
        x: -1,
        y: 2,
        userId: user.userId,
        period: { competitionMonth: '2026-07' },
      });

      const competition = await fetch(
        `${baseUrl}/v1/competition-cells/1/2/tracks?pilot=${user.userId}`,
        { headers },
      );
      expect(competition.status).toBe(200);
      expect(cellFlightTracks.getCompetition).toHaveBeenCalledWith({
        x: 1,
        y: 2,
        period: { period: 'all-time' },
        pilotUserId: user.userId,
        currentUserId: user.userId,
      });
    });
  });

  it('rejects invalid and anonymous selected-cell track requests without querying tracks', async () => {
    const { app, cellFlightTracks } = dependencies();
    await withServer(app, async (baseUrl) => {
      const invalid = await fetch(
        `${baseUrl}/v1/competition-cells/1/2/tracks?month=July`,
        { headers: { cookie: 'glidehero_session=valid-token' } },
      );
      expect(invalid.status).toBe(400);

      const anonymous = await fetch(`${baseUrl}/v1/personal-cells/1/2/tracks`);
      expect(anonymous.status).toBe(401);
      expect(cellFlightTracks.getPersonal).not.toHaveBeenCalled();
      expect(cellFlightTracks.getCompetition).not.toHaveBeenCalled();
    });
  });

  it('validates map replay bounds/month and forwards the signed-in pilot', async () => {
    const base = dependencies();
    await withServer(base.app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/v1/map-replay?month=2026-13&mode=personal&west=-105&south=39&east=-104&north=40`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/map-replay?month=0000-01&mode=personal&west=-105&south=39&east=-104&north=40`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/map-replay?month=2026-07&mode=bad&west=-105&south=39&east=-104&north=40`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/map-replay?month=2026-07&mode=personal&west=-105&south=39&east=-105&north=40`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(400);
      expect((await fetch(`${baseUrl}/v1/map-replay?month=2026-07&mode=personal&west=-105&south=39&east=-104&north=40`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(200);
      expect(base.mapReplay.getReplay).toHaveBeenCalledWith({ month: '2026-07', mode: 'personal', west: -105, south: 39, east: -104, north: 40, userId: user.userId });
      expect((await fetch(`${baseUrl}/v1/map-replay?month=2026-07&mode=competitive&west=170&south=-10&east=-170&north=10`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/v1/map-replay?month=2026-07&mode=following&west=-105&south=39&east=-104&north=40`, { headers: { cookie: 'glidehero_session=valid-token' } })).status).toBe(200);
      expect(base.mapReplay.getReplay).toHaveBeenLastCalledWith({ month: '2026-07', mode: 'following', west: -105, south: 39, east: -104, north: 40, userId: user.userId });
    });
  });

});
