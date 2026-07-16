import { describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import { createApp } from '../../src/app.js';
import { createCoveragePlaytestRouter } from '../../src/web/coveragePlaytestRouter.js';
import { withServer } from '../support/http.js';

const user = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'pilot@example.com',
  displayName: 'Pilot',
  territoryColor: '#1769AA',
  sessionId: '00000000-0000-4000-8000-000000000099',
};

function dependencies() {
  const coverage = {
    getGlobalLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null })),
    getArenaLeaderboard: vi.fn(async () => ({ leaders: [], currentPilot: null })),
    getGlobalTerritory: vi.fn(async () => ({ type: 'FeatureCollection' as const, features: [] })),
    getArenaTerritory: vi.fn(async () => ({ type: 'FeatureCollection' as const, features: [] })),
    getCellClaimants: vi.fn(async () => []),
  };
  const arenas = {
    search: vi.fn(async () => []),
    getBySourceId: vi.fn(async () => null),
    getByRoute: vi.fn(async () => null),
  };
  const renderPage = vi.fn(async () => '<html><body>Coverage playtest</body></html>');
  return { coverage, arenas, renderPage };
}

describe('coverage playtest router', () => {
  it('keeps pages and APIs behind authentication', async () => {
    const deps = dependencies();
    const app = createApp({ webMiddleware: [createCoveragePlaytestRouter(deps)] });
    await withServer(app, async (baseUrl) => {
      const page = await fetch(`${baseUrl}/playtest/coverage/global`, { redirect: 'manual' });
      expect(page.status).toBe(302);
      expect(page.headers.get('location')).toBe('/');
      const api = await fetch(`${baseUrl}/v1/playtest/coverage/global/territory`);
      expect(api.status).toBe(401);
    });
  });

  it('passes month and viewport inputs to the isolated coverage service', async () => {
    const deps = dependencies();
    const currentUser: RequestHandler = (_req, res, next) => {
      res.locals.currentUser = user;
      next();
    };
    const app = createApp({ webMiddleware: [currentUser, createCoveragePlaytestRouter(deps)] });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/playtest/coverage/global/leaderboard?month=2026-07&west=-107&south=39&east=-105&north=41`);
      expect(response.status).toBe(200);
      expect(deps.coverage.getGlobalLeaderboard).toHaveBeenCalledWith(expect.objectContaining({
        competitionMonth: '2026-07', west: -107, south: 39, east: -105, north: 41,
        currentUserId: user.userId,
      }));
    });
  });
});
