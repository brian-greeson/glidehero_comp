import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import type { AdminAreaService } from '../services/adminAreaService.js';
import type { LocationLookupService } from '../services/locationLookupService.js';
import type { AdminAreaPageRenderer } from '../views/renderer.js';

const uuid = z.string().uuid();
const coordinate = z.coerce.number().finite();
const boundsSchema = z.object({
  west: coordinate.refine((value) => value >= -180 && value <= 180),
  south: coordinate.refine((value) => value >= -90 && value <= 90),
  east: coordinate.refine((value) => value >= -180 && value <= 180),
  north: coordinate.refine((value) => value >= -90 && value <= 90),
}).refine(({ south, north }) => south < north);
const lookupSchema = z.object({
  latitude: coordinate.refine((value) => value >= -90 && value <= 90),
  longitude: coordinate.refine((value) => value >= -180 && value <= 180),
});
const int32 = z.number().int().min(-2_147_483_648).max(2_147_483_647);
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
const saveSchema = z.object({
  name: z.string().trim().min(1).max(160),
  country: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  altitudeMeters: z.number().int().min(-500).max(10_000),
  timezone: z.string().trim().min(1).max(80).refine(isTimeZone),
  cells: z.array(z.object({
    x: int32,
    y: int32,
  })).min(1).max(10_000).superRefine((cells, context) => {
    const keys = new Set<string>();
    for (const [index, cell] of cells.entries()) {
      const key = `${cell.x}:${cell.y}`;
      if (keys.has(key)) context.addIssue({ code: 'custom', message: 'Cells must be unique.', path: [index] });
      keys.add(key);
    }
  }),
});

export function createAdminAreaRouter(dependencies: {
  adminEmails: readonly string[];
  areas: AdminAreaService;
  locations: LocationLookupService;
  renderPage: AdminAreaPageRenderer;
}) {
  const router = Router();
  const adminEmails = new Set(dependencies.adminEmails.map((email) => email.trim().toLowerCase()));

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !adminEmails.has(currentUser.email.trim().toLowerCase())) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    next();
  }

  router.use('/admin/areas', requireAdmin);
  router.use('/admin/api/areas', requireAdmin);
  router.use('/admin/api/location', requireAdmin);

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

  router.get('/admin/api/areas/grid', async (req, res, next) => {
    const parsed = boundsSchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(422, 'invalid_request', 'Enter valid map bounds.'));
      return;
    }
    try {
      res.type('application/geo+json').send(await dependencies.areas.grid(parsed.data));
    } catch (error) {
      if (error instanceof RangeError) {
        next(new AppError(422, 'invalid_request', error.message));
        return;
      }
      next(error);
    }
  });

  router.get('/admin/api/areas/:areaId', async (req, res, next) => {
    const areaId = uuid.safeParse(req.params.areaId);
    if (!areaId.success) {
      next(new AppError(422, 'invalid_request', 'Enter a valid area ID.'));
      return;
    }
    try {
      const area = await dependencies.areas.get(areaId.data);
      if (!area) {
        next(new AppError(404, 'invalid_request', 'Area not found.'));
        return;
      }
      res.json({ area });
    } catch (error) {
      next(error);
    }
  });

  router.get('/admin/api/location', async (req, res, next) => {
    const parsed = lookupSchema.safeParse(req.query);
    if (!parsed.success) {
      next(new AppError(422, 'invalid_request', 'Enter valid latitude and longitude values.'));
      return;
    }
    try {
      res.json({ location: await dependencies.locations.lookup(parsed.data) });
    } catch (error) {
      console.error('Unable to look up admin area location', error);
      next(new AppError(502, 'server_error', 'Location lookup is temporarily unavailable. Enter the values manually.'));
    }
  });

  router.post('/admin/api/areas', async (req, res, next) => {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError(422, 'invalid_request', 'Complete every field and paint at least one valid cell.'));
      return;
    }
    try {
      const area = await dependencies.areas.create(parsed.data);
      res.status(201).json({ area });
    } catch (error) {
      next(error);
    }
  });

  router.put('/admin/api/areas/:areaId', async (req, res, next) => {
    const areaId = uuid.safeParse(req.params.areaId);
    const parsed = saveSchema.safeParse(req.body);
    if (!areaId.success || !parsed.success) {
      next(new AppError(422, 'invalid_request', 'Complete every field and paint at least one valid cell.'));
      return;
    }
    try {
      const area = await dependencies.areas.update(areaId.data, parsed.data);
      if (!area) {
        next(new AppError(404, 'invalid_request', 'Area not found.'));
        return;
      }
      res.json({ area });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
