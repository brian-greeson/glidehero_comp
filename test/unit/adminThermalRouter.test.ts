import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { ThermalCrawlService } from '../../src/services/thermalCrawlService.js';
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

function setup(create: ThermalCrawlService['create']) {
  const crawl: ThermalCrawlService = {
    list: vi.fn(async () => []), create,
    setStatus: vi.fn(async () => false), claimNext: vi.fn(async () => null),
    complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
  };
  const app = createApp({ webMiddleware: [
    (_req, res, next) => { res.locals.currentUser = admin; next(); },
    createAdminThermalRouter({
      adminEmails: ['admin@example.com'], crawl,
      renderPage: vi.fn(async () => '<html><body>Thermal crawler</body></html>'),
    }),
  ] });
  return { app, crawl };
}

async function submit(baseUrl: string) {
  return fetch(`${baseUrl}/admin/thermal/jobs`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Front Range', geometry }),
  });
}

describe('admin thermal router', () => {
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
