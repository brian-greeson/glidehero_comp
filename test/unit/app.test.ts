import { describe, expect, it } from 'vitest';
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
});
