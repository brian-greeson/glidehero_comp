import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuthService } from '../../src/services/authService.js';
import { createArenaService } from '../../src/services/arenaService.js';
import { createArenaProgressService } from '../../src/services/arenaProgressService.js';
import { createMonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';
import { createGridClaimService } from '../../src/services/gridClaimService.js';
import { createMapGridService } from '../../src/services/mapGridService.js';
import { createProfileService } from '../../src/services/profileService.js';
import { createTerritoryTileService } from '../../src/services/territoryTileService.js';
import { createPageRenderer } from '../../src/views/renderer.js';
import { createAuthenticatedActivityFeedRenderer, createAuthenticatedPageRenderer } from '../../src/views/authenticated/renderer.js';
import { createCurrentUserMiddleware } from '../../src/web/currentUserMiddleware.js';
import { createSessionCookie } from '../../src/web/sessionCookie.js';
import { createWebRouter } from '../../src/web/webRouter.js';
import { withServer } from '../support/http.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

afterAll(async () => {
  await database?.pool.end();
});

describe('GlideHero browser authentication flow', () => {
  it('signs up, renders the user, logs out, and logs back in', async () => {
    const testDatabase = database;
    if (!testDatabase) throw new Error('Test database was not initialized.');

    const auth = createAuthService(testDatabase.db, { sessionTtlSeconds: 604800 });
    const profiles = createProfileService(testDatabase.db, { cellSize: 1_000 });
    const gridClaim = createGridClaimService(testDatabase.db, { cellSize: 1_000 });
    const mapGrid = createMapGridService(testDatabase.db, { cellSize: 1_000 });
    const coverage = createMonthlyCoverageService(testDatabase.db, { cellSize: 1_000 });
    const arenas = createArenaService(testDatabase.db, { cellSize: 1_000 });
    const arenaProgress = createArenaProgressService(testDatabase.db, { cellSize: 1_000 });
    const territoryTiles = createTerritoryTileService(testDatabase.db, { cellSize: 1_000 });
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
          profiles,
          gridClaim,
          mapGrid,
          coverage,
          territoryTiles,
          arenas,
          arenaProgress,
          renderPage: createPageRenderer({ mapTilerApiKey: 'maptiler-test-key' }),
          renderAuthenticatedPage: createAuthenticatedPageRenderer(),
          renderAuthenticatedActivityFeed: createAuthenticatedActivityFeedRenderer(),
        }),
      ],
    });

    await withServer(app, async (baseUrl) => {
      const landing = await fetch(`${baseUrl}/`);
      const landingHtml = await landing.text();
      expect(landing.status).toBe(200);
      expect(landingHtml).toContain('<title>GlideHero</title>');
      expect(landingHtml).toContain('Create account');

      const signup = await fetch(`${baseUrl}/signup`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
          displayName: 'Sky Pilot',
        }),
      });
      expect(signup.status).toBe(303);
      const signupSetCookie = signup.headers.get('set-cookie');
      expect(signupSetCookie).toContain('Max-Age=604800');
      expect(signupSetCookie).toContain('Path=/');
      expect(signupSetCookie).toContain('HttpOnly');
      expect(signupSetCookie).toContain('SameSite=Lax');
      const signupCookie = signupSetCookie?.split(';', 1)[0];
      expect(signupCookie).toMatch(/^glidehero_session=/);

      const signedIn = await fetch(`${baseUrl}/`, { headers: { cookie: signupCookie ?? '' } });
      expect(await signedIn.text()).toContain('Sky Pilot');

      const logout = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        redirect: 'manual',
        headers: { cookie: signupCookie ?? '' },
      });
      expect(logout.status).toBe(303);
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');

      const signedOut = await fetch(`${baseUrl}/`, {
        headers: { cookie: signupCookie ?? '' },
      });
      const signedOutHtml = await signedOut.text();
      expect(signedOut.status).toBe(200);
      expect(signedOutHtml).not.toContain('<span class="account-name">Sky Pilot</span>');
      expect(signedOutHtml).not.toContain('pilot@example.com');
      expect(signedOutHtml).toContain('action="/login"');
      expect(signedOutHtml).toContain('action="/signup"');

      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'pilot@example.com',
          password: 'correct horse battery staple',
        }),
      });
      expect(login.status).toBe(303);
      const loginSetCookie = login.headers.get('set-cookie');
      expect(loginSetCookie).toContain('Max-Age=604800');
      expect(loginSetCookie).toContain('Path=/');
      expect(loginSetCookie).toContain('HttpOnly');
      expect(loginSetCookie).toContain('SameSite=Lax');
      const loginCookie = loginSetCookie?.split(';', 1)[0];
      const signedInAgain = await fetch(`${baseUrl}/`, { headers: { cookie: loginCookie ?? '' } });
      expect(await signedInAgain.text()).toContain('Sky Pilot');
    });
  });
});
