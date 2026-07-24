import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import { AppError } from '../domain/errors.js';
import { AuthFailure, type AuthenticatedUser, type AuthService } from '../services/authService.js';
import type { MonthlyCoveragePeriod, MonthlyCoverageService } from '../services/monthlyCoverageService.js';
import type { MapGridService } from '../services/mapGridService.js';
import { normalizeTerritoryColor, type ProfileService } from '../services/profileService.js';
import type { GridClaimService } from '../services/gridClaimService.js';
import type { AdminFlightService } from '../services/adminFlightService.js';
import type { ArenaService } from '../services/arenaService.js';
import type { ArenaProgressService } from '../services/arenaProgressService.js';
import type { PageModel, PageRenderer } from '../views/renderer.js';
import type {
  AdminFlightProcessingPageRenderer,
  AdminMapSettingsPageRenderer,
  AdminPageRenderer,
} from '../views/admin/renderer.js';
import type { AuthenticatedActivityFeedRenderer, AuthenticatedPageRenderer } from '../views/authenticated/renderer.js';
import { createAuthenticatedShellModel } from '../views/authenticated/adapters/shellModel.js';
import { activityFeedToViews, activityPilotResultToView, activityStatsToView } from '../views/authenticated/adapters/activityView.js';
import { createAchievementsPageModel } from '../views/authenticated/adapters/achievementView.js';
import { pilotProfileToView } from '../views/authenticated/adapters/profileView.js';
import { createMapPageModel } from '../views/authenticated/adapters/mapView.js';
import type { AuthenticatedPageModel } from '../views/authenticated/models.js';
import type { FlightUploadQueueService } from '../services/flightUploadQueueService.js';
import type { FailedFlightCleanupService } from '../services/failedFlightCleanupService.js';
import type { TerritoryTileService } from '../services/territoryTileService.js';
import {
  createTerritoryTileSettingsService,
  MAXIMUM_TERRITORY_TILE_ZOOM,
  MINIMUM_TERRITORY_TILE_ZOOM,
  type TerritoryTileSettingsService,
} from '../services/territoryTileSettingsService.js';
import type { SessionCookie } from './sessionCookie.js';
import { PilotNotFoundError, type FollowService } from '../services/followService.js';
import type { ActivityService, ActivityStatistics } from '../services/activityService.js';
import { ActivityCursorError, ActivityNotFoundError, SelfLikeError } from '../services/activityService.js';
import type { FlightThumbnailDeliveryService } from '../services/flightThumbnailDeliveryService.js';
import { WORKER_STATUS_TTL_SECONDS, type WorkerControlService } from '../services/workerControlService.js';
import type { FlightProcessingControlService } from '../services/flightProcessingControlService.js';
import type { FlightDetailService } from '../services/flightDetailService.js';
import { createFlightMapPayload, createFlightPageView } from '../views/authenticated/adapters/flightDetailView.js';
import type { CellFlightTrackService } from '../services/cellFlightTrackService.js';
import type { MapReplayService } from '../services/mapReplayService.js';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(3).max(128);
const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(48).optional().or(z.literal('')),
});
const loginSchema = z.object({ email, password });
const competitionMonthValue = z.string().refine((value) => {
  try {
    normalizeCompetitionLeaderboardMonth(value);
    return true;
  } catch {
    return false;
  }
});
const competitionMonthSchema = z.object({ month: competitionMonthValue.optional(), scope: z.literal('following').optional() }).strict();
const personalPeriodSchema = z.object({ month: competitionMonthValue.optional() }).strict();
const pilotUserIdSchema = z.string().uuid();
const activityQuerySchema = z.object({
  q: z.string().max(100).optional(),
  before: z.string().min(1).optional(),
  scope: z.enum(['following', 'yours']).optional(),
}).strict();
const emptyActivityStatistics: ActivityStatistics = {
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
};
const finiteCoordinate = z.string().refine(
  (value) => value.length > 0 && value.trim() === value && Number.isFinite(Number(value)),
).transform(Number);
const viewportBoundsShape = {
  west: finiteCoordinate.refine((value) => value >= -180 && value <= 180),
  south: finiteCoordinate.refine((value) => value >= -90 && value <= 90),
  east: finiteCoordinate.refine((value) => value >= -180 && value <= 180),
  north: finiteCoordinate.refine((value) => value >= -90 && value <= 90),
};
const viewportBoundsSchema = z.object(viewportBoundsShape)
  .strict()
  .refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);
const competitionLeaderboardSchema = z.object({
  month: competitionMonthValue.optional(),
  scope: z.literal('following').optional(),
  ...viewportBoundsShape,
}).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);
const arenaSearchSchema = z.object({ q: z.string().trim().min(1).max(100) }).strict();
const arenaSourceIdSchema = z.coerce.number().int().positive().safe();
const cellCoordinateSchema = z.coerce.number().int().safe();
const tileQuerySchema = z.object({
  month: competitionMonthValue.optional(),
  pilot: z.string().uuid().optional(),
  scope: z.literal('following').optional(),
}).strict();
const territoryTileZoomSchema = z.string().trim().regex(/^\d+$/).transform(Number)
  .pipe(z.number().int().min(MINIMUM_TERRITORY_TILE_ZOOM).max(MAXIMUM_TERRITORY_TILE_ZOOM));
const territoryTileSettingsSchema = z.object({
  personalMinimumZoom: territoryTileZoomSchema,
  personalMaximumZoom: territoryTileZoomSchema,
  competitionMinimumZoom: territoryTileZoomSchema,
  competitionMaximumZoom: territoryTileZoomSchema,
}).strict()
  .refine((settings) => settings.personalMinimumZoom <= settings.personalMaximumZoom)
  .refine((settings) => settings.competitionMinimumZoom <= settings.competitionMaximumZoom);

function territoryTileCoordinates(
  zoom: { minimumZoom: number; maximumZoom: number },
  params: Record<string, string>,
) {
  const parsed = z.object({
    z: z.coerce.number().int().min(zoom.minimumZoom).max(zoom.maximumZoom),
    x: z.coerce.number().int().min(0),
    y: z.coerce.number().int().min(0),
  }).safeParse(params);
  if (!parsed.success) return null;
  const tileCount = 2 ** parsed.data.z;
  return parsed.data.x < tileCount && parsed.data.y < tileCount ? parsed.data : null;
}

function coveragePeriod(month?: string): MonthlyCoveragePeriod {
  return month ? { competitionMonth: month } : { period: 'all-time' };
}

function mapPagePeriod(query: Request['query']): {
  period: 'all-time' | 'current-month';
  month?: string;
  suffix: string;
} {
  const rawMonth = query.month;
  const rawPeriod = query.period;
  if (
    (rawMonth !== undefined && typeof rawMonth !== 'string')
    || (rawPeriod !== undefined && rawPeriod !== 'all-time')
    || (rawMonth !== undefined && rawPeriod !== undefined)
  ) {
    throw new AppError(400, 'invalid_request', 'Map period is invalid.');
  }
  if (typeof rawMonth === 'string') {
    normalizeCompetitionLeaderboardMonth(rawMonth);
    return {
      period: 'current-month',
      month: rawMonth,
      suffix: `?month=${encodeURIComponent(rawMonth)}`,
    };
  }
  if (rawPeriod === 'all-time') {
    return { period: 'all-time', suffix: '?period=all-time' };
  }
  return { period: 'current-month', suffix: '' };
}

const uploadIntentSchema = z.object({
  originalFilename: z.string().min(1).max(255),
  contentType: z.string().max(255).default('application/octet-stream'),
  byteSize: z.number().int().positive(),
}).strict();

function formBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

async function render(res: Response, renderPage: PageRenderer, status: number, model: PageModel) {
  res.status(status).type('html').send(await renderPage(model));
}

async function renderAuthenticated(res: Response, renderPage: AuthenticatedPageRenderer, status: number, model: AuthenticatedPageModel) {
  res.status(status).type('html').send(await renderPage(model));
}

export function createWebRouter(dependencies: {
  auth: AuthService;
  cookie: SessionCookie;
  uploadQueue?: FlightUploadQueueService;
  failedFlightCleanup?: FailedFlightCleanupService;
  profiles: ProfileService;
  follow?: FollowService;
  activity?: ActivityService;
  gridClaim: GridClaimService;
  mapGrid: MapGridService;
  coverage: MonthlyCoverageService;
  territoryTiles: TerritoryTileService;
  arenas: ArenaService;
  arenaProgress: ArenaProgressService;
  renderPage: PageRenderer;
  renderAuthenticatedPage: AuthenticatedPageRenderer;
  renderAuthenticatedActivityFeed: AuthenticatedActivityFeedRenderer;
  mapTilerStyleUrl?: string;
  adminEmails?: readonly string[];
  adminFlights?: AdminFlightService;
  workerControl?: WorkerControlService;
  flightProcessingControl?: FlightProcessingControlService;
  renderAdminPage?: AdminPageRenderer;
  renderAdminFlightProcessingPage?: AdminFlightProcessingPageRenderer;
  territoryTileSettings?: TerritoryTileSettingsService;
  renderAdminMapSettingsPage?: AdminMapSettingsPageRenderer;
  thumbnailDelivery?: FlightThumbnailDeliveryService;
  flightDetail?: FlightDetailService;
  cellFlightTracks?: CellFlightTrackService;
  mapReplay?: MapReplayService;
}) {
  const router = Router();
  const territoryTileSettings = dependencies.territoryTileSettings ?? createTerritoryTileSettingsService();
  const adminEmails = new Set((dependencies.adminEmails ?? []).map((email) => email.trim().toLowerCase()));
  const isAdmin = (email: string) => adminEmails.has(email.trim().toLowerCase());

  function sendTerritoryTile(res: Response, tile: { data: Buffer }) {
    res.status(200)
      .type('application/vnd.mapbox-vector-tile')
      .set('Cache-Control', 'private, max-age=60')
      .send(tile.data);
  }

  function dashboardReturnTo(value: unknown): string {
    if (typeof value !== 'string') return '/global';
    try {
      const url = new URL(value, 'http://glidehero.local');
      if (url.origin !== 'http://glidehero.local') return '/global';
      const validPath = url.pathname === '/global'
        || url.pathname === '/personal'
        || /^\/arena\/[a-z]{2}\/[a-z0-9-]+-\d+$/.test(url.pathname);
      if (!validPath) return '/global';
      const month = url.searchParams.get('month');
      const period = url.searchParams.get('period');
      if (month && period) return '/global';
      const params = new URLSearchParams();
      if (month) {
        normalizeCompetitionLeaderboardMonth(month);
        params.set('month', month);
      } else if (period === 'all-time') {
        params.set('period', period);
      } else if (period) {
        return '/global';
      }
      for (const name of ['lat', 'lng', 'zoom']) {
        const value = url.searchParams.get(name);
        if (value) params.set(name, value);
      }
      return params.size > 0 ? `${url.pathname}?${params}` : url.pathname;
    } catch {
      return '/global';
    }
  }

  function dashboardSuccessRedirect(value: unknown, parameter: string): string {
    const url = new URL(dashboardReturnTo(value), 'http://glidehero.local');
    url.searchParams.set(parameter, 'success');
    return `${url.pathname}?${url.searchParams}`;
  }

  function followReturnTo(value: unknown, fallback: string): string {
    if (typeof value !== 'string') return fallback;
    try {
      const url = new URL(value, 'http://glidehero.local');
      if (url.origin !== 'http://glidehero.local') return fallback;
      if (url.pathname === '/activity') {
        const q = url.searchParams.get('q');
        const scope = url.searchParams.get('scope');
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (scope === 'following' || scope === 'yours') params.set('scope', scope);
        return params.toString() ? `/activity?${params}` : '/activity';
      }
      if (url.pathname === '/profile' || /^\/pilots\/[0-9a-f-]{36}$/i.test(url.pathname)) return url.pathname;
    } catch {
      // Use the known local fallback below.
    }
    return fallback;
  }

  function hasAdminAccess(currentUser: AuthenticatedUser | null): boolean {
    return Boolean(currentUser && isAdmin(currentUser.email));
  }

  function authenticatedShell(page: 'map' | 'activity' | 'achievements' | 'profile' | 'flight', currentUser: AuthenticatedUser, options: { mapHref?: string; showFooter?: boolean } = {}) {
    return createAuthenticatedShellModel({
      page,
      user: currentUser,
      isAdmin: isAdmin(currentUser.email),
      mapHref: options.mapHref,
      showFooter: options.showFooter,
    });
  }

  function productionMap(currentUser: AuthenticatedUser, input: Omit<Parameters<typeof createMapPageModel>[1], 'currentUserId' | 'territoryColor' | 'mapStyleUrl' | 'territoryTileMinimumZoom' | 'territoryTileMaximumZoom'>, options: { mapHref?: string; showFooter?: boolean } = {}) {
    const settings = territoryTileSettings.get();
    const isArenaMap = input.arenaSourceId !== undefined || input.focusArenaSourceId !== undefined;
    const currentMapUrl = new URL(input.mapHref, 'http://glidehero.local');
    const personalMapUrl = new URL('/personal', currentMapUrl);
    const followingMapUrl = new URL(isArenaMap ? input.mapHref : '/following', currentMapUrl);
    const competitiveMapUrl = new URL(isArenaMap ? input.mapHref : '/global', currentMapUrl);
    if (!isArenaMap) {
      personalMapUrl.search = currentMapUrl.search;
      followingMapUrl.search = currentMapUrl.search;
      competitiveMapUrl.search = currentMapUrl.search;
    }
    if (isArenaMap) followingMapUrl.searchParams.set('view', 'following');
    else followingMapUrl.searchParams.delete('view');
    competitiveMapUrl.searchParams.delete('view');
    return createMapPageModel(
      authenticatedShell('map', currentUser, { mapHref: options.mapHref ?? input.mapHref, showFooter: options.showFooter ?? false }),
      {
        ...input,
        mapModeHrefs: {
          personal: `${personalMapUrl.pathname}${personalMapUrl.search}`,
          following: `${followingMapUrl.pathname}${followingMapUrl.search}`,
          competitive: `${competitiveMapUrl.pathname}${competitiveMapUrl.search}`,
        },
        currentUserId: currentUser.userId,
        territoryColor: normalizeTerritoryColor(currentUser.territoryColor) ?? '#1769AA',
        mapStyleUrl: dependencies.mapTilerStyleUrl,
        territoryTileMinimumZoom: input.mode === 'personal' ? settings.personal.minimumZoom : settings.competition.minimumZoom,
        territoryTileMaximumZoom: input.mode === 'personal' ? settings.personal.maximumZoom : settings.competition.maximumZoom,
      },
    );
  }

  router.post('/v1/igc-uploads/intents', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before uploading an IGC file.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    const input = uploadIntentSchema.safeParse(req.body);
    if (!input.success) {
      next(new AppError(422, 'invalid_request', 'Choose a valid IGC file of 10 MB or less.'));
      return;
    }
    try {
      res.status(201).json(await dependencies.uploadQueue.createIntent({ userId: currentUser.userId, ...input.data }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/v1/igc-uploads/:uploadId/complete', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before uploading an IGC file.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    if (!z.string().uuid().safeParse(req.params.uploadId).success) {
      next(new AppError(400, 'invalid_request', 'Upload ID is invalid.'));
      return;
    }
    try {
      await dependencies.uploadQueue.complete({ userId: currentUser.userId, id: req.params.uploadId });
      res.status(202).json({ status: 'queued' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/v1/igc-uploads/:uploadId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before managing an IGC upload.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    if (!z.string().uuid().safeParse(req.params.uploadId).success) {
      next(new AppError(400, 'invalid_request', 'Upload ID is invalid.'));
      return;
    }
    try {
      const removed = await dependencies.uploadQueue.cancel({ userId: currentUser.userId, id: req.params.uploadId });
      res.status(200).json({ removed });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/igc-upload-progress', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view upload progress.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    try {
      res.status(200).json(await dependencies.uploadQueue.progress(currentUser.userId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/igc-upload-jobs', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view upload details.'));
      return;
    }
    if (!dependencies.uploadQueue) throw new Error('Upload queue is not configured.');
    const page = z.coerce.number().int().min(1).catch(1).parse(req.query.page);
    try {
      res.status(200).json(await dependencies.uploadQueue.listJobs(currentUser.userId, { page, pageSize: 100 }));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/v1/igc-upload-failures', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to clear failed uploads.'));
      return;
    }
    if (!dependencies.failedFlightCleanup) throw new Error('Failed-flight cleanup is not configured.');
    try {
      res.status(200).json({ cleared: await dependencies.failedFlightCleanup.clearForUser(currentUser.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/personal-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view your personal territory.'));
      return;
    }
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().personal, req.params);
    const period = personalPeriodSchema.safeParse(req.query);
    if (!coordinates || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Personal territory tile coordinates are invalid.' } });
      return;
    }
    try {
      const tile = await dependencies.territoryTiles.getPersonalTile({
        ...coordinates,
        userId: currentUser.userId,
        period: coveragePeriod(period.data.month),
      });
      res.vary('Cookie');
      sendTerritoryTile(res, tile);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/personal-stats', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view your personal stats.'));
      return;
    }

    const viewport = z.object({
      month: competitionMonthValue.optional(),
      ...viewportBoundsShape,
    }).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east)
      .safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Personal stats require valid viewport bounds.' },
      });
      return;
    }

    try {
      const stats = await dependencies.gridClaim.getViewportStats({
        userId: currentUser.userId,
        west: viewport.data.west,
        south: viewport.data.south,
        east: viewport.data.east,
        north: viewport.data.north,
        period: coveragePeriod(viewport.data.month),
      });
      res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/grid', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view the map grid.'));
      return;
    }
    const viewport = viewportBoundsSchema.safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Grid requires valid viewport bounds.' },
      });
      return;
    }
    try {
      const result = await dependencies.mapGrid.getViewport(viewport.data);
      if (result.status === 'too_large') {
        res.status(422).json({
          error: { code: 'grid_viewport_too_large', message: 'Zoom in to view grid.' },
        });
        return;
      }
      res.status(200).type('application/geo+json').send(result.geojson);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/map-replay', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) return next(new AppError(401, 'unauthorized', 'Sign in before viewing map replay.'));
    const parsed = z.object({ month: competitionMonthValue, mode: z.enum(['personal','competitive','following']), west: z.coerce.number().finite(), south: z.coerce.number().finite(), east: z.coerce.number().finite(), north: z.coerce.number().finite() }).safeParse(req.query);
    if (!parsed.success || parsed.data.south < -90 || parsed.data.north > 90 || parsed.data.south >= parsed.data.north || parsed.data.west < -180 || parsed.data.west > 180 || parsed.data.east < -180 || parsed.data.east > 180 || parsed.data.west === parsed.data.east) return res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid map replay parameters.' } });
    if (!dependencies.mapReplay) throw new Error('Map replay service is not configured.');
    try { res.json(await dependencies.mapReplay.getReplay({ ...parsed.data, userId: currentUser.userId })); } catch (error) { next(error); }
  });

  router.get('/v1/competition-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view competition territory.'));
      return;
    }
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().competition, req.params);
    const query = tileQuerySchema.safeParse(req.query);
    if (!coordinates || !query.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Competition territory tile request is invalid.' } });
      return;
    }
    try {
      if (query.data.scope === 'following') res.vary('Cookie');
      sendTerritoryTile(res, await dependencies.territoryTiles.getGlobalCompetitionTile({
        ...coordinates,
        period: coveragePeriod(query.data.month),
        ...(query.data.scope ? { currentUserId: res.locals.currentUser.userId } : {}),
        ...(query.data.scope ? { scope: query.data.scope } : {}),
        ...(query.data.pilot ? { pilotUserId: query.data.pilot } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/competition-leaderboard', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view the competition leaderboard.'));
      return;
    }

    const viewport = competitionLeaderboardSchema.safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Competition leaderboard requires a valid YYYY-MM month and viewport bounds.' },
      });
      return;
    }

    try {
      const leaderboard = await dependencies.coverage.getGlobalLeaderboard({
        ...coveragePeriod(viewport.data.month),
        west: viewport.data.west,
        south: viewport.data.south,
        east: viewport.data.east,
        north: viewport.data.north,
        currentUserId: currentUser.userId,
        ...(viewport.data.scope ? { scope: viewport.data.scope } : {}),
      });
      res.status(200).json(leaderboard);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to search Arenas.'));
      return;
    }
    const input = arenaSearchSchema.safeParse(req.query);
    if (!input.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena search requires a query.' } });
      return;
    }
    try {
      res.status(200).json({ arenas: await dependencies.arenas.search(input.data.q) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/boundary', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view an Arena.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    if (!sourceId.success) {
      res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      res.status(200).type('application/geo+json').send(arena.boundary);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/grid', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view an Arena grid.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const viewport = viewportBoundsSchema.safeParse(req.query);
    if (!sourceId.success || !viewport.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena grid requires a valid Arena and viewport bounds.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      const grid = await dependencies.mapGrid.getArena({ arenaId: arena.id, ...viewport.data });
      if (grid.status === 'too_large') {
        res.status(422).json({ error: { code: 'grid_viewport_too_large', message: 'Zoom in to view grid.' } });
        return;
      }
      res.status(200).type('application/geo+json').send(grid.geojson);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/competition-territory/tiles/:z/:x/:y.mvt', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view Arena territory.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const coordinates = territoryTileCoordinates(territoryTileSettings.get().competition, req.params);
    const query = tileQuerySchema.safeParse(req.query);
    if (!sourceId.success || !coordinates || !query.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena territory tile request is invalid.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      if (query.data.scope === 'following') res.vary('Cookie');
      sendTerritoryTile(res, await dependencies.territoryTiles.getArenaCompetitionTile({
        ...coordinates,
        arenaId: arena.id,
        period: coveragePeriod(query.data.month),
        ...(query.data.scope ? { currentUserId: currentUser.userId } : {}),
        ...(query.data.scope ? { scope: query.data.scope } : {}),
        ...(query.data.pilot ? { pilotUserId: query.data.pilot } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/arenas/:sourceId/competition-leaderboard', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view the Arena leaderboard.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const period = competitionMonthSchema.safeParse(req.query);
    if (!sourceId.success || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena leaderboard requires a valid Arena and YYYY-MM month.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      res.status(200).json(await dependencies.coverage.getArenaLeaderboard({
        ...coveragePeriod(period.data.month),
        arenaId: arena.id,
        currentUserId: currentUser.userId,
        ...(period.data.scope ? { scope: period.data.scope } : {}),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/personal-cells/:x/:y/tracks', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view cell flight tracks.'));
      return;
    }
    const x = cellCoordinateSchema.safeParse(req.params.x);
    const y = cellCoordinateSchema.safeParse(req.params.y);
    const period = personalPeriodSchema.safeParse(req.query);
    if (!x.success || !y.success || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Cell flight tracks require valid coordinates and an optional YYYY-MM month.' } });
      return;
    }
    if (!dependencies.cellFlightTracks) throw new Error('Cell flight-track service is not configured.');
    try {
      const tracks = await dependencies.cellFlightTracks.getPersonal({
        x: x.data,
        y: y.data,
        userId: currentUser.userId,
        period: coveragePeriod(period.data.month),
      });
      res.status(200).type('application/geo+json').send(tracks);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/competition-cells/:x/:y/tracks', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view cell flight tracks.'));
      return;
    }
    const x = cellCoordinateSchema.safeParse(req.params.x);
    const y = cellCoordinateSchema.safeParse(req.params.y);
    const query = tileQuerySchema.safeParse(req.query);
    if (!x.success || !y.success || !query.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Cell flight tracks require valid coordinates, an optional YYYY-MM month, and an optional pilot ID.' } });
      return;
    }
    if (!dependencies.cellFlightTracks) throw new Error('Cell flight-track service is not configured.');
    try {
      const tracks = await dependencies.cellFlightTracks.getCompetition({
        x: x.data,
        y: y.data,
        period: coveragePeriod(query.data.month),
        ...(query.data.pilot ? { pilotUserId: query.data.pilot } : {}),
        currentUserId: currentUser.userId,
        ...(query.data.scope ? { scope: query.data.scope } : {}),
      });
      res.status(200).type('application/geo+json').send(tracks);
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res) => {
    if (res.locals.currentUser) {
      res.redirect(302, '/personal');
      return;
    }
    await render(res, dependencies.renderPage, 200, {
      currentUser: null,
      page: 'landing',
    });
  });

  router.get('/global', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const selection = mapPagePeriod(req.query);
      const mapHref = `/global${selection.suffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: 'competitive', period: selection.period, location: 'Global Map', mapHref,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/following', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const selection = mapPagePeriod(req.query);
      const mapHref = `/following${selection.suffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: 'following', period: selection.period, location: 'Following', mapHref,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/personal', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const selection = mapPagePeriod(req.query);
      const mapHref = `/personal${selection.suffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: 'personal', period: selection.period, location: 'Personal Map', mapHref,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/flights/:flightId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    const parsedFlightId = pilotUserIdSchema.safeParse(req.params.flightId);
    if (!parsedFlightId.success) {
      next();
      return;
    }
    if (!dependencies.flightDetail) throw new Error('Flight detail service is not configured.');
    try {
      const summary = await dependencies.flightDetail.getSummary(parsedFlightId.data);
      if (!summary) {
        next();
        return;
      }
      const shell = authenticatedShell('flight', currentUser, { showFooter: false });
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
        ...shell,
        page: 'flight',
        flight: {
          ...createFlightPageView(summary),
          mapStyleUrl: dependencies.mapTilerStyleUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/flights/:flightId/map', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in before viewing a flight map.'));
      return;
    }
    const parsedFlightId = pilotUserIdSchema.safeParse(req.params.flightId);
    if (!parsedFlightId.success) {
      next();
      return;
    }
    if (!dependencies.flightDetail) throw new Error('Flight detail service is not configured.');
    try {
      const [summary, mapData] = await Promise.all([
        dependencies.flightDetail.getSummary(parsedFlightId.data),
        dependencies.flightDetail.getMapData(parsedFlightId.data),
      ]);
      if (!summary || !mapData) {
        next();
        return;
      }
      res.status(200).set('Cache-Control', 'private, max-age=60').json(createFlightMapPayload(summary, mapData));
    } catch (error) {
      next(error);
    }
  });

  router.get('/profile', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const profile = await dependencies.profiles.getPilotProfile(currentUser.userId);
      if (!profile) {
        next();
        return;
      }
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(profile.recentFlights.map((flight) => ({ userId: profile.userId, flightId: flight.flightId })))
        : undefined;
      const shell = authenticatedShell('profile', currentUser);
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
        ...shell,
        page: 'profile',
        ...pilotProfileToView(profile, { isCurrent: true, isFollowed: false, currentPath: '/profile', thumbnailUrls }),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/achievements', async (_req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const profile = await dependencies.profiles.getPilotAchievements(currentUser.userId);
      if (!profile) {
        next();
        return;
      }
      const shell = authenticatedShell('achievements', currentUser);
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, createAchievementsPageModel(profile, shell));
    } catch (error) {
      next(error);
    }
  });

  router.get('/pilots/:userId', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    const parsedUserId = pilotUserIdSchema.safeParse(req.params.userId);
    if (!parsedUserId.success) {
      next();
      return;
    }
    try {
      const profile = await dependencies.profiles.getPilotProfile(parsedUserId.data);
      if (!profile) {
        next();
        return;
      }
      const profileIsCurrent = parsedUserId.data === currentUser.userId;
      const profileIsFollowed = profileIsCurrent
        ? false
        : dependencies.follow ? await dependencies.follow.isFollowing({ followerUserId: currentUser.userId, followedUserId: parsedUserId.data }) : false;
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(profile.recentFlights.map((flight) => ({ userId: profile.userId, flightId: flight.flightId })))
        : undefined;
      const shell = authenticatedShell('profile', currentUser);
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
        ...shell,
        page: 'profile',
        ...pilotProfileToView(profile, { isCurrent: profileIsCurrent, isFollowed: profileIsFollowed, currentPath: `/pilots/${parsedUserId.data}`, thumbnailUrls }),
      });
    } catch (error) {
      next(error);
    }
  });

  async function activityFeedRequest(req: Request, res: Response, next: NextFunction, fragment: boolean) {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      if (fragment) next(new AppError(401, 'unauthorized', 'Sign in before viewing activity.'));
      else res.redirect(302, '/');
      return;
    }
    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(400, 'invalid_request', 'Activity query is invalid.'));
      return;
    }
    const query = parsed.data.q?.trim() ?? '';
    const scope = parsed.data.scope ?? 'following';
    try {
      const [activityFeed, activityStatistics] = await Promise.all([
        dependencies.activity
          ? dependencies.activity.listFeed({ viewerUserId: currentUser.userId, limit: 20, before: parsed.data.before, q: query, scope })
          : Promise.resolve({ items: [], nextCursor: null }),
        !fragment && dependencies.activity
          ? dependencies.activity.getStatistics({ viewerUserId: currentUser.userId, q: query, scope })
          : Promise.resolve(null),
      ]);
      const activityParams = new URLSearchParams();
      if (query) activityParams.set('q', query);
      activityParams.set('scope', scope);
      const activityQuery = activityParams.toString();
      const activityReturnTo = activityQuery ? `/activity?${activityQuery}` : '/activity';
      const activityScopeLinks = {
        following: `/activity?${new URLSearchParams({ ...(query ? { q: query } : {}), scope: 'following' })}`,
        yours: `/activity?${new URLSearchParams({ ...(query ? { q: query } : {}), scope: 'yours' })}`,
      };
      const activityPilotResults = !fragment && query && dependencies.follow
        ? (await dependencies.follow.searchPilots({ viewerUserId: currentUser.userId, query })).map(activityPilotResultToView)
        : [];
      const activityLoadMoreHref = activityFeed.nextCursor
        ? `/activity?before=${encodeURIComponent(activityFeed.nextCursor)}${activityQuery ? `&${activityQuery}` : ''}`
        : '';
      const activityLoadMoreEndpoint = activityFeed.nextCursor
        ? `/activity/feed?before=${encodeURIComponent(activityFeed.nextCursor)}${activityQuery ? `&${activityQuery}` : ''}`
        : '';
      const thumbnailUrls = dependencies.thumbnailDelivery
        ? await dependencies.thumbnailDelivery.signMany(activityFeed.items
          .filter((item) => item.activityType === 'flight' && item.sourceFlightId)
          .map((item) => ({ userId: item.actorUserId, flightId: item.sourceFlightId as string })))
        : undefined;
      if (fragment) {
        res.status(200).type('html').send(await dependencies.renderAuthenticatedActivityFeed({
          events: activityFeedToViews(activityFeed.items, { thumbnailUrls }), activityLoadMoreHref, activityLoadMoreEndpoint,
        }));
        return;
      }
      const shell = authenticatedShell('activity', currentUser);
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, {
        ...shell,
        page: 'activity',
        events: activityFeedToViews(activityFeed.items, { thumbnailUrls }),
        activityStats: activityStatsToView(activityStatistics ?? emptyActivityStatistics),
        activitySearch: query,
        activityPilotResults,
        activityReturnTo,
        activityScopeLinks,
        activityScope: scope,
        activityLoadMoreHref,
        activityLoadMoreEndpoint,
      });
    } catch (error) {
      if (error instanceof ActivityCursorError) {
        next(new AppError(400, 'invalid_request', 'Activity cursor is invalid.'));
        return;
      }
      next(error);
    }
  }

  router.get('/activity/feed', (req, res, next) => activityFeedRequest(req, res, next, true));

  router.get('/activity', (req, res, next) => activityFeedRequest(req, res, next, false));

  router.post('/activities/:activityId/like', async (req, res, next) => {
    const wantsJson = req.get('accept')?.toLowerCase().includes('application/json') ?? false;
    const fail = (status: number, code: string, message: string) => {
      if (wantsJson) {
        res.status(status).json({ error: { code, message } });
      } else {
        next(new AppError(status, code === 'forbidden' ? 'unauthorized' : 'invalid_request', message));
      }
    };
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      fail(401, 'unauthorized', 'Sign in before sending a Like.');
      return;
    }
    const parsedActivityId = pilotUserIdSchema.safeParse(req.params.activityId);
    if (!parsedActivityId.success) {
      fail(400, 'invalid_request', 'Activity ID is invalid.');
      return;
    }
    if (!dependencies.activity) throw new Error('Activity service is not configured.');
    try {
      const result = await dependencies.activity.toggleLike({
        viewerUserId: currentUser.userId,
        activityId: parsedActivityId.data,
      });
      if (wantsJson) {
        res.status(200).json(result);
      } else {
        res.redirect(303, '/activity');
      }
    } catch (error) {
      if (error instanceof ActivityNotFoundError) {
        fail(404, 'not_found', 'Activity not found.');
        return;
      }
      if (error instanceof SelfLikeError) {
        fail(403, 'forbidden', 'You cannot send a Like to your own activity.');
        return;
      }
      next(error);
    }
  });

  for (const action of ['follow', 'unfollow'] as const) {
    router.post(`/pilots/:userId/${action}`, async (req, res, next) => {
      const currentUser = res.locals.currentUser;
      if (!currentUser) {
        next(new AppError(401, 'unauthorized', 'Sign in before following pilots.'));
        return;
      }
      const parsedUserId = pilotUserIdSchema.safeParse(req.params.userId);
      if (!parsedUserId.success) {
        next(new AppError(400, 'invalid_request', 'Pilot ID is invalid.'));
        return;
      }
      if (parsedUserId.data === currentUser.userId) {
        next(new AppError(400, 'invalid_request', 'You cannot follow yourself.'));
        return;
      }
      if (!dependencies.follow) throw new Error('Follow service is not configured.');
      try {
        const body = formBody(req.body);
        if (action === 'follow') {
          await dependencies.follow.follow({ followerUserId: currentUser.userId, followedUserId: parsedUserId.data });
        } else {
          await dependencies.follow.unfollow({ followerUserId: currentUser.userId, followedUserId: parsedUserId.data });
        }
        res.redirect(303, followReturnTo(body.returnTo, `/pilots/${parsedUserId.data}`));
      } catch (error) {
        if (error instanceof PilotNotFoundError) {
          next(new AppError(404, 'invalid_request', error.message));
          return;
        }
        next(error);
      }
    });
  }

  router.get('/arena/:countryCode/:arenaSlug', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    try {
      const arena = await dependencies.arenas.getByRoute(req.params.countryCode, req.params.arenaSlug);
      if (!arena) {
        next();
        return;
      }
      const selection = mapPagePeriod(req.query);
      if (req.query.view !== undefined && req.query.view !== 'following') {
        throw new AppError(400, 'invalid_request', 'Arena view is invalid.');
      }
      const viewSuffix = req.query.view === 'following'
        ? `${selection.suffix ? `${selection.suffix}&` : '?'}view=following`
        : selection.suffix;
      const mapHref = `${arena.path}${viewSuffix}`;
      await renderAuthenticated(res, dependencies.renderAuthenticatedPage, 200, productionMap(currentUser, {
        mode: req.query.view === 'following' ? 'following' : 'competitive', period: selection.period, location: arena.name, mapHref,
        ...(arena.arenaType === 'launch'
          ? { focusArenaSourceId: arena.sourceId }
          : { arenaSourceId: arena.sourceId }),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.adminFlights || !dependencies.renderAdminPage) {
      throw new Error('Admin dependencies are not configured.');
    }

    try {
      const [flightRows, queueSummary] = await Promise.all([
        dependencies.adminFlights.listRecentFlights(),
        dependencies.uploadQueue?.queueSummary(),
      ]);
      res.status(200).type('html').send(await dependencies.renderAdminPage({
        currentUser,
        flights: flightRows,
        queueSummary,
        reprocessSuccess: req.query.reprocess === 'success',
        reprocessError: req.query.reprocess === 'error',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/flight-processing', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (
      !dependencies.uploadQueue
      || !dependencies.workerControl
      || !dependencies.flightProcessingControl
      || !dependencies.renderAdminFlightProcessingPage
    ) {
      throw new Error('Admin flight processing dependencies are not configured.');
    }

    try {
      const [queueSummary, workerControlState, workerStatuses, nPointSolverState] = await Promise.all([
        dependencies.uploadQueue.queueSummary(),
        dependencies.workerControl.getState(),
        dependencies.workerControl.listStatuses(),
        dependencies.flightProcessingControl.getNPointSolverState(),
      ]);
      res.status(200).type('html').send(await dependencies.renderAdminFlightProcessingPage({
        currentUser,
        queueSummary,
        workerControlState,
        workers: workerStatuses.map((status) => ({
          ...status,
          heartbeat: new Date(status.heartbeatAt).toISOString(),
          online: Date.now() - status.heartbeatAt <= WORKER_STATUS_TTL_SECONDS * 1_000,
        })),
        nPointSolverState,
        workerControlSuccess: req.query.worker === 'paused' || req.query.worker === 'running',
        workerControlError: req.query.worker === 'error',
        solverControlSuccess: req.query.solver === 'enabled' || req.query.solver === 'disabled',
        solverControlError: req.query.solver === 'error',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/worker-control', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.workerControl) throw new Error('Admin dependencies are not configured.');

    const parsed = z.object({ state: z.enum(['running', 'paused']) }).strict().safeParse(formBody(req.body));
    if (!parsed.success) {
      res.redirect(303, '/admin/flight-processing?worker=error');
      return;
    }

    try {
      await dependencies.workerControl.setState(parsed.data.state);
      res.redirect(303, `/admin/flight-processing?worker=${parsed.data.state}`);
    } catch {
      res.redirect(303, '/admin/flight-processing?worker=error');
    }
  });

  router.post('/admin/flight-processing/n-point-solver', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.flightProcessingControl) {
      throw new Error('Admin flight processing dependencies are not configured.');
    }

    const parsed = z.object({ state: z.enum(['enabled', 'disabled']) }).strict().safeParse(formBody(req.body));
    if (!parsed.success) {
      res.redirect(303, '/admin/flight-processing?solver=error');
      return;
    }

    try {
      await dependencies.flightProcessingControl.setNPointSolverState(parsed.data.state);
      res.redirect(303, `/admin/flight-processing?solver=${parsed.data.state}`);
    } catch {
      res.redirect(303, '/admin/flight-processing?solver=error');
    }
  });

  router.get('/admin/map-settings', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.renderAdminMapSettingsPage) {
      throw new Error('Admin map settings dependencies are not configured.');
    }

    try {
      res.status(200).type('html').send(await dependencies.renderAdminMapSettingsPage({
        currentUser,
        settings: territoryTileSettings.get(),
        saveSuccess: req.query.save === 'success',
        saveError: req.query.save === 'error',
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/map-settings', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.renderAdminMapSettingsPage) {
      throw new Error('Admin map settings dependencies are not configured.');
    }

    const parsed = territoryTileSettingsSchema.safeParse(formBody(req.body));
    if (!parsed.success) {
      res.redirect(303, '/admin/map-settings?save=error');
      return;
    }

    try {
      territoryTileSettings.update({
        personal: {
          minimumZoom: parsed.data.personalMinimumZoom,
          maximumZoom: parsed.data.personalMaximumZoom,
        },
        competition: {
          minimumZoom: parsed.data.competitionMinimumZoom,
          maximumZoom: parsed.data.competitionMaximumZoom,
        },
      });
      res.redirect(303, '/admin/map-settings?save=success');
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/flights/:flightId/reprocess', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !hasAdminAccess(currentUser)) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    if (!dependencies.adminFlights) throw new Error('Admin dependencies are not configured.');
    if (!z.string().uuid().safeParse(req.params.flightId).success) {
      res.redirect(303, '/admin?reprocess=error');
      return;
    }

    try {
      const outcome = await dependencies.adminFlights.reprocessFlight({ flightId: req.params.flightId });
      res.redirect(303, outcome.status === 'completed' ? '/admin?reprocess=success' : '/admin?reprocess=error');
    } catch (error) {
      console.error('Unable to reprocess flight claims', error);
      res.redirect(303, '/admin?reprocess=error');
    }
  });

  router.post('/signup', async (req, res) => {
    const body = formBody(req.body);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      await render(res, dependencies.renderPage, 422, {
        currentUser: null,
        signupError:
          'Enter a valid email, an optional display name of up to 48 characters, and a password of 12 to 128 characters.',
        signupEmail: typeof body.email === 'string' ? body.email : '',
        signupDisplayName: typeof body.displayName === 'string' ? body.displayName : '',
      });
      return;
    }

    try {
      const session = await dependencies.auth.signup({
        email: parsed.data.email,
        password: parsed.data.password,
        displayName: parsed.data.displayName || undefined,
      });
      res.setHeader('set-cookie', dependencies.cookie.set(session.token));
      res.redirect(303, '/personal?onboarding=1');
    } catch (error) {
      if (error instanceof AuthFailure && error.code === 'duplicate_email') {
        await render(res, dependencies.renderPage, 409, {
          currentUser: null,
          signupError: 'An account with that email already exists.',
          signupEmail: parsed.data.email,
          signupDisplayName: parsed.data.displayName,
        });
        return;
      }
      throw error;
    }
  });

  router.post('/login', async (req, res) => {
    const body = formBody(req.body);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      await render(res, dependencies.renderPage, 401, {
        currentUser: null,
        loginError: 'Email or password is incorrect.',
        loginEmail: typeof body.email === 'string' ? body.email : '',
      });
      return;
    }

    try {
      const session = await dependencies.auth.login(parsed.data);
      res.setHeader('set-cookie', dependencies.cookie.set(session.token));
      res.redirect(303, '/');
    } catch (error) {
      if (error instanceof AuthFailure && error.code === 'invalid_credentials') {
        await render(res, dependencies.renderPage, 401, {
          currentUser: null,
          loginError: 'Email or password is incorrect.',
          loginEmail: parsed.data.email,
        });
        return;
      }
      throw error;
    }
  });

  router.post('/logout', async (_req, res) => {
    if (res.locals.sessionToken) await dependencies.auth.logout(res.locals.sessionToken);
    res.setHeader('set-cookie', dependencies.cookie.clear());
    res.redirect(303, '/');
  });

  router.post('/profile/territory-color', async (req, res) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      await render(res, dependencies.renderPage, 401, {
        currentUser: null,
        territoryColorError: 'Sign in before changing your map color.',
      });
      return;
    }

    const territoryColor = normalizeTerritoryColor(formBody(req.body).territoryColor);
    if (!territoryColor) {
      await render(res, dependencies.renderPage, 422, {
        currentUser,
        territoryColorError: 'Choose a valid six-digit hex color.',
      });
      return;
    }

    await dependencies.profiles.updateTerritoryColor({ userId: currentUser.userId, territoryColor });
    res.redirect(303, dashboardSuccessRedirect(formBody(req.body).returnTo, 'territoryColor'));
  });

  return router;
}
