import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { normalizeCompetitionMonth } from '../domain/competition/competitionMonth.js';
import { AppError } from '../domain/errors.js';
import { AuthFailure, type AuthService } from '../services/authService.js';
import type { CompetitionGridClaimService } from '../services/competitionGridClaimService.js';
import { normalizeTerritoryColor, type ProfileService } from '../services/profileService.js';
import type { GridClaimService } from '../services/gridClaimService.js';
import type { PageModel, PageRenderer } from '../views/renderer.js';
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
  competitionGridClaim: Pick<CompetitionGridClaimService, 'getCurrent'>;
  renderPage: PageRenderer;
}) {
  const router = Router();

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

  router.get('/', async (req, res) => {
    await render(res, dependencies.renderPage, 200, {
      currentUser: res.locals.currentUser,
      uploadSuccess: req.query.igcUpload === 'success',
      territoryColorSuccess: req.query.territoryColor === 'success',
    });
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
    res.redirect(303, '/?territoryColor=success');
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
        res.redirect(303, '/?igcUpload=success');
      } catch (uploadError) {
        next(uploadError);
      }
    });
  });

  return router;
}
