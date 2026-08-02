import { Script, TimeUnit, type GlideClient } from '@valkey/valkey-glide';
import { randomUUID } from 'node:crypto';
import { createPlanExportArtifact, type PlanExportFormat, type PlanExportVariant } from '../domain/plan/planExport.js';
import { AppError } from '../domain/errors.js';
import type { RoutePoint } from '../domain/thermal/thermalRoute.js';
import type { ElevationClient } from '../resources/mapTilerElevationClient.js';

export type PlanExportResult = { body: string; contentType: string; filename: string };

export interface PlanExportService {
  authorize(input: { userId: string; anchors: readonly RoutePoint[]; route: readonly RoutePoint[] }): Promise<string>;
  export(input: {
    userId: string;
    exportToken: string;
    format: PlanExportFormat;
    variant: PlanExportVariant;
    prefix: string;
  }): Promise<PlanExportResult>;
}

export const PLAN_EXPORT_AUTHORIZATION_TTL_SECONDS = 15 * 60;
export const PLAN_EXPORT_RATE_LIMIT = 10;
export const PLAN_EXPORT_RATE_WINDOW_SECONDS = 60;

type Authorization = { userId: string; anchors: RoutePoint[]; route: RoutePoint[] };
type PlanExportValkey = Pick<GlideClient, 'get' | 'set' | 'invokeScript'>;

const consumeQuotaScript = new Script(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count
`);

const authorizationKey = (token: string) => `glidehero:plan-export:${token}`;
const quotaKey = (userId: string) => `glidehero:plan-export-quota:${userId}`;

function decode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return Buffer.isBuffer(value) ? value.toString() : String(value);
}

function isRoutePoint(value: unknown): value is RoutePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<RoutePoint>;
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

function parseAuthorization(value: unknown): Authorization | null {
  const raw = decode(value);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Authorization>;
    if (typeof parsed.userId !== 'string' || !Array.isArray(parsed.anchors) || !Array.isArray(parsed.route)) return null;
    if (parsed.anchors.length < 2 || parsed.route.length < 2) return null;
    if (!parsed.anchors.every(isRoutePoint) || !parsed.route.every(isRoutePoint)) return null;
    return { userId: parsed.userId, anchors: parsed.anchors, route: parsed.route };
  } catch {
    return null;
  }
}

export function createPlanExportService(elevations: ElevationClient, valkey: PlanExportValkey): PlanExportService {
  const cache = new Map<string, number>();
  const key = (point: RoutePoint) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
  return {
    async authorize(input) {
      const token = randomUUID();
      const authorization: Authorization = {
        userId: input.userId,
        anchors: [...input.anchors],
        route: [...input.route],
      };
      await valkey.set(authorizationKey(token), JSON.stringify(authorization), {
        expiry: { type: TimeUnit.Seconds, count: PLAN_EXPORT_AUTHORIZATION_TTL_SECONDS },
      });
      return token;
    },

    async export(input) {
      const authorization = parseAuthorization(await valkey.get(authorizationKey(input.exportToken)));
      if (!authorization || authorization.userId !== input.userId) {
        throw new RangeError('This route export has expired. Calculate the route again.');
      }
      const quota = Number(decode(await valkey.invokeScript(consumeQuotaScript, {
        keys: [quotaKey(input.userId)],
        args: [String(PLAN_EXPORT_RATE_WINDOW_SECONDS)],
      })));
      if (!Number.isFinite(quota) || quota > PLAN_EXPORT_RATE_LIMIT) {
        throw new AppError(429, 'invalid_request', 'Too many flight plan exports. Try again in a minute.');
      }
      const points = input.variant === 'main-turnpoints' ? authorization.anchors : authorization.route;
      const missing = points.filter((point, index, allPoints) => (
        !cache.has(key(point)) && allPoints.findIndex((candidate) => key(candidate) === key(point)) === index
      ));
      if (missing.length) {
        const resolved = await elevations.elevations(missing);
        if (resolved.length !== missing.length) throw new Error('Terrain elevation lookup returned an invalid result count.');
        missing.forEach((point, index) => cache.set(key(point), resolved[index]!));
        while (cache.size > 2_000) cache.delete(cache.keys().next().value!);
      }
      const artifact = createPlanExportArtifact({
        format: input.format,
        prefix: input.prefix.trim().toUpperCase(),
        points: points.map((point) => ({ ...point, elevationMeters: cache.get(key(point))! })),
      });
      return {
        body: artifact.body,
        contentType: artifact.contentType,
        filename: `glidehero-${input.variant}.${artifact.extension}`,
      };
    },
  };
}
