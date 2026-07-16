import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { withServer } from '../support/http.js';

describe('server core', () => {
  it('serves a public health response', async () => {
    await withServer(createApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/up`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, app: 'GlideHero' });
    });
  });

  it('does not expose the Express signature header', async () => {
    await withServer(createApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/up`);
      expect(response.headers.get('x-powered-by')).toBeNull();
    });
  });

  it('uses the final Express middleware for HTML 404 and server-error pages', async () => {
    const renderErrorPage = vi.fn(async ({ status }: { status: number }) =>
      `<html><body>safe illustrated error ${status}</body></html>`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      renderErrorPage,
      webMiddleware: [async (req, _res, next) => {
        if (req.path === '/broken') throw new Error('sensitive route failure');
        next();
      }],
    });

    try {
      await withServer(app, async (baseUrl) => {
        const missing = await fetch(`${baseUrl}/missing`);
        expect(missing.status).toBe(404);
        expect(missing.headers.get('content-type')).toContain('text/html');
        expect(await missing.text()).toContain('safe illustrated error 404');

        const broken = await fetch(`${baseUrl}/broken`);
        expect(broken.status).toBe(500);
        expect(broken.headers.get('content-type')).toContain('text/html');
        const html = await broken.text();
        expect(html).toContain('safe illustrated error 500');
        expect(html).not.toContain('sensitive route failure');
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps unknown and failed API responses as JSON', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      webMiddleware: [async (req, _res, next) => {
        if (req.path === '/v1/broken') throw new Error('sensitive API failure');
        next();
      }],
    });

    try {
      await withServer(app, async (baseUrl) => {
        const missing = await fetch(`${baseUrl}/v1/missing`);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });

        const broken = await fetch(`${baseUrl}/v1/broken`);
        expect(broken.status).toBe(500);
        expect(await broken.json()).toEqual({
          error: { code: 'server_error', message: 'Internal server error.' },
        });
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('falls back to minimal safe HTML if the error template cannot render', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({
      renderErrorPage: async () => {
        throw new Error('template failure details');
      },
    });

    try {
      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/missing`);
        expect(response.status).toBe(500);
        const html = await response.text();
        expect(html).toContain('We hit a little turbulence.');
        expect(html).not.toContain('template failure details');
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
