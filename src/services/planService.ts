import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  createThermalRoutingField,
  planSampleSpacingMeters,
  routeDistanceMeters,
  thermalGuidedLeg,
  type RoutePoint,
  type RoutingPriority,
  type ThermalRoutingField,
} from '../domain/thermal/thermalRoute.js';
import { validatePlanTurnpoints } from '../domain/plan/planRouteValidation.js';

export type PlanRouteResult = {
  anchors: RoutePoint[];
  route: RoutePoint[];
  legs: Array<{ directDistanceMeters: number; maximumDistanceMeters: number; routeDistanceMeters: number }>;
  directDistanceMeters: number;
  maximumRouteDistanceMeters: number;
  routeDistanceMeters: number;
  actualExtraDistanceMeters: number;
  actualDeviationPercent: number;
  routingPriority: RoutingPriority;
  thermalCoverage: 'available' | 'unavailable';
};

export interface PlanService {
  route(input: { anchors: RoutePoint[]; routingPriority: RoutingPriority }): Promise<PlanRouteResult>;
}

type StoredSampleScore = { sampleIndex: number; relativeScore: number };
export function createPlanService(database: Database): PlanService {
  async function thermalScores(field: ThermalRoutingField): Promise<ReadonlyMap<number, number>> {
    const samples = field.samples.map((sample) => ({
      sampleIndex: sample.sampleIndex,
      latitude: sample.latitude,
      longitude: sample.longitude,
    }));
    const result = await database.execute<StoredSampleScore>(sql`
      WITH samples AS (
        SELECT "sampleIndex" AS sample_index, latitude, longitude
        FROM jsonb_to_recordset(${JSON.stringify(samples)}::jsonb)
          AS sample("sampleIndex" integer, latitude double precision, longitude double precision)
      )
      SELECT
        sample.sample_index AS "sampleIndex",
        COALESCE(activity.relative_score, 0)::double precision AS "relativeScore"
      FROM samples sample
      CROSS JOIN LATERAL (
        SELECT ST_SetSRID(ST_MakePoint(sample.longitude, sample.latitude), 4326) AS geometry
      ) point
      LEFT JOIN LATERAL (
        SELECT MAX(area.relative_score) AS relative_score
        FROM thermal_areas area
        JOIN thermal_raster_tiles tile ON tile.id = area.raster_tile_id
        WHERE tile.processing_status = 'complete'
          AND area.processing_version = tile.processing_version
          AND ST_Covers(area.geometry, point.geometry)
      ) activity ON TRUE
      ORDER BY sample.sample_index
    `);
    return new Map(result.rows.map((row) => [Number(row.sampleIndex), Number(row.relativeScore)]));
  }

  return {
    async route(input) {
      if (!['shorter', 'balanced', 'thermal'].includes(input.routingPriority)) throw new RangeError('Routing priority is invalid.');
      const totalDirectDistance = validatePlanTurnpoints(input.anchors);
      const route: RoutePoint[] = [];
      const legs: PlanRouteResult['legs'] = [];
      let candidateCount = 0;
      const targetSampleSpacingMeters = planSampleSpacingMeters(totalDirectDistance);
      for (let index = 1; index < input.anchors.length; index += 1) {
        const start = input.anchors[index - 1]!;
        const end = input.anchors[index]!;
        const field = createThermalRoutingField({
          start,
          end,
          routingPriority: input.routingPriority,
          targetSampleSpacingMeters,
        });
        const scores = await thermalScores(field);
        candidateCount += [...scores.values()].filter((score) => score > 0).length;
        const leg = thermalGuidedLeg({ field, relativeScores: scores });
        route.push(...(route.length ? leg.points.slice(1) : leg.points));
        legs.push({
          directDistanceMeters: leg.directDistanceMeters,
          maximumDistanceMeters: leg.maximumDistanceMeters,
          routeDistanceMeters: leg.routeDistanceMeters,
        });
      }
      const directDistanceMeters = totalDirectDistance;
      const maximumRouteDistanceMeters = legs.reduce((total, leg) => total + leg.maximumDistanceMeters, 0);
      const generatedDistanceMeters = routeDistanceMeters(route);
      const actualExtraDistanceMeters = Math.max(0, generatedDistanceMeters - directDistanceMeters);
      return {
        anchors: input.anchors,
        route,
        legs,
        directDistanceMeters,
        maximumRouteDistanceMeters,
        routeDistanceMeters: generatedDistanceMeters,
        actualExtraDistanceMeters,
        actualDeviationPercent: directDistanceMeters > 0 ? ((generatedDistanceMeters / directDistanceMeters) - 1) * 100 : 0,
        routingPriority: input.routingPriority,
        thermalCoverage: candidateCount > 0 ? 'available' : 'unavailable',
      };
    },
  };
}
