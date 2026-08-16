import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  FLIGHT_LAUNCH_MATCH_RADIUS_METERS,
  hasValidFlightLaunchCoordinates,
  type FlightLaunchCoordinates,
} from '../domain/launch/flightLaunchMatch.js';

type QueryExecutor = Pick<Database, 'execute'>;

export type FlightLaunchMatch = {
  launchId: number | null;
  distanceMeters: number | null;
};

/**
 * Resolve semantic launch identity from the catalog point, never from the
 * generated Launch Arena polygon. ST_DWithin uses the functional geography
 * GiST index declared on launches; the exact distance and ID provide stable
 * ordering when more than one launch qualifies.
 */
export async function matchNearestCatalogLaunch(
  executor: QueryExecutor,
  coordinates: FlightLaunchCoordinates,
): Promise<FlightLaunchMatch> {
  if (!hasValidFlightLaunchCoordinates(coordinates)) {
    return { launchId: null, distanceMeters: null };
  }
  const origin = sql`ST_SetSRID(ST_MakePoint(${coordinates.longitude}, ${coordinates.latitude}), 4326)::geography`;
  const catalogPoint = sql`ST_SetSRID(ST_MakePoint(launch.longitude, launch.latitude), 4326)::geography`;
  const result = await executor.execute<{ launchId: number | string; distanceMeters: number | string }>(sql`
    SELECT launch.id AS "launchId",
      ST_Distance(${catalogPoint}, ${origin}) AS "distanceMeters"
    FROM launches launch
    WHERE ST_DWithin(${catalogPoint}, ${origin}, ${FLIGHT_LAUNCH_MATCH_RADIUS_METERS})
    ORDER BY ST_Distance(${catalogPoint}, ${origin}), launch.id
    LIMIT 1
  `);
  const match = result.rows[0];
  return match
    ? { launchId: Number(match.launchId), distanceMeters: Number(match.distanceMeters) }
    : { launchId: null, distanceMeters: null };
}
