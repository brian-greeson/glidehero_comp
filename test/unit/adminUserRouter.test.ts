import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { AdminFlightService } from '../../src/services/adminFlightService.js';
import type { AdminUserService } from '../../src/services/adminUserService.js';
import { createAdminUserRouter } from '../../src/web/adminUserRouter.js';
import { withServer } from '../support/http.js';

const admin = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'admin@example.com', displayName: 'Admin', territoryColor: '#1769AA',
};
const pilotId = '00000000-0000-4000-8000-000000000010';
const flightId = '00000000-0000-4000-8000-000000000020';

function dependencies() {
  const users: AdminUserService = {
    list: vi.fn(async () => [{ id: pilotId, email: 'pilot@example.com', displayName: 'Pilot' }]),
    get: vi.fn(async () => ({
      id: pilotId, email: 'pilot@example.com', displayName: 'Pilot', hasPassword: true,
      lastLogin: new Date(), createdAt: new Date(), updatedAt: new Date(),
    })),
    create: vi.fn(async () => ({ status: 'completed' as const, userId: pilotId })),
    update: vi.fn(async () => 'completed' as const),
    setPassword: vi.fn(async () => 'completed' as const),
    delete: vi.fn(async () => 'completed' as const),
  };
  const flights: AdminFlightService = {
    listRecentFlights: vi.fn(async () => []),
    listUserFlights: vi.fn(async () => [{ id: flightId, flightDate: '2026-07-14', originalFilename: 'flight.igc', processingStatus: 'completed' as const }]),
    reprocessFlight: vi.fn(async () => ({ status: 'completed' as const, result: {
      flightId, cellSize: 1000, directCellCount: 1, enclosedCellCount: 0,
      newPersonalCellCount: 1, personalCellTotalAfter: 1, progressionVersion: 1,
      evaluatedAt: new Date('2026-07-20T00:00:00Z'),
      arenaAchievements: { newlyEarned: [], alreadyEarned: 0, record: null },
    } })),
    regenerateActivity: vi.fn(async () => 'completed' as const),
    deleteFlight: vi.fn(async () => 'deleted' as const),
    deleteAllUserFlights: vi.fn(async () => ({ deleted: 2, skipped: 1, failed: 1 })),
    createDownloadUrl: vi.fn(async () => ({ url: 'https://objects.example.test/download', filename: 'flight.igc' })),
  };
  const renderPage = vi.fn(async () => '<html><body>User management</body></html>');
  return { users, flights, renderPage };
}

function app(currentUser: typeof admin | null, deps: ReturnType<typeof dependencies>) {
  return createApp({ webMiddleware: [
    (_req, res, next) => { res.locals.currentUser = currentUser; next(); },
    createAdminUserRouter({ adminEmails: ['ADMIN@example.com'], ...deps }),
  ] });
}

describe('adminUserRouter', () => {
  it('requires configured admin access and renders searched user details', async () => {
    const deps = dependencies();
    await withServer(app(null, deps), async (baseUrl) => {
      expect((await fetch(`${baseUrl}/admin/users`)).status).toBe(403);
    });
    await withServer(app(admin, deps), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/users/${pilotId}?q=pilot%40example.com`);
      expect(response.status).toBe(200);
      expect(deps.users.list).toHaveBeenCalledWith('pilot@example.com');
      expect(deps.flights.listUserFlights).toHaveBeenCalledWith(pilotId);
      expect(deps.renderPage).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'edit', search: 'pilot@example.com', deletableFlightCount: 1,
      }));

      await fetch(`${baseUrl}/admin/users/${pilotId}?success=flights_deleted&deleted=2&skipped=1&failed=1`);
      expect(deps.renderPage).toHaveBeenLastCalledWith(expect.objectContaining({
        successMessage: 'Deleted 2 flights; skipped 1 active flights; 1 failed.',
      }));
    });
  });

  it('validates account creation and routes password changes through the acting admin', async () => {
    const deps = dependencies();
    await withServer(app(admin, deps), async (baseUrl) => {
      const headers = { 'content-type': 'application/x-www-form-urlencoded' };
      const created = await fetch(`${baseUrl}/admin/users`, {
        method: 'POST', redirect: 'manual', headers,
        body: new URLSearchParams({ email: 'Pilot@Example.com', displayName: 'Pilot', password: 'secret', passwordConfirmation: 'secret' }),
      });
      expect(created.status).toBe(303);
      expect(deps.users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'pilot@example.com', displayName: 'Pilot' }));

      const reset = await fetch(`${baseUrl}/admin/users/${pilotId}/password`, {
        method: 'POST', redirect: 'manual', headers,
        body: new URLSearchParams({ password: 'replacement', passwordConfirmation: 'replacement' }),
      });
      expect(reset.status).toBe(303);
      expect(deps.users.setPassword).toHaveBeenCalledWith({ actorUserId: admin.userId, userId: pilotId, password: 'replacement' });

      const removed = await fetch(`${baseUrl}/admin/users/${pilotId}/delete`, { method: 'POST', redirect: 'manual' });
      expect(removed.status).toBe(303);
      expect(deps.users.delete).toHaveBeenCalledWith({ actorUserId: admin.userId, userId: pilotId });
    });
  });

  it('binds flight actions and downloads to both the selected user and flight', async () => {
    const deps = dependencies();
    await withServer(app(admin, deps), async (baseUrl) => {
      const removed = await fetch(`${baseUrl}/admin/users/${pilotId}/flights/${flightId}/delete`, { method: 'POST', redirect: 'manual' });
      expect(removed.status).toBe(303);
      expect(deps.flights.deleteFlight).toHaveBeenCalledWith({ userId: pilotId, flightId });
      const bulkRemoved = await fetch(`${baseUrl}/admin/users/${pilotId}/flights/delete-all`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ q: 'pilot@example.com' }),
      });
      expect(bulkRemoved.status).toBe(303);
      expect(deps.flights.deleteAllUserFlights).toHaveBeenCalledWith(pilotId);
      expect(bulkRemoved.headers.get('location')).toBe(
        `/admin/users/${pilotId}?success=flights_deleted&deleted=2&skipped=1&failed=1&q=pilot%40example.com`,
      );
      const download = await fetch(`${baseUrl}/admin/users/${pilotId}/flights/${flightId}/igc`, { redirect: 'manual' });
      expect(download.status).toBe(302);
      expect(download.headers.get('location')).toBe('https://objects.example.test/download');

      const activity = await fetch(`${baseUrl}/admin/users/${pilotId}/flights/${flightId}/activity/regenerate`, {
        method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ q: 'pilot@example.com' }),
      });
      expect(activity.status).toBe(303);
      expect(activity.headers.get('location')).toBe(`/admin/users/${pilotId}?success=activity_regenerated&q=pilot%40example.com`);
      expect(deps.flights.regenerateActivity).toHaveBeenCalledWith({ userId: pilotId, flightId });
    });
  });
});
