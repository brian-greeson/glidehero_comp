import { Script, type GlideClient } from '@valkey/valkey-glide';
import { createPlanExportArtifact, type PlanExportFormat, type PlanExportVariant } from '../domain/plan/planExport.js';
import { AppError } from '../domain/errors.js';
import type { RoutePoint } from '../domain/thermal/thermalRoute.js';
import type { ElevationClient } from '../resources/mapTilerElevationClient.js';

export type PlanExportResult = { body: string; contentType: string; filename: string };

export interface PlanExportService {
  export(input: {
    userId: string;
    anchors: readonly RoutePoint[];
    route: readonly RoutePoint[];
    format: PlanExportFormat;
    variant: PlanExportVariant;
    prefix: string;
  }): Promise<PlanExportResult>;
}

export const PLAN_EXPORT_RATE_LIMIT = 10;
export const PLAN_EXPORT_RATE_WINDOW_SECONDS = 60;

type PlanExportValkey = Pick<GlideClient, 'invokeScript'>;

const consumeQuotaScript = new Script(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count
`);

const quotaKey = (userId: string) => `glidehero:plan-export-quota:${userId}`;

function decode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return Buffer.isBuffer(value) ? value.toString() : String(value);
}

export function createPlanExportService(elevations: ElevationClient, valkey: PlanExportValkey): PlanExportService {
  const cache = new Map<string, number>();
  const key = (point: RoutePoint) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
  return {
    async export(input) {
      const quota = Number(decode(await valkey.invokeScript(consumeQuotaScript, {
        keys: [quotaKey(input.userId)],
        args: [String(PLAN_EXPORT_RATE_WINDOW_SECONDS)],
      })));
      if (!Number.isFinite(quota) || quota > PLAN_EXPORT_RATE_LIMIT) {
        throw new AppError(429, 'invalid_request', 'Too many flight plan exports. Try again in a minute.');
      }
      const points = input.variant === 'main-turnpoints' ? input.anchors : input.route;
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
