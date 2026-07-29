import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import type { AdminFlightService, AdminUserFlightSort } from '../services/adminFlightService.js';
import type { AdminUserService } from '../services/adminUserService.js';
import type { AuthenticatedUser } from '../services/authService.js';
import type { UserHistoryRebuildService } from '../services/userHistoryRebuildService.js';
import type { AdminUserPageRenderer } from '../views/admin/renderer.js';

const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(320));
const displayName = z.string().trim().min(1).max(48);
const password = z.string().min(3).max(128);
const accountSchema = z.object({ email, displayName, q: z.string().optional() });
const createSchema = accountSchema.extend({ password, passwordConfirmation: password })
  .refine(({ password, passwordConfirmation }) => password === passwordConfirmation);
const passwordSchema = z.object({ password, passwordConfirmation: password, q: z.string().optional() })
  .refine(({ password, passwordConfirmation }) => password === passwordConfirmation);
const flightSortField = z.enum(['flightDate', 'uploadDate']);
const flightSortDirection = z.enum(['asc', 'desc']);

function formBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 200) : '';
}

function flightSort(values: Record<string, unknown>): AdminUserFlightSort {
  return {
    field: flightSortField.catch('uploadDate').parse(values.sort),
    direction: flightSortDirection.catch('desc').parse(values.direction),
  };
}

function userLocation(
  userId: string,
  search: string,
  status?: { kind: 'success' | 'error'; value: string },
  sort?: AdminUserFlightSort,
): string {
  const query = new URLSearchParams();
  if (search) query.set('q', search);
  if (status) query.set(status.kind, status.value);
  if (sort) {
    query.set('sort', sort.field);
    query.set('direction', sort.direction);
  }
  const suffix = query.toString();
  return `/admin/users/${userId}${suffix ? `?${suffix}` : ''}`;
}

function sortLocation(
  userId: string,
  search: string,
  field: AdminUserFlightSort['field'],
  current: AdminUserFlightSort,
): string {
  const direction = current.field === field && current.direction === 'asc' ? 'desc' : 'asc';
  return userLocation(userId, search, undefined, { field, direction });
}

function notice(query: Request['query']): { successMessage?: string; errorMessage?: string } {
  const success = typeof query.success === 'string' ? query.success : '';
  const error = typeof query.error === 'string' ? query.error : '';
  let successMessage = {
    created: 'User created.', updated: 'User updated.', password: 'Password updated and existing sessions revoked.',
    deleted: 'User deleted.', flight_deleted: 'Flight deleted.', reprocessed: 'Flight cells reprocessed.', activity_regenerated: 'Flight activity regenerated.',
    history_rebuilt: 'Achievement and Activity history rebuilt.',
  }[success];
  if (success === 'flights_deleted') {
    const count = (key: string) => {
      const value = typeof query[key] === 'string' ? Number(query[key]) : 0;
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    };
    successMessage = `Deleted ${count('deleted')} flights; skipped ${count('skipped')} active flights; ${count('failed')} failed.`;
  }
  const errorMessage = {
    invalid: 'Enter valid values and make sure the password fields match.',
    reprocess: 'That flight could not be reprocessed.',
    activity: 'That flight activity could not be regenerated.',
    processing: 'Processing flights cannot be managed in this release.',
    replay_active: 'Flights cannot be deleted while achievement history is being recalculated.',
    not_found: 'User not found.',
    duplicate_email: 'That email address already belongs to another user.',
    protected: 'The signed-in admin account is protected.',
    active_work: 'This user has uploading, queued, or processing flights and cannot be deleted yet.',
    no_completed_flights: 'This user has no completed flights to rebuild.',
    invalid_flight_history: 'Achievement and Activity history could not be rebuilt because a completed flight is missing its flight date.',
    history_rebuild_failed: 'Achievement and Activity history could not be rebuilt.',
  }[error];
  return { successMessage, errorMessage };
}

export function createAdminUserRouter(dependencies: {
  adminEmails: readonly string[];
  users: AdminUserService;
  flights: AdminFlightService;
  historyRebuild: UserHistoryRebuildService;
  renderPage: AdminUserPageRenderer;
}) {
  const router = Router();
  const adminEmails = new Set(dependencies.adminEmails.map((value) => value.trim().toLowerCase()));

  function requireAdmin(_req: Request, res: Response, next: NextFunction) {
    const currentUser = res.locals.currentUser;
    if (!currentUser || !adminEmails.has(currentUser.email.trim().toLowerCase())) {
      next(new AppError(403, 'unauthorized', 'Admin access is required.'));
      return;
    }
    next();
  }

  router.use('/admin/users', requireAdmin);

  async function renderUsers(
    req: Request,
    res: Response,
    currentUser: AuthenticatedUser,
    mode: 'empty' | 'create' | 'edit',
    userId?: string,
  ) {
    const search = queryValue(req.query.q);
    const sort = flightSort(req.query);
    const [users, selectedUser] = await Promise.all([
      dependencies.users.list(search),
      userId ? dependencies.users.get(userId) : undefined,
    ]);
    if (userId && !selectedUser) throw new AppError(404, 'invalid_request', 'User not found.');
    const flights = selectedUser ? await dependencies.flights.listUserFlights(selectedUser.id, sort) : [];
    res.status(200).type('html').send(await dependencies.renderPage({
      currentUser, users, selectedUser: selectedUser ?? undefined, flights,
      deletableFlightCount: flights.filter((flight) => !['pending', 'processing'].includes(flight.processingStatus)).length,
      completedFlightCount: flights.filter((flight) => flight.processingStatus === 'completed').length,
      search, searchParam: encodeURIComponent(search), mode, flightSort: sort,
      flightDateSortUrl: selectedUser ? sortLocation(selectedUser.id, search, 'flightDate', sort) : '',
      uploadDateSortUrl: selectedUser ? sortLocation(selectedUser.id, search, 'uploadDate', sort) : '',
      ...notice(req.query),
    }));
  }

  router.get('/admin/users', async (req, res, next) => {
    try { await renderUsers(req, res, res.locals.currentUser!, 'empty'); } catch (error) { next(error); }
  });

  router.get('/admin/users/new', async (req, res, next) => {
    try { await renderUsers(req, res, res.locals.currentUser!, 'create'); } catch (error) { next(error); }
  });

  router.get('/admin/users/:userId', async (req, res, next) => {
    const parsed = uuid.safeParse(req.params.userId);
    if (!parsed.success) { next(new AppError(404, 'invalid_request', 'User not found.')); return; }
    try { await renderUsers(req, res, res.locals.currentUser!, 'edit', parsed.data); } catch (error) { next(error); }
  });

  router.post('/admin/users', async (req, res, next) => {
    const parsed = createSchema.safeParse(formBody(req.body));
    const search = queryValue(formBody(req.body).q);
    if (!parsed.success) { res.redirect(303, `/admin/users/new?error=invalid${search ? `&q=${encodeURIComponent(search)}` : ''}`); return; }
    try {
      const result = await dependencies.users.create(parsed.data);
      if (result.status === 'completed' && result.userId) {
        res.redirect(303, userLocation(result.userId, search, { kind: 'success', value: 'created' }));
        return;
      }
      res.redirect(303, `/admin/users/new?error=${encodeURIComponent(result.status)}`);
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const parsed = accountSchema.safeParse(formBody(req.body));
    const search = queryValue(formBody(req.body).q);
    if (!userId.success || !parsed.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.users.update({ actorUserId: res.locals.currentUser!.userId, userId: userId.data, ...parsed.data });
      res.redirect(303, userLocation(userId.data, search, result === 'completed'
        ? { kind: 'success', value: 'updated' } : { kind: 'error', value: result }));
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId/password', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const parsed = passwordSchema.safeParse(formBody(req.body));
    const search = queryValue(formBody(req.body).q);
    if (!userId.success || !parsed.success) {
      res.redirect(303, userId.success ? userLocation(userId.data, search, { kind: 'error', value: 'invalid' }) : '/admin/users?error=invalid');
      return;
    }
    try {
      const result = await dependencies.users.setPassword({ actorUserId: res.locals.currentUser!.userId, userId: userId.data, password: parsed.data.password });
      res.redirect(303, userLocation(userId.data, search, result === 'completed'
        ? { kind: 'success', value: 'password' } : { kind: 'error', value: result }));
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId/delete', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const search = queryValue(formBody(req.body).q);
    if (!userId.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.users.delete({ actorUserId: res.locals.currentUser!.userId, userId: userId.data });
      if (result === 'completed') { res.redirect(303, `/admin/users?success=deleted${search ? `&q=${encodeURIComponent(search)}` : ''}`); return; }
      res.redirect(303, userLocation(userId.data, search, { kind: 'error', value: result }));
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId/history/rebuild', async (req, res) => {
    const userId = uuid.safeParse(req.params.userId);
    const body = formBody(req.body);
    const search = queryValue(body.q);
    const sort = flightSort(body);
    if (!userId.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.historyRebuild.rebuild(userId.data);
      res.redirect(303, userLocation(userId.data, search, result.status === 'completed'
        ? { kind: 'success', value: 'history_rebuilt' }
        : { kind: 'error', value: result.status }, sort));
    } catch (error) {
      console.error('Unable to rebuild user achievement and Activity history', { userId: userId.data, error });
      res.redirect(303, userLocation(
        userId.data,
        search,
        { kind: 'error', value: 'history_rebuild_failed' },
        sort,
      ));
    }
  });

  router.post('/admin/users/:userId/flights/:flightId/reprocess', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const flightId = uuid.safeParse(req.params.flightId);
    const body = formBody(req.body);
    const search = queryValue(body.q);
    const sort = flightSort(body);
    if (!userId.success || !flightId.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.flights.reprocessFlight({ userId: userId.data, flightId: flightId.data });
      res.redirect(303, userLocation(userId.data, search, result.status === 'completed'
        ? { kind: 'success', value: 'reprocessed' } : { kind: 'error', value: 'reprocess' }, sort));
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId/flights/:flightId/activity/regenerate', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const flightId = uuid.safeParse(req.params.flightId);
    const body = formBody(req.body);
    const search = queryValue(body.q);
    const sort = flightSort(body);
    if (!userId.success || !flightId.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.flights.regenerateActivity({ userId: userId.data, flightId: flightId.data });
      res.redirect(303, userLocation(userId.data, search, result === 'completed'
        ? { kind: 'success', value: 'activity_regenerated' } : { kind: 'error', value: 'activity' }, sort));
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId/flights/delete-all', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const body = formBody(req.body);
    const search = queryValue(body.q);
    const sort = flightSort(body);
    if (!userId.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.flights.deleteAllUserFlights(userId.data);
      const query = new URLSearchParams({
        success: 'flights_deleted',
        deleted: String(result.deleted),
        skipped: String(result.skipped),
        failed: String(result.failed),
      });
      if (search) query.set('q', search);
      query.set('sort', sort.field);
      query.set('direction', sort.direction);
      res.redirect(303, `/admin/users/${userId.data}?${query.toString()}`);
    } catch (error) { next(error); }
  });

  router.post('/admin/users/:userId/flights/:flightId/delete', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const flightId = uuid.safeParse(req.params.flightId);
    const body = formBody(req.body);
    const search = queryValue(body.q);
    const sort = flightSort(body);
    if (!userId.success || !flightId.success) { res.redirect(303, '/admin/users?error=invalid'); return; }
    try {
      const result = await dependencies.flights.deleteFlight({ userId: userId.data, flightId: flightId.data });
      res.redirect(303, userLocation(userId.data, search, result === 'processing' || result === 'replay_active'
        ? { kind: 'error', value: result } : { kind: 'success', value: 'flight_deleted' }, sort));
    } catch (error) { next(error); }
  });

  router.get('/admin/users/:userId/flights/:flightId/igc', async (req, res, next) => {
    const userId = uuid.safeParse(req.params.userId);
    const flightId = uuid.safeParse(req.params.flightId);
    if (!userId.success || !flightId.success) { next(new AppError(404, 'invalid_request', 'Flight not found.')); return; }
    try {
      const download = await dependencies.flights.createDownloadUrl({ userId: userId.data, flightId: flightId.data });
      if (!download) { next(new AppError(404, 'invalid_request', 'IGC file not found.')); return; }
      res.redirect(302, download.url);
    } catch (error) { next(error); }
  });

  return router;
}
