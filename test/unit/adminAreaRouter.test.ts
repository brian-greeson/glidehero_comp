import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { AdminAreaService } from '../../src/services/adminAreaService.js';
import type { LocationLookupService } from '../../src/services/locationLookupService.js';
import { createAdminAreaRouter } from '../../src/web/adminAreaRouter.js';
import { withServer } from '../support/http.js';

const admin = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'admin@example.com',
  displayName: 'Admin',
  territoryColor: '#1769AA',
};

function setup() {
  const areas: AdminAreaService = {
    list: vi.fn(async () => [{
      id: '00000000-0000-4000-8000-000000000010',
      sourceId: 745,
      name: 'Boulder',
      country: 'United States',
      state: 'Colorado',
    }]),
    get: vi.fn(async () => null),
    grid: vi.fn(async () => ({ type: 'FeatureCollection' as const, features: [] })),
    create: vi.fn(async () => ({ id: '00000000-0000-4000-8000-000000000011', sourceId: 10_000 })),
    update: vi.fn(async () => null),
    getLarge: vi.fn(async () => null),
    createLarge: vi.fn(async () => { throw new Error('not used'); }),
    updateLarge: vi.fn(async () => null),
    preview: vi.fn(async () => ({ type: 'FeatureCollection' as const, features: [] })),
  };
  const locations: LocationLookupService = {
    lookup: vi.fn(async () => ({
      country: 'United States', state: 'Colorado', city: 'Golden', altitudeMeters: 1842, timezone: 'America/Denver',
    })),
  };
  const router = createAdminAreaRouter({
    adminEmails: ['ADMIN@example.com'],
    areas,
    locations,
    renderPage: vi.fn(async () => '<html><body>Area editor</body></html>'),
  });
  const app = createApp({
    webMiddleware: [
      (req, res, next) => {
        res.locals.currentUser = req.header('x-admin') === 'yes' ? admin : null;
        res.locals.sessionToken = null;
        next();
      },
      router,
    ],
  });
  return { app, areas, locations };
}

const validArea = {
  name: 'Lookout',
  country: 'United States',
  state: 'Colorado',
  city: 'Golden',
  latitude: 39.75,
  longitude: -105.22,
  altitudeMeters: 1842,
  timezone: 'America/Denver',
  cells: [{ x: -10, y: 22 }],
};

describe('admin area router', () => {
  it('protects both the HTML editor and JSON API with admin access', async () => {
    const { app } = setup();
    await withServer(app, async (baseUrl) => {
      const page = await fetch(`${baseUrl}/admin/areas`);
      expect(page.status).toBe(403);
      expect(page.headers.get('content-type')).toContain('text/html');

      const api = await fetch(`${baseUrl}/admin/api/areas`);
      expect(api.status).toBe(403);
      expect(await api.json()).toEqual({ error: { code: 'unauthorized', message: 'Admin access is required.' } });
    });
  });

  it('serves the isolated page, area list, grid, and combined location lookup', async () => {
    const { app, areas, locations } = setup();
    await withServer(app, async (baseUrl) => {
      const headers = { 'x-admin': 'yes' };
      expect(await (await fetch(`${baseUrl}/admin/areas`, { headers })).text()).toContain('Area editor');
      expect(await (await fetch(`${baseUrl}/admin/api/areas`, { headers })).json()).toEqual({ areas: [expect.objectContaining({ name: 'Boulder' })] });

      const grid = await fetch(`${baseUrl}/admin/api/areas/grid?west=-106&south=39&east=-105&north=40`, { headers });
      expect(grid.status).toBe(200);
      expect(areas.grid).toHaveBeenCalledWith({ west: -106, south: 39, east: -105, north: 40 });

      const lookup = await fetch(`${baseUrl}/admin/api/location?latitude=39.75&longitude=-105.22`, { headers });
      expect(await lookup.json()).toEqual({ location: expect.objectContaining({ city: 'Golden' }) });
      expect(locations.lookup).toHaveBeenCalledWith({ latitude: 39.75, longitude: -105.22 });
    });
  });

  it('validates saves and never accepts an empty cell set', async () => {
    const { app, areas } = setup();
    await withServer(app, async (baseUrl) => {
      const headers = { 'x-admin': 'yes', 'content-type': 'application/json' };
      const invalid = await fetch(`${baseUrl}/admin/api/areas`, {
        method: 'POST', headers, body: JSON.stringify({ ...validArea, cells: [] }),
      });
      expect(invalid.status).toBe(422);
      expect(areas.create).not.toHaveBeenCalled();

      const created = await fetch(`${baseUrl}/admin/api/areas`, {
        method: 'POST', headers, body: JSON.stringify(validArea),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ area: { id: expect.any(String), sourceId: 10_000 } });
      expect(areas.create).toHaveBeenCalledWith(validArea);
    });
  });
});
