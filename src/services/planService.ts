import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  routeDistanceMeters,
  thermalGuidedLeg,
  type RoutePoint,
  type ThermalRouteCandidate,
} from '../domain/thermal/thermalRoute.js';

export type PlanCell = { x: number; y: number; geometry: { type: 'Polygon'; coordinates: number[][][] } };
export type PlanRouteResult = {
  anchors: RoutePoint[];
  route: RoutePoint[];
  legs: Array<{ directDistanceMeters: number; maximumDistanceMeters: number; routeDistanceMeters: number }>;
  directDistanceMeters: number;
  routeDistanceMeters: number;
  actualDeviationPercent: number;
  thermalCoverage: 'available' | 'unavailable';
  claims: {
    direct: PlanCell[];
    enclosed: PlanCell[];
    newPersonal: PlanCell[];
  };
};

export interface PlanService {
  route(input: { userId: string; anchors: RoutePoint[]; maximumDeviationPercent: number }): Promise<PlanRouteResult>;
}

type StoredCandidate = ThermalRouteCandidate;
type StoredCell = { x: number; y: number; source: 'direct' | 'enclosed'; isNewPersonal: boolean; geometry: PlanCell['geometry'] };
const MAXIMUM_LEG_DISTANCE_METERS = 1_000_000;
const MAXIMUM_PLAN_DISTANCE_METERS = 5_000_000;

function assertPoint(point: RoutePoint): void {
  if (!Number.isFinite(point.latitude) || point.latitude < -85 || point.latitude > 85) throw new RangeError('Plan latitude is invalid.');
  if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) throw new RangeError('Plan longitude is invalid.');
}

export function createPlanService(database: Database, options: { cellSize: number }): PlanService {
  async function candidates(start: RoutePoint, end: RoutePoint, maximumDeviationPercent: number): Promise<StoredCandidate[]> {
    if (maximumDeviationPercent <= 0) return [];
    const direct = routeDistanceMeters([start, end]);
    const searchDistance = Math.max(500, (direct * maximumDeviationPercent) / 200);
    const result = await database.execute<StoredCandidate>(sql`
      WITH route AS (
        SELECT ST_SetSRID(ST_MakeLine(
          ST_MakePoint(${start.longitude}, ${start.latitude}),
          ST_MakePoint(${end.longitude}, ${end.latitude})
        ), 4326) AS geometry
      )
      SELECT
        ST_Y(ST_PointOnSurface(area.geometry)) AS latitude,
        ST_X(ST_PointOnSurface(area.geometry)) AS longitude,
        area.relative_score AS "relativeScore",
        area.area_square_meters AS "areaSquareMeters"
      FROM thermal_areas area
      JOIN thermal_raster_tiles tile ON tile.id = area.raster_tile_id
      CROSS JOIN route
      WHERE tile.processing_status = 'complete'
        AND area.processing_version = tile.processing_version
        AND ST_DWithin(area.geometry::geography, route.geometry::geography, ${searchDistance})
      ORDER BY area.relative_score DESC, area.area_square_meters DESC
      LIMIT 80
    `);
    return result.rows.map((row) => ({
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      relativeScore: Number(row.relativeScore),
      areaSquareMeters: Number(row.areaSquareMeters),
    }));
  }

  async function claims(userId: string, points: RoutePoint[]): Promise<PlanRouteResult['claims']> {
    const input = points.map((point, sequence) => ({ ...point, sequence }));
    const result = await database.execute<StoredCell>(sql`
      WITH input_points AS (
        SELECT latitude, longitude, sequence
        FROM jsonb_to_recordset(${JSON.stringify(input)}::jsonb)
          AS point(latitude double precision, longitude double precision, sequence integer)
      ),
      segments AS (
        SELECT sequence AS segment_id,
          ST_Transform(ST_MakeLine(
            ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
            ST_SetSRID(ST_MakePoint(LEAD(longitude) OVER (ORDER BY sequence), LEAD(latitude) OVER (ORDER BY sequence)), 4326)
          ), 6933) AS segment
        FROM input_points
      ),
      densified AS (
        SELECT segment_id, ST_Segmentize(segment, ${options.cellSize}) AS segment
        FROM segments WHERE NOT ST_IsEmpty(segment)
      ),
      points AS (
        SELECT segment_id, dump.path[1] AS point_index, dump.geom AS point
        FROM densified CROSS JOIN LATERAL ST_DumpPoints(segment) dump
      ),
      split_segments AS (
        SELECT ST_MakeLine(point, LEAD(point) OVER (PARTITION BY segment_id ORDER BY point_index)) AS segment
        FROM points
      ),
      direct_hits AS (
        SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y
        FROM split_segments
        CROSS JOIN LATERAL ST_SquareGrid(${options.cellSize}, ST_Envelope(segment)) AS grid(geom, x, y)
        WHERE segment IS NOT NULL AND ST_Intersects(segment, grid.geom)
      ),
      direct_cells AS (
        SELECT x, y, ST_MakeEnvelope(
          x * ${options.cellSize}, y * ${options.cellSize},
          (x + 1) * ${options.cellSize}, (y + 1) * ${options.cellSize}, 6933
        ) AS geometry FROM direct_hits
      ),
      cell_union AS (
        SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry FROM direct_cells
      ),
      union_polygons AS (
        SELECT dump.geom AS geometry FROM cell_union CROSS JOIN LATERAL ST_Dump(cell_union.geometry) dump
      ),
      hole_rings AS (
        SELECT ST_ExteriorRing(dump.geom) AS geometry
        FROM union_polygons CROSS JOIN LATERAL ST_DumpRings(union_polygons.geometry) dump
        WHERE dump.path[1] > 0
      ),
      holes AS (SELECT ST_MakePolygon(geometry) AS geometry FROM hole_rings),
      enclosed AS (
        SELECT DISTINCT grid.x::integer AS x, grid.y::integer AS y, grid.geom AS geometry
        FROM holes
        CROSS JOIN LATERAL ST_SquareGrid(${options.cellSize}, ST_Envelope(holes.geometry)) AS grid(geom, x, y)
        WHERE ST_Covers(holes.geometry, grid.geom)
      ),
      candidates AS (
        SELECT x, y, geometry, 'direct'::text AS source FROM direct_cells
        UNION ALL
        SELECT enclosed.x, enclosed.y, enclosed.geometry, 'enclosed'::text AS source
        FROM enclosed LEFT JOIN direct_cells USING (x, y)
        WHERE direct_cells.x IS NULL
      )
      SELECT candidates.x, candidates.y, candidates.source,
        NOT EXISTS (
          SELECT 1 FROM user_grid_claims existing
          WHERE existing.claim_user = ${userId} AND existing.x = candidates.x AND existing.y = candidates.y
        ) AS "isNewPersonal",
        ST_AsGeoJSON(ST_Transform(candidates.geometry, 4326))::json AS geometry
      FROM candidates
      ORDER BY candidates.source, candidates.x, candidates.y
    `);
    const direct: PlanCell[] = [];
    const enclosed: PlanCell[] = [];
    const newPersonal: PlanCell[] = [];
    for (const row of result.rows) {
      const cell = { x: Number(row.x), y: Number(row.y), geometry: row.geometry };
      if (row.source === 'direct') direct.push(cell);
      else enclosed.push(cell);
      if (row.isNewPersonal) newPersonal.push(cell);
    }
    return { direct, enclosed, newPersonal };
  }

  return {
    async route(input) {
      if (!input.userId.trim()) throw new RangeError('Plan user is required.');
      if (!Number.isFinite(input.maximumDeviationPercent) || input.maximumDeviationPercent < 0 || input.maximumDeviationPercent > 100) {
        throw new RangeError('Maximum route deviation must be between 0 and 100 percent.');
      }
      if (input.anchors.length < 2 || input.anchors.length > 24) throw new RangeError('A plan requires between 2 and 24 anchors.');
      input.anchors.forEach(assertPoint);
      let totalDirectDistance = 0;
      for (let index = 1; index < input.anchors.length; index += 1) {
        const legDistance = routeDistanceMeters([input.anchors[index - 1]!, input.anchors[index]!]);
        if (legDistance < 1) throw new RangeError('Consecutive plan anchors must be distinct.');
        if (legDistance > MAXIMUM_LEG_DISTANCE_METERS) throw new RangeError('Each planned leg must be 1,000 km or shorter.');
        totalDirectDistance += legDistance;
      }
      if (totalDirectDistance > MAXIMUM_PLAN_DISTANCE_METERS) throw new RangeError('The complete planned route must be 5,000 km or shorter.');
      const route: RoutePoint[] = [];
      const legs: PlanRouteResult['legs'] = [];
      let candidateCount = 0;
      for (let index = 1; index < input.anchors.length; index += 1) {
        const start = input.anchors[index - 1]!;
        const end = input.anchors[index]!;
        const available = await candidates(start, end, input.maximumDeviationPercent);
        candidateCount += available.length;
        const leg = thermalGuidedLeg({ start, end, maximumDeviationPercent: input.maximumDeviationPercent, candidates: available });
        route.push(...(route.length ? leg.points.slice(1) : leg.points));
        legs.push({
          directDistanceMeters: leg.directDistanceMeters,
          maximumDistanceMeters: leg.maximumDistanceMeters,
          routeDistanceMeters: leg.routeDistanceMeters,
        });
      }
      const directDistanceMeters = totalDirectDistance;
      const generatedDistanceMeters = routeDistanceMeters(route);
      return {
        anchors: input.anchors,
        route,
        legs,
        directDistanceMeters,
        routeDistanceMeters: generatedDistanceMeters,
        actualDeviationPercent: directDistanceMeters > 0 ? ((generatedDistanceMeters / directDistanceMeters) - 1) * 100 : 0,
        thermalCoverage: candidateCount > 0 ? 'available' : 'unavailable',
        claims: await claims(input.userId, route),
      };
    },
  };
}
