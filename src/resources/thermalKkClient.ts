import {
  assertThermalTileCoordinate,
  isPng,
  THERMAL_MAX_TILE_BYTES,
  THERMAL_SOURCE_LAYER,
  type ThermalTileCoordinate,
} from '../domain/thermal/thermalTiles.js';

const THERMAL_KK_BASE_URL = 'https://thermal.kk7.ch';
const THERMAL_KK_TIMEOUT_MS = 15_000;

export type ThermalKkTile = {
  body: Buffer;
  contentType: 'image/png';
};

export interface ThermalKkClient {
  fetchTile(input: ThermalTileCoordinate): Promise<ThermalKkTile | null>;
}

export function createThermalKkClient(options: {
  sourceHostname: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): ThermalKkClient {
  const hostname = options.sourceHostname.trim();
  if (!hostname) throw new RangeError('Thermal.kk requests require a source hostname.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = new URL(options.baseUrl ?? THERMAL_KK_BASE_URL);
  if (baseUrl.protocol !== 'https:' || (options.baseUrl === undefined && baseUrl.hostname !== 'thermal.kk7.ch')) {
    throw new RangeError('Thermal.kk base URL must use HTTPS.');
  }

  return {
    async fetchTile(input) {
      assertThermalTileCoordinate(input);
      const url = new URL(`/tiles/${THERMAL_SOURCE_LAYER}/${input.zoom}/${input.x}/${input.tmsY}.png`, baseUrl);
      url.searchParams.set('src', hostname);
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? THERMAL_KK_TIMEOUT_MS),
        headers: { accept: 'image/png' },
      });
      if (response.status === 404 || response.status === 204) return null;
      if (!response.ok) throw new Error(`Thermal.kk returned HTTP ${response.status}.`);
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > THERMAL_MAX_TILE_BYTES) throw new Error('Thermal.kk tile exceeds the maximum allowed size.');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength === 0) return null;
      if (body.byteLength > THERMAL_MAX_TILE_BYTES) throw new Error('Thermal.kk tile exceeds the maximum allowed size.');
      if (!isPng(body)) throw new Error('Thermal.kk returned a non-PNG tile.');
      return { body, contentType: 'image/png' };
    },
  };
}
