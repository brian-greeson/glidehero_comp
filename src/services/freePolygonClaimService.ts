import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flightAreas, personalTerritories } from '../db/schema.js';
import {
  emptyFreePolygonClaimGeoJson,
  type FreePolygonClaimGeoJson,
} from '../domain/territory/freePolygonClaimGeoJson.js';

const MINIMUM_CLAIM_AREA_SQUARE_METERS = 100;

export type FreePolygonClaimDetectionResult = {
  flightId: string;
  detectedAreaCount: number;
};

export interface FreePolygonClaimService {
  detect(input: { flightId: string }): Promise<FreePolygonClaimDetectionResult>;
  refresh(input: { userId: string }): Promise<FreePolygonClaimGeoJson>;
  get(input: { userId: string }): Promise<FreePolygonClaimGeoJson>;
  process(input: { flightId: string; userId: string }): Promise<FreePolygonClaimDetectionResult>;
}

type StoredProjection = { geojson: FreePolygonClaimGeoJson };

export function createFreePolygonClaimService(database: Database): FreePolygonClaimService {
  const detect = async ({ flightId }: { flightId: string }) => database.transaction(async (tx) => {
    await tx.delete(flightAreas).where(eq(flightAreas.flightId, flightId));

    const result = await tx.execute<{ detectedAreaCount: number }>(sql`
      WITH ordered_track AS (
        SELECT ST_MakeLine(
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
          ORDER BY sequence_number
        ) AS line
        FROM track_points
        WHERE flight_id = ${flightId}
      ),
      noded_segments AS (
        SELECT (ST_Dump(ST_Node(line))).geom AS segment
        FROM ordered_track
        WHERE ST_NPoints(line) >= 2
      ),
      polygonized AS (
        SELECT (ST_Dump(ST_Polygonize(segment))).geom AS geometry
        FROM noded_segments
      ),
      unioned AS (
        SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry
        FROM polygonized
      ),
      claims AS (
        SELECT (ST_Dump(ST_CollectionExtract(geometry, 3))).geom::geometry(Polygon, 4326) AS geometry
        FROM unioned
        WHERE NOT ST_IsEmpty(geometry)
      ),
      inserted AS (
        INSERT INTO flight_areas (flight_id, geometry, area_square_meters)
        SELECT ${flightId}, geometry, ST_Area(geometry::geography)
        FROM claims
        WHERE ST_Area(geometry::geography) >= ${MINIMUM_CLAIM_AREA_SQUARE_METERS}
        RETURNING flight_area_id
      )
      SELECT count(*)::integer AS "detectedAreaCount"
      FROM inserted
    `);

    return {
      flightId,
      detectedAreaCount: result.rows[0]?.detectedAreaCount ?? 0,
    };
  });

  const refresh = async ({ userId }: { userId: string }) => database.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))
    `);

    const result = await tx.execute<StoredProjection>(sql`
      WITH aggregate AS (
        SELECT ST_CollectionExtract(ST_UnaryUnion(ST_Collect(fa.geometry)), 3) AS geometry
        FROM flight_areas fa
        INNER JOIN flights f ON f.flight_id = fa.flight_id
        WHERE f.user_id = ${userId}
      ),
      normalized AS (
        SELECT ST_Multi(geometry)::geometry(MultiPolygon, 4326) AS geometry
        FROM aggregate
        WHERE geometry IS NOT NULL AND NOT ST_IsEmpty(geometry)
      ),
      projection AS (
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', jsonb_build_array(jsonb_build_object(
            'type', 'Feature',
            'properties', '{}'::jsonb,
            'geometry', ST_AsGeoJSON(geometry)::jsonb
          ))
        ) AS geojson
        FROM normalized
      )
      INSERT INTO personal_territories (user_id, geojson, updated_at)
      SELECT ${userId}, geojson, NOW()
      FROM projection
      ON CONFLICT (user_id) DO UPDATE
      SET geojson = EXCLUDED.geojson, updated_at = EXCLUDED.updated_at
      RETURNING geojson
    `);
    const stored = result.rows[0];
    if (stored) return stored.geojson;

    await tx.delete(personalTerritories).where(eq(personalTerritories.userId, userId));
    return emptyFreePolygonClaimGeoJson();
  });

  const get = async ({ userId }: { userId: string }) => {
    const [claim] = await database
      .select({ geojson: personalTerritories.geojson })
      .from(personalTerritories)
      .where(eq(personalTerritories.userId, userId))
      .limit(1);
    return claim?.geojson ?? emptyFreePolygonClaimGeoJson();
  };

  return {
    detect,
    refresh,
    get,
    async process({ flightId, userId }) {
      const result = await detect({ flightId });
      await refresh({ userId });
      return result;
    },
  };
}
