import { describe, expect, it, vi } from 'vitest';
import { createMapTilerElevationClient } from '../../src/resources/mapTilerElevationClient.js';

describe('MapTiler elevation client', () => {
  it('batches at 50 coordinates and preserves result order', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const locations = new URL(String(input)).pathname.slice('/elevation/'.length, -'.json'.length).split(';');
      return new Response(JSON.stringify(locations.map((location, index) => {
        const [longitude, latitude] = location.split(',').map(Number);
        return [longitude, latitude, index + 100];
      })), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = createMapTilerElevationClient({ apiKey: 'test-key', fetchImpl, baseUrl: 'https://maps.example.test' });
    const points = Array.from({ length: 51 }, (_, index) => ({ latitude: 39 + index / 1_000, longitude: -105 }));

    const result = await client.elevations(points);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(51);
    expect(result[0]).toBe(100);
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).searchParams.get('key')).toBe('test-key');
  });

  it('rejects malformed elevation responses', async () => {
    const client = createMapTilerElevationClient({
      apiKey: 'test-key', baseUrl: 'https://maps.example.test',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    });
    await expect(client.elevations([{ latitude: 39, longitude: -105 }])).rejects.toThrow('result count');
  });
});
