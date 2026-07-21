import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { AdminAreaService } from '../../src/services/adminAreaService.js';
import { createAdminAreaRouter } from '../../src/web/adminAreaRouter.js';
import { withServer } from '../support/http.js';

const admin = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'admin@example.com',
  displayName: 'Admin',
  territoryColor: '#1769AA',
};
const id = '00000000-0000-4000-8000-000000000010';
const area = {
  id,
  sourceId: 745,
  name: 'Boulder',
  country: 'United States',
  state: 'Colorado',
  city: 'Boulder',
  arenaType: 'general' as const,
  countryCode: 'US',
  componentCount: 1,
  geometry: { type: 'MultiPolygon' as const, coordinates: [] },
  bbox: [-106, 39, -105, 40] as [number, number, number, number],
};
const geojson = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };

function setup() {
  const areas: AdminAreaService = {
    list: vi.fn(async () => [area]),
    listCountryOptions: vi.fn(async () => [{ id: '00000000-0000-4000-8000-000000000011', sourceId: 3_000_000_001, name: 'United States', countryCode: 'US' }]),
    get: vi.fn(async () => area),
    create: vi.fn(async () => area),
    update: vi.fn(async () => area),
    preview: vi.fn(async () => ({ type: 'FeatureCollection' as const, features: [] })),
  };
  const router = createAdminAreaRouter({
    adminEmails: ['ADMIN@example.com'],
    areas,
    renderPage: vi.fn(async () => '<html><body>Arena editor</body></html>'),
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
  return { app, areas };
}

describe('admin Arena router', () => {
  it('protects the canonical page and API with admin access', async () => {
    const { app } = setup();
    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/admin/areas`)).status).toBe(403);
      expect((await fetch(`${baseUrl}/admin/api/areas`)).status).toBe(403);
    });
  });

  it('serves one page and canonical list, detail, save, and preview APIs', async () => {
    const { app, areas } = setup();
    await withServer(app, async (baseUrl) => {
      const headers = { 'x-admin': 'yes' };
      expect(await (await fetch(`${baseUrl}/admin/areas`, { headers })).text()).toContain('Arena editor');
      expect(await (await fetch(`${baseUrl}/admin/api/areas`, { headers })).json()).toEqual({ areas: [area] });
      expect(await (await fetch(`${baseUrl}/admin/api/areas/countries`, { headers })).json()).toEqual({ countries: [{ id: '00000000-0000-4000-8000-000000000011', sourceId: 3_000_000_001, name: 'United States', countryCode: 'US' }] });
      expect(await (await fetch(`${baseUrl}/admin/api/areas/${id}`, { headers })).json()).toEqual({ area });

      const countryArenaId = '00000000-0000-4000-8000-000000000011';
      const body = { name: 'Boulder', countryArenaId, state: '', city: '', geojson };
      expect((await fetch(`${baseUrl}/admin/api/areas`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
      })).status).toBe(201);
      expect(areas.create).toHaveBeenCalledWith(expect.objectContaining({ countryArenaId, state: '', city: '', geometries: [geojson] }));

      expect((await fetch(`${baseUrl}/admin/api/areas/preview`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ west: 0, south: 0, east: 1, north: 1, geojson }),
      })).status).toBe(200);
      expect(areas.preview).toHaveBeenCalled();
    });
  });

  it('rejects malformed and unresolved Country Arena identifiers', async () => {
    const { app, areas } = setup();
    vi.mocked(areas.create).mockRejectedValueOnce(new RangeError('Select a valid Country Arena.'));
    await withServer(app, async (baseUrl) => {
      const headers = { 'x-admin': 'yes', 'content-type': 'application/json' };
      const malformed = await fetch(`${baseUrl}/admin/api/areas`, { method: 'POST', headers, body: JSON.stringify({ name: 'Boulder', countryArenaId: 'not-a-uuid', geojson }) });
      expect(malformed.status).toBe(422);
      const unresolved = await fetch(`${baseUrl}/admin/api/areas`, { method: 'POST', headers, body: JSON.stringify({ name: 'Boulder', countryArenaId: id, geojson }) });
      expect(unresolved.status).toBe(422);
    });
  });

  it('removes the old grid and Large Arena routes without redirects', async () => {
    const { app } = setup();
    await withServer(app, async (baseUrl) => {
      const headers = { 'x-admin': 'yes' };
      expect((await fetch(`${baseUrl}/admin/areas/large`, { headers, redirect: 'manual' })).status).toBe(404);
      const large = await fetch(`${baseUrl}/admin/api/areas/large`, { headers });
      const grid = await fetch(`${baseUrl}/admin/api/areas/grid`, { headers });
      expect(large.status).toBe(404);
      expect(grid.status).toBe(404);
      expect(await large.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
      expect(await grid.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    });
  });
});
