import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flightAreas } from '../db/schema.js';

const MINIMUM_CLAIM_AREA_SQUARE_METERS = 100;

export type FlightAreaDetectionResult = {
  flightId: string;
  detectedAreaCount: number;
};

export interface FlightAreaDetectionService {
  detect(input: { flightId: string }): Promise<FlightAreaDetectionResult>;
}

export function createFlightAreaDetectionService(database: Database): FlightAreaDetectionService {
  return {
    async detect({ flightId }) {
      return database.transaction(async (tx) => {
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
    },
  };
}
