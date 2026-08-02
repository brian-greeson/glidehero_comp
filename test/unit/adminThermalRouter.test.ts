import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ThermalCrawlService } from '../../src/services/thermalCrawlService.js';
import type { ProcessedThermalAreaViewportResult, ThermalAreaMapService } from '../../src/services/thermalAreaMapService.js';
import { createAdminThermalRouter } from '../../src/web/adminThermalRouter.js';
import { withServer } from '../support/http.js';

const admin = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  email: 'admin@example.com', displayName: 'Admin', territoryColor: '#1769AA',
};
const geometry = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[-105.1, 39], [-105, 39], [-105, 39.1], [-105.1, 39.1], [-105.1, 39]]],
});

function setup(create: ThermalCrawlService['create'], areaResult: ProcessedThermalAreaViewportResult = {
  status: 'ok', geojson: { type: 'FeatureCollection', features: [] },
}, currentUser: typeof admin | null = admin) {
  const crawl: ThermalCrawlService = {
    list: vi.fn(async () => []), create,
    setStatus: vi.fn(async () => false), claimNext: vi.fn(async () => null),
    complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
  };
  const areas: ThermalAreaMapService = { getViewport: vi.fn(async () => areaResult) };
  const app = createApp({ webMiddleware: [
    (_req, res, next) => { if (currentUser) res.locals.currentUser = currentUser; next(); },
    createAdminThermalRouter({
      adminEmails: ['admin@example.com'], crawl,
      areas,
      renderPage: vi.fn(async () => '<html><body>Thermal crawler</body></html>'),
    }),
  ] });
  return { app, crawl, areas };
}

async function submit(baseUrl: string) {
  return fetch(`${baseUrl}/admin/thermal/jobs`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Front Range', geometry }),
  });
}

describe('admin thermal router', () => {
  it('requires admin access for processed area data', async () => {
    const { app, areas } = setup(vi.fn(async () => 'job-1'), undefined, null);
    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/admin/api/thermal/areas?west=-106&south=38&east=-104&north=40`)).status).toBe(403);
    });
    expect(areas.getViewport).not.toHaveBeenCalled();
  });

  it('returns current processed areas for a valid viewport', async () => {
    const areaResult: ProcessedThermalAreaViewportResult = { status: 'ok', geojson: { type: 'FeatureCollection', features: [] } };
    const { app, areas } = setup(vi.fn(async () => 'job-1'), areaResult);
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/api/thermal/areas?west=-106&south=38&east=-104&north=40`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/geo+json');
      expect(await response.json()).toEqual(areaResult.geojson);
    });
    expect(areas.getViewport).toHaveBeenCalledWith({ west: -106, south: 38, east: -104, north: 40 });
  });

  it('validates and bounds processed area viewport responses', async () => {
    const { app } = setup(vi.fn(async () => 'job-1'), { status: 'too_large' });
    await withServer(app, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/admin/api/thermal/areas?west=nope&south=38&east=-104&north=40`)).status).toBe(400);
      const large = await fetch(`${baseUrl}/admin/api/thermal/areas?west=-106&south=38&east=-104&north=40`);
      expect(large.status).toBe(422);
      expect(await large.json()).toEqual({ error: { code: 'thermal_viewport_too_large', message: 'Zoom in to view processed areas.' } });
    });
  });

  it('keeps expected crawl validation errors visible', async () => {
    const { app } = setup(vi.fn(async () => { throw new RangeError('Thermal crawl area is too large.'); }));
    await withServer(app, async (baseUrl) => {
      const response = await submit(baseUrl);
      expect(response.status).toBe(303);
      expect(new URL(response.headers.get('location')!, baseUrl).searchParams.get('error'))
        .toBe('Thermal crawl area is too large.');
    });
  });

  it('logs unexpected failures without exposing their query text', async () => {
    const error = new Error('Failed query: SELECT secret FROM thermal_crawl_jobs');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = setup(vi.fn(async () => { throw error; }));
    try {
      await withServer(app, async (baseUrl) => {
        const response = await submit(baseUrl);
        const location = new URL(response.headers.get('location')!, baseUrl);
        expect(response.status).toBe(303);
        expect(location.searchParams.get('error')).toBe('Unable to create crawl job.');
        expect(location.href).not.toContain('SELECT');
      });
      expect(log).toHaveBeenCalledWith(error);
    } finally {
      log.mockRestore();
    }
  });
});
