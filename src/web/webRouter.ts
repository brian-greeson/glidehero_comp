import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { normalizeCompetitionMonth } from '../domain/competition/competitionMonth.js';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import { AppError } from '../domain/errors.js';
import { AuthFailure, type AuthenticatedUser, type AuthService } from '../services/authService.js';
import type { CompetitionGridClaimService } from '../services/competitionGridClaimService.js';
import { normalizeTerritoryColor, type ProfileService } from '../services/profileService.js';
import type { GridClaimService } from '../services/gridClaimService.js';
import type { AdminFlightService } from '../services/adminFlightService.js';
import type { ArenaService } from '../services/arenaService.js';
import type { PageModel, PageRenderer } from '../views/renderer.js';
import type { AdminPageRenderer } from '../views/renderer.js';
import type { IgcFileService } from '../services/igcFileService.js';
import type { SessionCookie } from './sessionCookie.js';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(3).max(128);
const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(48).optional().or(z.literal('')),
});
const loginSchema = z.object({ email, password });
const competitionDateSchema = z.object({
  date: z.string().refine((value) => {
    try {
      normalizeCompetitionMonth(value);
      return true;
    } catch {
      return false;
    }
  }),
});
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
  month: z.string().refine((value) => {
    try {
      normalizeCompetitionLeaderboardMonth(value);
      return true;
    } catch {
      return false;
    }
  }),
  ...viewportBoundsShape,
}).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);
const arenaSearchSchema = z.object({ q: z.string().trim().min(1).max(100) }).strict();
const arenaSourceIdSchema = z.coerce.number().int().positive().safe();

function formBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

async function render(res: Response, renderPage: PageRenderer, status: number, model: PageModel) {
  res.status(status).type('html').send(await renderPage(model));
}

const igcUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function isIgcFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.igc');
}

export function createWebRouter(dependencies: {
  auth: AuthService;
  cookie: SessionCookie;
  igcFiles: IgcFileService;
  profiles: ProfileService;
  gridClaim: GridClaimService;
  competitionGridClaim: Pick<CompetitionGridClaimService, 'getCurrent' | 'getViewportLeaderboard' | 'getArenaCurrent' | 'getArenaLeaderboard'>;
  arenas: ArenaService;
  renderPage: PageRenderer;
  adminEmails?: readonly string[];
  adminFlights?: AdminFlightService;
  renderAdminPage?: AdminPageRenderer;
}) {
  const router = Router();
  const adminEmails = new Set((dependencies.adminEmails ?? []).map((email) => email.trim().toLowerCase()));
  const isAdmin = (email: string) => adminEmails.has(email.trim().toLowerCase());

  function dashboardReturnTo(value: unknown): string {
    if (value === '/global' || value === '/personal') return value;
    if (typeof value === 'string' && /^\/arena\/[a-z]{2}\/[a-z0-9-]+-\d+$/.test(value)) return value;
    return '/global';
  }

  function hasAdminAccess(currentUser: AuthenticatedUser | null): boolean {
    return Boolean(currentUser && isAdmin(currentUser.email));
  }

  router.get('/v1/personal-territory', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view your personal territory.'));
      return;
    }

    try {
      const territory = await dependencies.gridClaim.get({ userId: currentUser.userId });
      res.status(200).json(territory);
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

  router.get('/v1/competition-territory', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view competition territory.'));
      return;
    }

    const competitionDate = competitionDateSchema.safeParse(req.query);
    if (!competitionDate.success) {
      res.status(400).json({
        error: { code: 'invalid_request', message: 'Competition date must be a valid ISO calendar date.' },
      });
      return;
    }

    try {
      const territory = await dependencies.competitionGridClaim.getCurrent({
        competitionMonth: competitionDate.data.date,
      });
      res.status(200).json(territory);
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
      const leaderboard = await dependencies.competitionGridClaim.getViewportLeaderboard({
        competitionMonth: viewport.data.month,
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

  router.get('/v1/arenas/:sourceId/competition-territory', async (req, res, next) => {
    if (!res.locals.currentUser) {
      next(new AppError(401, 'unauthorized', 'Sign in to view Arena territory.'));
      return;
    }
    const sourceId = arenaSourceIdSchema.safeParse(req.params.sourceId);
    const competitionDate = competitionDateSchema.safeParse(req.query);
    if (!sourceId.success || !competitionDate.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena territory requires a valid Arena and ISO calendar date.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      const territory = await dependencies.competitionGridClaim.getArenaCurrent({
        competitionMonth: competitionDate.data.date,
        launchAreaId: arena.id,
      });
      res.status(200).json(territory);
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
    const month = z.object({
      month: z.string().refine((value) => {
        try {
          normalizeCompetitionLeaderboardMonth(value);
          return true;
        } catch {
          return false;
        }
      }),
    }).strict().safeParse(req.query);
    if (!sourceId.success || !month.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Arena leaderboard requires a valid Arena and YYYY-MM month.' } });
      return;
    }
    try {
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) {
        res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } });
        return;
      }
      res.status(200).json(await dependencies.competitionGridClaim.getArenaLeaderboard({
        competitionMonth: month.data.month,
        launchAreaId: arena.id,
        currentUserId: currentUser.userId,
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res) => {
    if (res.locals.currentUser) {
      res.redirect(302, '/global');
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
      uploadSuccess: req.query.igcUpload === 'success',
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
      uploadSuccess: req.query.igcUpload === 'success',
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
        uploadSuccess: req.query.igcUpload === 'success',
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
      res.status(200).type('html').send(await dependencies.renderAdminPage({
        currentUser,
        flights: await dependencies.adminFlights.listRecentFlights(),
        reprocessSuccess: req.query.reprocess === 'success',
        reprocessError: req.query.reprocess === 'error',
      }));
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
      res.redirect(303, '/');
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
    res.redirect(303, `${dashboardReturnTo(formBody(req.body).returnTo)}?territoryColor=success`);
  });

  router.post('/igc-files', async (req, res, next) => {
    const currentUser = res.locals.currentUser;
    if (!currentUser) {
      await render(res, dependencies.renderPage, 401, {
        currentUser: null,
        uploadError: 'Sign in before uploading an IGC file.',
      });
      return;
    }

    igcUpload.single('igcFile')(req, res, async (error: unknown) => {
      try {
        if (error instanceof multer.MulterError) {
          const uploadError = error.code === 'LIMIT_FILE_SIZE'
            ? 'IGC files must be 10 MB or smaller.'
            : 'Upload one IGC file at a time.';
          await render(res, dependencies.renderPage, 422, { currentUser, uploadError });
          return;
        }
        if (error) throw error;

        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) {
          await render(res, dependencies.renderPage, 422, { currentUser, uploadError: 'Choose an IGC file to upload.' });
          return;
        }
        if (!isIgcFilename(file.originalname)) {
          await render(res, dependencies.renderPage, 422, {
            currentUser,
            uploadError: 'Choose an IGC file with a .igc filename.',
          });
          return;
        }

        const outcome = await dependencies.igcFiles.upload({
          ownerUserId: currentUser.userId,
          originalFilename: file.originalname,
          contentType: file.mimetype || 'application/octet-stream',
          bytes: file.buffer,
        });
        if (outcome.status !== 'completed') {
          await render(res, dependencies.renderPage, 422, { currentUser, uploadError: outcome.message });
          return;
        }
        res.redirect(303, `${dashboardReturnTo(formBody(req.body).returnTo)}?igcUpload=success`);
      } catch (uploadError) {
        next(uploadError);
      }
    });
  });

  return router;
}
