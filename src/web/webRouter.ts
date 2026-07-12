import { Router, type Response } from 'express';
import { z } from 'zod';
import { AuthFailure, type AuthService } from '../services/authService.js';
import type { PageModel, PageRenderer } from '../views/renderer.js';
import type { SessionCookie } from './sessionCookie.js';

const email = z.string().trim().toLowerCase().pipe(z.email());
const password = z.string().min(12).max(128);
const signupSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(48).optional().or(z.literal('')),
});
const loginSchema = z.object({ email, password });

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
  renderPage: PageRenderer;
}) {
  const router = Router();

  router.get('/', async (_req, res) => {
    await render(res, dependencies.renderPage, 200, { currentUser: res.locals.currentUser });
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

  return router;
}
