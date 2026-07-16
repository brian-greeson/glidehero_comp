import { describe, expect, it, vi } from 'vitest';
import { createLocationLookupService } from '../../src/services/locationLookupService.js';

describe('locationLookupService', () => {
  it('combines the nearest address with elevation and IANA timezone', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === 'nominatim.openstreetmap.org') {
        expect(init?.headers).toMatchObject({
          'user-agent': 'GlideHero-Admin-Area-Editor/0.1',
        });
        return new Response(JSON.stringify({
          address: {
            country: 'United States',
            state: 'Colorado',
            town: 'Golden',
          },
        }), { status: 200 });
      }
      expect(url.hostname).toBe('api.open-meteo.com');
      expect(url.searchParams.get('timezone')).toBe('auto');
      return new Response(JSON.stringify({ elevation: 1841.6, timezone: 'America/Denver' }), { status: 200 });
    });
    const service = createLocationLookupService(fetchImpl as typeof fetch);

    await expect(service.lookup({ latitude: 39.75, longitude: -105.22 })).resolves.toEqual({
      country: 'United States',
      state: 'Colorado',
      city: 'Golden',
      altitudeMeters: 1842,
      timezone: 'America/Denver',
    });
  });

  it('spaces repeated Nominatim requests by at least one second', async () => {
    const delay = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(url.hostname === 'nominatim.openstreetmap.org'
        ? { address: { country: 'Switzerland', state: 'Bern', village: 'Kandersteg' } }
        : { elevation: 1200, timezone: 'Europe/Zurich' }), { status: 200 });
    });
    const service = createLocationLookupService(fetchImpl as typeof fetch, { now: () => 0, delay });

    await service.lookup({ latitude: 46.5, longitude: 7.7 });
    await service.lookup({ latitude: 46.6, longitude: 7.8 });

    expect(delay).toHaveBeenCalledWith(1000);
  });

  it('rejects incomplete external responses so the editor can fall back to manual entry', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(url.hostname === 'nominatim.openstreetmap.org'
        ? { address: {} }
        : { elevation: 1200, timezone: 'Europe/Zurich' }), { status: 200 });
    });

    await expect(createLocationLookupService(fetchImpl as typeof fetch)
      .lookup({ latitude: 46.5, longitude: 7.7 }))
      .rejects.toThrow('incomplete data');
  });
});
