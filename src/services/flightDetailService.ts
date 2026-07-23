import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flightProgress, flightScores, flights, profiles, trackPoints } from '../db/schema.js';
import type { NPointDistanceMetadata, TotalDistanceMetadata } from '../db/schema.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';
import {
  loadFlightAccomplishments,
  type FlightAccomplishment,
} from './flightAccomplishmentService.js';

export type FlightDetailScore<TMetadata> = {
  distanceMeters: number;
  calcVersion: number;
  metadata: TMetadata;
};

export type FlightDetailSummary = {
  id: string;
  ownerUserId: string;
  ownerDisplayName: string;
  territoryColor: string;
  startedAt: Date | null;
  endedAt: Date | null;
  launchTimezone: string | null;
  durationSeconds: number | null;
  launchLatitude: number | null;
  launchLongitude: number | null;
  progress: {
    directCellCount: number;
    enclosedCellCount: number;
    newPersonalCellCount: number;
    personalCellTotalAfter: number;
  } | null;
  scores: {
    track: FlightDetailScore<TotalDistanceMetadata>;
    threePoint: FlightDetailScore<NPointDistanceMetadata> | null;
    fourPoint: FlightDetailScore<NPointDistanceMetadata> | null;
    fivePoint: FlightDetailScore<NPointDistanceMetadata> | null;
    sixPoint: FlightDetailScore<NPointDistanceMetadata> | null;
  } | null;
  accomplishments: FlightAccomplishment[];
};

export type FlightDetailTrackPoint = {
  sequenceNumber: number;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  gpsAltitudeMeters: number;
  pressureAltitudeMeters: number;
};

export type FlightDetailMapPoint = {
  latitude: number;
  longitude: number;
};

type PolygonGeometry = {
  type: 'Polygon';
  coordinates: number[][][];
};

export type FlightDetailCellFeature = {
  type: 'Feature';
  geometry: PolygonGeometry;
  properties: { x: number; y: number };
};

export type FlightDetailCellCollection = {
  type: 'FeatureCollection';
  features: FlightDetailCellFeature[];
};

export type FlightDetailMapData = {
  track: FlightDetailTrackPoint[];
  launch: FlightDetailMapPoint | null;
  landing: FlightDetailMapPoint | null;
  directCells: FlightDetailCellCollection;
  enclosedCells: FlightDetailCellCollection;
};

export interface FlightDetailService {
  getSummary(flightId: string): Promise<FlightDetailSummary | null>;
  getMapData(flightId: string): Promise<FlightDetailMapData | null>;
}

type StoredCell = {
  kind: 'direct' | 'enclosed';
  x: number;
  y: number;
  geometry: PolygonGeometry | string;
};

function score<TMetadata>(
  distanceMeters: number | null,
  calcVersion: number | null,
  metadata: TMetadata | null,
): FlightDetailScore<TMetadata> | null {
  if (distanceMeters === null || calcVersion === null || metadata === null) return null;
  return { distanceMeters, calcVersion, metadata };
}

function cellFeature(row: StoredCell): FlightDetailCellFeature {
  return {
    type: 'Feature',
    geometry: typeof row.geometry === 'string' ? JSON.parse(row.geometry) as PolygonGeometry : row.geometry,
    properties: { x: Number(row.x), y: Number(row.y) },
  };
}

export function createFlightDetailService(
  database: Database,
  options: { cellSize: number },
): FlightDetailService {
  return {
    async getSummary(flightId) {
      const [row] = await database
        .select({
          id: flights.id,
          ownerUserId: flights.userId,
          ownerDisplayName: profiles.displayName,
          territoryColor: profiles.territoryColor,
          startedAt: flights.startedAt,
          endedAt: flights.endedAt,
          launchTimezone: flights.launchTimezone,
          durationSeconds: flights.durationSeconds,
          launchLatitude: flights.launchLatitude,
          launchLongitude: flights.launchLongitude,
          directCellCount: flightProgress.directCellCount,
          enclosedCellCount: flightProgress.enclosedCellCount,
          newPersonalCellCount: flightProgress.newPersonalCellCount,
          personalCellTotalAfter: flightProgress.personalCellTotalAfter,
          totalDistanceMeters: flightScores.totalDistanceMeters,
          totalDistanceCalcVersion: flightScores.totalDistanceCalcVersion,
          totalDistanceMetadata: flightScores.totalDistanceMetadata,
          threePointDistanceMeters: flightScores.threePointDistanceMeters,
          threePointDistanceCalcVersion: flightScores.threePointDistanceCalcVersion,
          threePointDistanceMetadata: flightScores.threePointDistanceMetadata,
          fourPointDistanceMeters: flightScores.fourPointDistanceMeters,
          fourPointDistanceCalcVersion: flightScores.fourPointDistanceCalcVersion,
          fourPointDistanceMetadata: flightScores.fourPointDistanceMetadata,
          fivePointDistanceMeters: flightScores.fivePointDistanceMeters,
          fivePointDistanceCalcVersion: flightScores.fivePointDistanceCalcVersion,
          fivePointDistanceMetadata: flightScores.fivePointDistanceMetadata,
          sixPointDistanceMeters: flightScores.sixPointDistanceMeters,
          sixPointDistanceCalcVersion: flightScores.sixPointDistanceCalcVersion,
          sixPointDistanceMetadata: flightScores.sixPointDistanceMetadata,
        })
        .from(flights)
        .innerJoin(profiles, eq(profiles.userId, flights.userId))
        .leftJoin(flightProgress, eq(flightProgress.flightId, flights.id))
        .leftJoin(flightScores, eq(flightScores.flightId, flights.id))
        .where(and(eq(flights.id, flightId), eq(flights.processingStatus, 'completed')))
        .limit(1);
      if (!row) return null;

      const accomplishments = await loadFlightAccomplishments(database, [flightId]);
      const trackScore = score(row.totalDistanceMeters, row.totalDistanceCalcVersion, row.totalDistanceMetadata);
      return {
        id: row.id,
        ownerUserId: row.ownerUserId,
        ownerDisplayName: row.ownerDisplayName,
        territoryColor: row.territoryColor,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        launchTimezone: row.launchTimezone,
        durationSeconds: row.durationSeconds,
        launchLatitude: row.launchLatitude,
        launchLongitude: row.launchLongitude,
        progress: row.directCellCount === null
          ? null
          : {
              directCellCount: row.directCellCount,
              enclosedCellCount: row.enclosedCellCount ?? 0,
              newPersonalCellCount: row.newPersonalCellCount ?? 0,
              personalCellTotalAfter: row.personalCellTotalAfter ?? 0,
            },
        scores: trackScore
          ? {
              track: trackScore,
              threePoint: score(row.threePointDistanceMeters, row.threePointDistanceCalcVersion, row.threePointDistanceMetadata),
              fourPoint: score(row.fourPointDistanceMeters, row.fourPointDistanceCalcVersion, row.fourPointDistanceMetadata),
              fivePoint: score(row.fivePointDistanceMeters, row.fivePointDistanceCalcVersion, row.fivePointDistanceMetadata),
              sixPoint: score(row.sixPointDistanceMeters, row.sixPointDistanceCalcVersion, row.sixPointDistanceMetadata),
            }
          : null,
        accomplishments: accomplishments.get(flightId) ?? [],
      };
    },

    async getMapData(flightId) {
      const [flight] = await database
        .select({ id: flights.id, ownerUserId: flights.userId })
        .from(flights)
        .where(and(eq(flights.id, flightId), eq(flights.processingStatus, 'completed')))
        .limit(1);
      if (!flight) return null;

      const [track, cells] = await Promise.all([
        database
          .select({
            sequenceNumber: trackPoints.sequenceNumber,
            recordedAt: trackPoints.recordedAt,
            latitude: trackPoints.latitude,
            longitude: trackPoints.longitude,
            gpsAltitudeMeters: trackPoints.gpsAltitudeMeters,
            pressureAltitudeMeters: trackPoints.pressureAltitudeMeters,
          })
          .from(trackPoints)
          .where(eq(trackPoints.flightId, flightId))
          .orderBy(asc(trackPoints.sequenceNumber)),
        database.execute<StoredCell>(sql`
          ${gridClaimCandidateCtes({ flightId, cellSize: options.cellSize })}
          , candidate_cells AS (
            SELECT x, y, 'direct'::text AS kind, geometry
            FROM direct_cells
            UNION ALL
            SELECT x, y, 'enclosed'::text AS kind, ST_MakeEnvelope(
              x * ${options.cellSize},
              y * ${options.cellSize},
              (x + 1) * ${options.cellSize},
              (y + 1) * ${options.cellSize},
              6933
            ) AS geometry
            FROM enclosed_candidates
          )
          SELECT candidate.x, candidate.y, candidate.kind,
                 ST_AsGeoJSON(ST_Transform(candidate.geometry, 4326))::json AS geometry
          FROM candidate_cells candidate
          INNER JOIN user_grid_claims personal
            ON personal.claim_flight = ${flightId}
            AND personal.claim_user = ${flight.ownerUserId}
            AND personal.x = candidate.x
            AND personal.y = candidate.y
          ORDER BY candidate.kind, candidate.x, candidate.y
        `),
      ]);
      const first = track[0];
      const last = track.at(-1);
      const directFeatures: FlightDetailCellFeature[] = [];
      const enclosedFeatures: FlightDetailCellFeature[] = [];
      for (const row of cells.rows) {
        (row.kind === 'direct' ? directFeatures : enclosedFeatures).push(cellFeature(row));
      }
      return {
        track,
        launch: first ? { latitude: first.latitude, longitude: first.longitude } : null,
        landing: last ? { latitude: last.latitude, longitude: last.longitude } : null,
        directCells: { type: 'FeatureCollection', features: directFeatures },
        enclosedCells: { type: 'FeatureCollection', features: enclosedFeatures },
      };
    },
  };
}
