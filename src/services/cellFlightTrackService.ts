import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { normalizeCompetitionLeaderboardMonth } from '../domain/competition/competitionLeaderboardMonth.js';
import type { MonthlyCoveragePeriod } from './monthlyCoverageService.js';

type PolygonGeometry = {
  type: 'Polygon';
  coordinates: number[][][];
};

type LineStringGeometry = {
  type: 'LineString';
  coordinates: number[][];
};

export type CellFlightTrackResult = {
  cell: {
    type: 'Feature';
    properties: { cellId: string; x: number; y: number };
    geometry: PolygonGeometry;
  };
  tracks: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      properties: { flightId: string; pilotUserId: string };
      geometry: LineStringGeometry;
    }>;
  };
};

export interface CellFlightTrackService {
  getPersonal(input: {
    x: number;
    y: number;
    userId: string;
    period: MonthlyCoveragePeriod;
  }): Promise<CellFlightTrackResult>;
  getCompetition(input: {
    x: number;
    y: number;
    period: MonthlyCoveragePeriod;
    pilotUserId?: string;
  }): Promise<CellFlightTrackResult>;
}

type StoredCell = { geometry: PolygonGeometry };
type StoredTrack = {
  flightId: string;
  pilotUserId: string;
  geometry: LineStringGeometry;
};

function normalizePeriod(period: MonthlyCoveragePeriod): string | undefined {
  return 'competitionMonth' in period
    ? normalizeCompetitionLeaderboardMonth(period.competitionMonth)
    : undefined;
}

export function createCellFlightTrackService(
  database: Pick<Database, 'execute'>,
  options: { cellSize: number },
): CellFlightTrackService {
  const { cellSize } = options;

  async function cell(x: number, y: number) {
    const west = x * cellSize;
    const south = y * cellSize;
    const east = (x + 1) * cellSize;
    const north = (y + 1) * cellSize;
    const result = await database.execute<StoredCell>(sql`
      SELECT ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(
        ${west}::double precision,
        ${south}::double precision,
        ${east}::double precision,
        ${north}::double precision,
        6933
      ), 4326))::jsonb AS geometry
    `);
    const geometry = result.rows[0]?.geometry;
    if (!geometry) throw new Error('Unable to build selected cell geometry.');
    return {
      type: 'Feature' as const,
      properties: { cellId: `${cellSize}:${x}:${y}`, x, y },
      geometry,
    };
  }

  async function result(
    x: number,
    y: number,
    tracks: Promise<{ rows: StoredTrack[] }>,
  ): Promise<CellFlightTrackResult> {
    const [cellFeature, storedTracks] = await Promise.all([cell(x, y), tracks]);
    return {
      cell: cellFeature,
      tracks: {
        type: 'FeatureCollection',
        features: storedTracks.rows.map((track) => ({
          type: 'Feature',
          properties: {
            flightId: track.flightId,
            pilotUserId: track.pilotUserId,
          },
          geometry: track.geometry,
        })),
      },
    };
  }

  return {
    getPersonal(input) {
      const competitionMonth = normalizePeriod(input.period);
      const tracks = database.execute<StoredTrack>(sql`
        WITH candidate_flights AS (
          SELECT
            claim.claim_flight AS flight_id,
            claim.claim_user AS pilot_user_id,
            MAX(claim.claim_timestamp) AS claim_timestamp
          FROM user_grid_claims claim
          INNER JOIN flights flight ON flight.flight_id = claim.claim_flight
          WHERE claim.claim_user = ${input.userId}
            AND claim.x = ${input.x}
            AND claim.y = ${input.y}
            AND flight.processing_status = 'completed'
            ${competitionMonth
              ? sql`AND date_trunc(
                  'month',
                  claim.claim_timestamp AT TIME ZONE flight.launch_timezone
                )::date = ${competitionMonth}::date`
              : sql``}
          GROUP BY claim.claim_flight, claim.claim_user
        ),
        track_geometries AS (
          SELECT
            candidate.flight_id,
            candidate.pilot_user_id,
            candidate.claim_timestamp,
            ST_AsGeoJSON(ST_MakeLine(
              ST_SetSRID(ST_Point(point.longitude, point.latitude), 4326)
              ORDER BY point.sequence_number
            ))::jsonb AS geometry
          FROM candidate_flights candidate
          INNER JOIN track_points point ON point.flight_id = candidate.flight_id
          GROUP BY candidate.flight_id, candidate.pilot_user_id, candidate.claim_timestamp
          HAVING COUNT(*) >= 2
        )
        SELECT
          flight_id::text AS "flightId",
          pilot_user_id::text AS "pilotUserId",
          geometry
        FROM track_geometries
        ORDER BY claim_timestamp DESC, flight_id
      `);
      return result(input.x, input.y, tracks);
    },

    getCompetition(input) {
      const competitionMonth = normalizePeriod(input.period);
      const tracks = database.execute<StoredTrack>(sql`
        WITH ranked_claims AS (
          SELECT
            claim.claim_flight AS flight_id,
            claim.claim_user AS pilot_user_id,
            claim.claim_timestamp,
            ROW_NUMBER() OVER (
              PARTITION BY claim.claim_user
              ORDER BY claim.claim_timestamp DESC, claim.claim_flight DESC
            ) AS claim_rank
          FROM competition_grid_claims claim
          INNER JOIN flights flight ON flight.flight_id = claim.claim_flight
          WHERE claim.x = ${input.x}
            AND claim.y = ${input.y}
            AND flight.processing_status = 'completed'
            ${competitionMonth
              ? sql`AND claim.competition_month = ${competitionMonth}::date`
              : sql``}
            ${input.pilotUserId
              ? sql`AND claim.claim_user = ${input.pilotUserId}`
              : sql``}
        ),
        track_geometries AS (
          SELECT
            candidate.flight_id,
            candidate.pilot_user_id,
            candidate.claim_timestamp,
            ST_AsGeoJSON(ST_MakeLine(
              ST_SetSRID(ST_Point(point.longitude, point.latitude), 4326)
              ORDER BY point.sequence_number
            ))::jsonb AS geometry
          FROM ranked_claims candidate
          INNER JOIN track_points point ON point.flight_id = candidate.flight_id
          WHERE candidate.claim_rank = 1
          GROUP BY candidate.flight_id, candidate.pilot_user_id, candidate.claim_timestamp
          HAVING COUNT(*) >= 2
        )
        SELECT
          flight_id::text AS "flightId",
          pilot_user_id::text AS "pilotUserId",
          geometry
        FROM track_geometries
        ORDER BY claim_timestamp DESC, flight_id
      `);
      return result(input.x, input.y, tracks);
    },
  };
}
