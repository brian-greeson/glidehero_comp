import { Router, type Response } from 'express';
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
import type {
  AdminMapSettingsPageRenderer,
  AdminPageRenderer,
  PageModel,
  PageRenderer,
} from '../views/renderer.js';
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
const competitionMonthSchema = z.object({ month: competitionMonthValue.optional() }).strict();
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
  ...viewportBoundsShape,
}).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);
const arenaSearchSchema = z.object({ q: z.string().trim().min(1).max(100) }).strict();
const arenaSourceIdSchema = z.coerce.number().int().positive().safe();
const cellCoordinateSchema = z.coerce.number().int().safe();
const tileQuerySchema = z.object({
  month: competitionMonthValue.optional(),
  pilot: z.string().uuid().optional(),
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

export function createWebRouter(dependencies: {
  auth: AuthService;
  cookie: SessionCookie;
  uploadQueue?: FlightUploadQueueService;
  failedFlightCleanup?: FailedFlightCleanupService;
  profiles: ProfileService;
  gridClaim: GridClaimService;
  mapGrid: MapGridService;
  coverage: MonthlyCoverageService;
  territoryTiles: TerritoryTileService;
  arenas: ArenaService;
  renderPage: PageRenderer;
  adminEmails?: readonly string[];
  adminFlights?: AdminFlightService;
  renderAdminPage?: AdminPageRenderer;
  territoryTileSettings?: TerritoryTileSettingsService;
  renderAdminMapSettingsPage?: AdminMapSettingsPageRenderer;
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
      if (!month) return url.pathname;
      normalizeCompetitionLeaderboardMonth(month);
      return `${url.pathname}?month=${encodeURIComponent(month)}`;
    } catch {
      return '/global';
    }
  }

  function dashboardSuccessRedirect(value: unknown, parameter: string): string {
    const url = new URL(dashboardReturnTo(value), 'http://glidehero.local');
    url.searchParams.set(parameter, 'success');
    return `${url.pathname}?${url.searchParams}`;
  }

  function hasAdminAccess(currentUser: AuthenticatedUser | null): boolean {
    return Boolean(currentUser && isAdmin(currentUser.email));
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
    if (!coordinates || Object.keys(req.query).length > 0) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Personal territory tile coordinates are invalid.' } });
      return;
    }
    try {
      sendTerritoryTile(res, await dependencies.territoryTiles.getPersonalTile({
        ...coordinates,
        userId: currentUser.userId,
      }));
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

    const viewport = viewportBoundsSchema.safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Personal stats require valid viewport bounds.' },
      });
      return;
    }

    try {
      const stats = await dependencies.gridClaim.getViewportStats({
        userId: currentUser.userId,
        ...viewport.data,
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
      sendTerritoryTile(res, await dependencies.territoryTiles.getGlobalCompetitionTile({
        ...coordinates,
        period: coveragePeriod(query.data.month),
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
    if (!res.locals.currentUser) {
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
      sendTerritoryTile(res, await dependencies.territoryTiles.getArenaCompetitionTile({
        ...coordinates,
        arenaId: arena.id,
        period: coveragePeriod(query.data.month),
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
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/competition-cells/:x/:y/claimants', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view competition cell claimants.'));
      return;
    }
    const x = cellCoordinateSchema.safeParse(req.params.x);
    const y = cellCoordinateSchema.safeParse(req.params.y);
    const period = competitionMonthSchema.safeParse(req.query);
    if (!x.success || !y.success || !period.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Cell claimants require valid coordinates and a YYYY-MM month.' } });
      return;
    }
    try {
      const claimants = await dependencies.coverage.getCellClaimants({
        ...coveragePeriod(period.data.month),
        x: x.data,
        y: y.data,
      });
      res.status(200).json({ claimants });
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

  router.get('/global', async (req, res) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    await render(res, dependencies.renderPage, 200, {
      currentUser,
      page: 'global',
      isAdmin: isAdmin(currentUser.email),
      territoryColorSuccess: req.query.territoryColor === 'success',
    });
  });

  router.get('/personal', async (req, res) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      res.redirect(302, '/');
      return;
    }
    await render(res, dependencies.renderPage, 200, {
      currentUser,
      page: 'personal',
      isAdmin: isAdmin(currentUser.email),
      territoryColorSuccess: req.query.territoryColor === 'success',
    });
  });

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
      await render(res, dependencies.renderPage, 200, {
        currentUser,
        page: 'arena',
        arena,
        isAdmin: isAdmin(currentUser.email),
        territoryColorSuccess: req.query.territoryColor === 'success',
      });
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
