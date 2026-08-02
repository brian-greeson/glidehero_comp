import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import type { ThermalAreaMapService } from '../services/thermalAreaMapService.js';
import type { ThermalCrawlService } from '../services/thermalCrawlService.js';
import type { AdminThermalPageRenderer } from '../views/admin/renderer.js';

const jobSchema = z.object({ name: z.string().trim().min(1).max(80), geometry: z.string().min(1).max(1_000_000) });
const statusSchema = z.object({ status: z.enum(['running', 'paused', 'cancelled']) });
const uuid = z.string().uuid();
const coordinate = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const viewportSchema = z.object({
  west: coordinate.pipe(z.number().min(-180).max(180)),
  south: coordinate.pipe(z.number().min(-90).max(90)),
  east: coordinate.pipe(z.number().min(-180).max(180)),
  north: coordinate.pipe(z.number().min(-90).max(90)),
}).strict().refine((bounds) => bounds.south < bounds.north && bounds.west !== bounds.east);

function polygon(value: string) {
  const parsed = JSON.parse(value) as { type?: string; coordinates?: unknown };
  if ((parsed.type !== 'Polygon' && parsed.type !== 'MultiPolygon') || !Array.isArray(parsed.coordinates)) throw new RangeError('Draw one valid target polygon.');
  return parsed as never;
}

export function createAdminThermalRouter(dependencies: {
  adminEmails: readonly string[];
  areas: ThermalAreaMapService;
  crawl: ThermalCrawlService;
  renderPage: AdminThermalPageRenderer;
}) {
  const router = Router();
  const adminEmails = new Set(dependencies.adminEmails.map((email) => email.trim().toLowerCase()));
  function requireAdmin(_req: Request, res: Response, next: NextFunction) {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !adminEmails.has(currentUser.email.trim().toLowerCase())) return next(new AppError(403, 'unauthorized', 'Admin access is required.'));
    next();
  }
  router.use('/admin/thermal', requireAdmin);
  router.use('/admin/api/thermal', requireAdmin);
  router.get('/admin/thermal', async (req, res, next) => {
    try {
      res.status(200).type('html').send(await dependencies.renderPage({
        currentUser: res.locals.currentUser!,
        jobs: await dependencies.crawl.list(),
        success: req.query.created === '1',
        error: typeof req.query.error === 'string' ? req.query.error : undefined,
      }));
    } catch (error) { next(error); }
  });
  router.post('/admin/thermal/jobs', async (req, res) => {
    const parsed = jobSchema.safeParse(req.body);
    if (!parsed.success) return res.redirect(303, '/admin/thermal?error=Enter+a+name+and+draw+one+target+polygon.');
    try {
      await dependencies.crawl.create({ name: parsed.data.name, geometry: polygon(parsed.data.geometry), userId: res.locals.currentUser!.userId });
      res.redirect(303, '/admin/thermal?created=1');
    } catch (error) {
      if (!(error instanceof RangeError)) console.error(error);
      const message = error instanceof RangeError ? error.message : 'Unable to create crawl job.';
      res.redirect(303, `/admin/thermal?error=${encodeURIComponent(message)}`);
    }
  });
  router.post('/admin/thermal/jobs/:jobId/status', async (req, res) => {
    const jobId = uuid.safeParse(req.params.jobId);
    const parsed = statusSchema.safeParse(req.body);
    if (jobId.success && parsed.success) await dependencies.crawl.setStatus(jobId.data, parsed.data.status);
    res.redirect(303, '/admin/thermal');
  });
  router.get('/admin/api/thermal/areas', async (req, res, next) => {
    const viewport = viewportSchema.safeParse(req.query);
    if (!viewport.success) {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Processed thermal areas require valid viewport bounds.' } });
      return;
    }
    try {
      const result = await dependencies.areas.getViewport(viewport.data);
      if (result.status === 'too_large') {
        res.status(422).json({ error: { code: 'thermal_viewport_too_large', message: 'Zoom in to view processed areas.' } });
        return;
      }
      res.status(200).type('application/geo+json').send(result.geojson);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
