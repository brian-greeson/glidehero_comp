import { Router } from 'express';
import { z } from 'zod';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import { AppError } from '../domain/errors.js';
import type { ArenaService } from '../services/arenaService.js';
import type { MonthlyCoveragePeriod, MonthlyCoverageService } from '../services/monthlyCoverageService.js';
import type { CoveragePlaytestPageRenderer } from '../views/renderer.js';

const monthValue = z.string().refine((value) => {
  try { normalizeCompetitionLeaderboardMonth(value); return true; } catch { return false; }
});
const finiteCoordinate = z.string().refine((value) => value.trim() === value && Number.isFinite(Number(value))).transform(Number);
const boundsShape = {
  west: finiteCoordinate.refine((value) => value >= -180 && value <= 180),
  south: finiteCoordinate.refine((value) => value >= -90 && value <= 90),
  east: finiteCoordinate.refine((value) => value >= -180 && value <= 180),
  north: finiteCoordinate.refine((value) => value >= -90 && value <= 90),
};
const globalLeaderboardSchema = z.object({ month: monthValue.optional(), ...boundsShape }).strict()
  .refine((value) => value.south < value.north && value.west !== value.east);
const territorySchema = z.object({ month: monthValue.optional(), pilot: z.string().uuid().optional() }).strict();
const monthSchema = z.object({ month: monthValue.optional() }).strict();
const sourceIdSchema = z.coerce.number().int().positive().safe();
const cellCoordinateSchema = z.coerce.number().int().safe();

function period(month?: string): MonthlyCoveragePeriod {
  return month ? { competitionMonth: month } : { period: 'all-time' };
}

export function createCoveragePlaytestRouter(dependencies: {
  coverage: MonthlyCoverageService;
  arenas: ArenaService;
  renderPage: CoveragePlaytestPageRenderer;
}) {
  const router = Router();

  function requireUser(res: Parameters<Parameters<typeof router.get>[1]>[1]) {
    const currentUser = res.locals.currentUser;
    if (!currentUser) throw new AppError(401, 'unauthorized', 'Sign in to view the coverage playtest.');
    return currentUser;
  }

  router.get('/playtest/coverage/global', async (_req, res, next) => {
    try {
      const currentUser = res.locals.currentUser;
      if (!currentUser) { res.redirect(302, '/'); return; }
      res.status(200).type('html').send(await dependencies.renderPage({ currentUser, page: 'coverage-global' }));
    } catch (error) { next(error); }
  });

  router.get('/playtest/coverage/arena/:countryCode/:arenaSlug', async (req, res, next) => {
    try {
      const currentUser = res.locals.currentUser;
      if (!currentUser) { res.redirect(302, '/'); return; }
      const arena = await dependencies.arenas.getByRoute(req.params.countryCode, req.params.arenaSlug);
      if (!arena) { next(); return; }
      res.status(200).type('html').send(await dependencies.renderPage({ currentUser, page: 'coverage-arena', arena }));
    } catch (error) { next(error); }
  });

  router.get('/v1/playtest/coverage/global/leaderboard', async (req, res, next) => {
    try {
      const currentUser = requireUser(res);
      const input = globalLeaderboardSchema.safeParse(req.query);
      if (!input.success) { res.status(400).json({ error: { code: 'invalid_request', message: 'Coverage leaderboard requires a valid period and viewport.' } }); return; }
      res.status(200).json(await dependencies.coverage.getGlobalLeaderboard({
        ...period(input.data.month), ...input.data, currentUserId: currentUser.userId,
      }));
    } catch (error) { next(error); }
  });

  router.get('/v1/playtest/coverage/global/territory', async (req, res, next) => {
    try {
      requireUser(res);
      const input = territorySchema.safeParse(req.query);
      if (!input.success) { res.status(400).json({ error: { code: 'invalid_request', message: 'Coverage territory requires a valid period and pilot.' } }); return; }
      res.status(200).json(await dependencies.coverage.getGlobalTerritory({
        ...period(input.data.month), pilotUserId: input.data.pilot,
      }));
    } catch (error) { next(error); }
  });

  router.get('/v1/playtest/coverage/arenas/:sourceId/leaderboard', async (req, res, next) => {
    try {
      const currentUser = requireUser(res);
      const sourceId = sourceIdSchema.safeParse(req.params.sourceId);
      const input = monthSchema.safeParse(req.query);
      if (!sourceId.success || !input.success) { res.status(400).json({ error: { code: 'invalid_request', message: 'Arena coverage requires a valid Arena and period.' } }); return; }
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) { res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } }); return; }
      res.status(200).json(await dependencies.coverage.getArenaLeaderboard({
        ...period(input.data.month), launchAreaId: arena.id, currentUserId: currentUser.userId,
      }));
    } catch (error) { next(error); }
  });

  router.get('/v1/playtest/coverage/arenas/:sourceId/territory', async (req, res, next) => {
    try {
      requireUser(res);
      const sourceId = sourceIdSchema.safeParse(req.params.sourceId);
      const input = territorySchema.safeParse(req.query);
      if (!sourceId.success || !input.success) { res.status(400).json({ error: { code: 'invalid_request', message: 'Arena coverage requires a valid Arena, period, and pilot.' } }); return; }
      const arena = await dependencies.arenas.getBySourceId(sourceId.data);
      if (!arena) { res.status(404).json({ error: { code: 'not_found', message: 'Arena not found.' } }); return; }
      res.status(200).json(await dependencies.coverage.getArenaTerritory({
        ...period(input.data.month), launchAreaId: arena.id, pilotUserId: input.data.pilot,
      }));
    } catch (error) { next(error); }
  });

  router.get('/v1/playtest/coverage/cells/:x/:y/claimants', async (req, res, next) => {
    try {
      requireUser(res);
      const x = cellCoordinateSchema.safeParse(req.params.x);
      const y = cellCoordinateSchema.safeParse(req.params.y);
      const input = monthSchema.safeParse(req.query);
      if (!x.success || !y.success || !input.success) { res.status(400).json({ error: { code: 'invalid_request', message: 'Cell claimants require a valid cell and period.' } }); return; }
      res.status(200).json({ claimants: await dependencies.coverage.getCellClaimants({ ...period(input.data.month), x: x.data, y: y.data }) });
    } catch (error) { next(error); }
  });

  return router;
}
