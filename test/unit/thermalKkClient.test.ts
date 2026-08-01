import { describe, expect, it, vi } from 'vitest';
import { createThermalKkClient } from '../../src/resources/thermalKkClient.js';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe('Thermal.kk client', () => {
  it('requests the fixed all-year layer with TMS coordinates and source hostname', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    const client = createThermalKkClient({ sourceHostname: 'glidehero.com', fetchImpl });
    await expect(client.fetchTile({ zoom: 12, x: 2144, tmsY: 1378 })).resolves.toMatchObject({ contentType: 'image/png' });
    const url = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/tiles/thermals_all_all/12/2144/1378.png');
    expect(url.searchParams.get('src')).toBe('glidehero.com');
  });

  it('treats missing tiles as empty and rejects non-PNG responses', async () => {
    const missing = createThermalKkClient({ sourceHostname: 'glidehero.com', fetchImpl: vi.fn(async () => new Response(null, { status: 404 })) });
    await expect(missing.fetchTile({ zoom: 12, x: 1, tmsY: 1 })).resolves.toBeNull();
    const invalid = createThermalKkClient({ sourceHostname: 'glidehero.com', fetchImpl: vi.fn(async () => new Response('html')) });
    await expect(invalid.fetchTile({ zoom: 12, x: 1, tmsY: 1 })).rejects.toThrow('non-PNG');
  });
});
