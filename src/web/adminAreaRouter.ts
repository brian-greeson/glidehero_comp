import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { extractPolygonGeometries } from '../domain/arena/geoJson.js';
import { AppError } from '../domain/errors.js';
import type { AdminAreaService } from '../services/adminAreaService.js';
import type { AdminAreaPageRenderer } from '../views/renderer.js';

const uuid = z.string().uuid();
const saveSchema = z.object({
  name: z.string().trim().min(1).max(160),
  countryArenaId: uuid,
  state: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  geojson: z.unknown(),
});
const previewSchema = z.object({
  west: z.number().finite().min(-180).max(180),
  south: z.number().finite().min(-90).max(90),
  east: z.number().finite().min(-180).max(180),
  north: z.number().finite().min(-90).max(90),
  geojson: z.unknown(),
}).refine(({ south, north }) => south < north);

export function createAdminAreaRouter(dependencies: {
  adminEmails: readonly string[];
  areas: AdminAreaService;
  renderPage: AdminAreaPageRenderer;
}) {
  const router = Router();
  const adminEmails = new Set(dependencies.adminEmails.map((email) => email.trim().toLowerCase()));

  function requireAdmin(_req: Request, res: Response, next: NextFunction) {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !adminEmails.has(currentUser.email.trim().toLowerCase())) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    next();
  }

  router.use('/admin/areas', requireAdmin);
  router.use('/admin/api/areas', requireAdmin);

  router.get('/admin/areas', async (_req, res, next) => {
    try {
      res.status(200).type('html').send(await dependencies.renderPage({ currentUser: res.locals.currentUser! }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/api/areas', async (_req, res, next) => {
    try {
      res.json({ areas: await dependencies.areas.list() });
    } catch (error) {
      next(error);
    }
  });

  router.get(['/admin/api/areas/countries', '/admin/api/countries'], async (_req, res, next) => {
    try {
      res.json({ countries: await dependencies.areas.listCountryOptions() });
    } catch (error) {
      next(error);
    }
  });

  router.post('/admin/api/areas/preview', async (req, res, next) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError(422, 'invalid_request', 'Enter valid viewport bounds and polygon geometry.'));
      return;
    }
    try {
      const geometries = extractPolygonGeometries(parsed.data.geojson);
      if (!geometries.length) throw new TypeError('Add at least one polygon.');
      const { west, south, east, north } = parsed.data;
      res.type('application/geo+json').send(await dependencies.areas.preview(
        { west, south, east, north },
        geometries,
      ));
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        next(new AppError(422, 'invalid_request', error.message));
        return;
      }
      next(error);
    }
  });

  router.get(['/admin/api/areas/large', '/admin/api/areas/grid'], (_req, _res, next) => {
    next('router');
  });

  router.get('/admin/api/areas/:areaId', async (req, res, next) => {
    const areaId = uuid.safeParse(req.params.areaId);
    if (!areaId.success) {
      next(new AppError(422, 'invalid_request', 'Enter a valid Arena ID.'));
      return;
    }
    try {
      const area = await dependencies.areas.get(areaId.data);
      if (!area) {
        next(new AppError(404, 'invalid_request', 'Arena not found.'));
        return;
      }
      res.json({ area });
    } catch (error) {
      next(error);
    }
  });

  async function save(req: Request, res: Response, next: NextFunction, id?: string) {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError(422, 'invalid_request', 'Enter a name, Country Arena, and polygon geometry.'));
      return;
    }
    try {
      const geometries = extractPolygonGeometries(parsed.data.geojson);
      if (!geometries.length) throw new TypeError('Add at least one polygon.');
      const input = {
        name: parsed.data.name,
        countryArenaId: parsed.data.countryArenaId,
        state: parsed.data.state,
        city: parsed.data.city,
        geometries,
      };
      const area = id ? await dependencies.areas.update(id, input) : await dependencies.areas.create(input);
      if (!area) {
        next(new AppError(404, 'invalid_request', 'Arena not found.'));
        return;
      }
      res.status(id ? 200 : 201).json({ area });
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        next(new AppError(422, 'invalid_request', error.message));
        return;
      }
      next(error);
    }
  }

  router.post('/admin/api/areas', (req, res, next) => { void save(req, res, next); });
  router.put('/admin/api/areas/:areaId', (req, res, next) => {
    const areaId = uuid.safeParse(req.params.areaId);
    if (!areaId.success) {
      next(new AppError(422, 'invalid_request', 'Enter a valid Arena ID.'));
      return;
    }
    void save(req, res, next, areaId.data);
  });

  return router;
}
