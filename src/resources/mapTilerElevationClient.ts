import type { RoutePoint } from '../domain/thermal/thermalRoute.js';

const MAPTILER_ELEVATION_ORIGIN = 'https://api.maptiler.com';
const MAPTILER_ELEVATION_BATCH_SIZE = 50;
const MAPTILER_ELEVATION_TIMEOUT_MS = 15_000;

export interface ElevationClient {
  elevations(points: readonly RoutePoint[]): Promise<number[]>;
}

export function createMapTilerElevationClient(options: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): ElevationClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new RangeError('MapTiler elevation requests require an API key.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = new URL(options.baseUrl ?? MAPTILER_ELEVATION_ORIGIN);
  if (baseUrl.protocol !== 'https:' && options.baseUrl === undefined) throw new RangeError('MapTiler elevation URL must use HTTPS.');

  return {
    async elevations(points) {
      const elevations: number[] = [];
      for (let offset = 0; offset < points.length; offset += MAPTILER_ELEVATION_BATCH_SIZE) {
        const batch = points.slice(offset, offset + MAPTILER_ELEVATION_BATCH_SIZE);
        const locations = batch.map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(';');
        const url = new URL(`/elevation/${locations}.json`, baseUrl);
        url.searchParams.set('key', apiKey);
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(options.timeoutMs ?? MAPTILER_ELEVATION_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`MapTiler elevation returned HTTP ${response.status}.`);
        const body: unknown = await response.json();
        if (!Array.isArray(body) || body.length !== batch.length) throw new Error('MapTiler elevation returned an invalid result count.');
        for (const row of body) {
          if (!Array.isArray(row) || row.length !== 3 || !Number.isFinite(row[2])) {
            throw new Error('MapTiler elevation returned invalid coordinates.');
          }
          elevations.push(Number(row[2]));
        }
      }
      return elevations;
    },
  };
}
