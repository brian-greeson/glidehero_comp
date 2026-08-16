import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  buildFlightMapProjection,
  type FlightMapPoint,
  type FlightMapProjection,
} from '../domain/flightMap/flightMapGeometry.js';

export type FlightMapProjectionDatabase = Pick<Database, 'execute'>;

export function scoringProtectedSequenceNumbers(metadata: {
  threePointDistance?: { points?: readonly { sequenceNumber: number }[] };
  fourPointDistance?: { points?: readonly { sequenceNumber: number }[] };
  fivePointDistance?: { points?: readonly { sequenceNumber: number }[] };
  sixPointDistance?: { points?: readonly { sequenceNumber: number }[] };
} | undefined): Set<number> {
  const protectedSequenceNumbers = new Set<number>();
  if (!metadata) return protectedSequenceNumbers;
  for (const route of [
    metadata.threePointDistance,
    metadata.fourPointDistance,
    metadata.fivePointDistance,
    metadata.sixPointDistance,
  ]) {
    for (const point of route?.points ?? []) protectedSequenceNumbers.add(point.sequenceNumber);
  }
  return protectedSequenceNumbers;
}

/** Replaces one flight's rebuildable map projection without touching raw fixes. */
export async function storeFlightMapProjection(
  database: FlightMapProjectionDatabase,
  flightId: string,
  projection: FlightMapProjection,
): Promise<void> {
  const fullTrack = JSON.stringify(projection.fullTrack);
  await database.execute(sql`
    INSERT INTO flight_map_features (
      flight_id, projection_version, full_track, west, south, east, north,
      crosses_antimeridian, landing_latitude, landing_longitude,
      source_point_count, projected_at, updated_at
    ) VALUES (
      ${flightId}, ${projection.projectionVersion},
      ST_SetSRID(ST_GeomFromGeoJSON(${fullTrack}), 4326)::geometry(MultiLineString,4326),
      ${projection.bounds.west}, ${projection.bounds.south}, ${projection.bounds.east}, ${projection.bounds.north},
      ${projection.bounds.crossesAntimeridian}, ${projection.landingLatitude}, ${projection.landingLongitude},
      ${projection.sourcePointCount}, clock_timestamp(), clock_timestamp()
    )
    ON CONFLICT (flight_id) DO UPDATE SET
      projection_version = EXCLUDED.projection_version,
      full_track = EXCLUDED.full_track,
      west = EXCLUDED.west,
      south = EXCLUDED.south,
      east = EXCLUDED.east,
      north = EXCLUDED.north,
      crosses_antimeridian = EXCLUDED.crosses_antimeridian,
      landing_latitude = EXCLUDED.landing_latitude,
      landing_longitude = EXCLUDED.landing_longitude,
      source_point_count = EXCLUDED.source_point_count,
      projected_at = EXCLUDED.projected_at,
      updated_at = EXCLUDED.updated_at
  `);
  await database.execute(sql`DELETE FROM flight_map_geometry_lods WHERE flight_id = ${flightId}`);
  for (const lod of projection.lods) {
    const geometry = JSON.stringify(lod.geometry);
    await database.execute(sql`
      INSERT INTO flight_map_geometry_lods (
        flight_id, projection_version, min_zoom, max_zoom,
        tolerance_meters, geometry, point_count
      ) VALUES (
        ${flightId}, ${projection.projectionVersion}, ${lod.minZoom}, ${lod.maxZoom},
        ${lod.toleranceMeters},
        ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326)::geometry(MultiLineString,4326),
        ${lod.pointCount}
      )
    `);
  }
}

export async function projectFlightMapGeometry(
  database: FlightMapProjectionDatabase,
  input: {
    flightId: string;
    points: readonly FlightMapPoint[];
    protectedSequenceNumbers?: ReadonlySet<number>;
  },
): Promise<FlightMapProjection> {
  const projection = buildFlightMapProjection(input.points, input.protectedSequenceNumbers);
  await storeFlightMapProjection(database, input.flightId, projection);
  return projection;
}
