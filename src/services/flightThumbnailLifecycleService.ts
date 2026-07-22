import { DeleteObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flights, trackPoints } from '../db/schema.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';
import {
  flightThumbnailKeys,
  type FlightThumbnailInput,
  type FlightThumbnailService,
  type ThumbnailCell,
} from './flightThumbnailService.js';

type ClaimRow = { x: number; y: number; kind: 'direct' | 'enclosed' };

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return value.name === 'NotFound'
    || value.name === 'NoSuchKey'
    || value.Code === 'NoSuchKey'
    || value.$metadata?.httpStatusCode === 404;
}

export interface FlightThumbnailLifecycleService {
  generateForFlight(flightId: string): Promise<void>;
  deleteForFlight(input: { userId: string; flightId: string }): Promise<void>;
}

export function createFlightThumbnailLifecycleService(
  database: Database,
  thumbnails: FlightThumbnailService,
  options: {
    cellSize: number;
    s3Client: Pick<S3, 'send'>;
    bucketName: string;
    bucketFolder: string;
    loadInput?: (flightId: string) => Promise<FlightThumbnailInput | null>;
  },
): FlightThumbnailLifecycleService {
  async function loadInput(flightId: string): Promise<FlightThumbnailInput | null> {
    const [flight] = await database
      .select({ userId: flights.userId })
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);
    if (!flight) return null;

    const claimResult = await database.execute<ClaimRow>(sql`
      ${gridClaimCandidateCtes({ flightId, cellSize: options.cellSize })}
      ,candidate_cells AS (
        SELECT x, y, 'direct'::text AS kind FROM direct_cells
        UNION ALL
        SELECT x, y, 'enclosed'::text AS kind FROM enclosed_candidates
      )
      SELECT candidate_cells.x, candidate_cells.y, candidate_cells.kind
      FROM candidate_cells
      INNER JOIN user_grid_claims personal
        ON personal.claim_flight = ${flightId}
        AND personal.x = candidate_cells.x
        AND personal.y = candidate_cells.y
      ORDER BY candidate_cells.kind, candidate_cells.x, candidate_cells.y
    `);
    const [startPoint] = await database
      .select({ sequenceNumber: trackPoints.sequenceNumber, latitude: trackPoints.latitude, longitude: trackPoints.longitude })
      .from(trackPoints)
      .where(eq(trackPoints.flightId, flightId))
      .orderBy(asc(trackPoints.sequenceNumber))
      .limit(1);
    if (!startPoint) throw new Error('Cannot generate a flight thumbnail without recorded track points.');
    const [endPoint] = await database
      .select({ sequenceNumber: trackPoints.sequenceNumber, latitude: trackPoints.latitude, longitude: trackPoints.longitude })
      .from(trackPoints)
      .where(eq(trackPoints.flightId, flightId))
      .orderBy(desc(trackPoints.sequenceNumber))
      .limit(1);
    const points = endPoint && endPoint.sequenceNumber !== startPoint.sequenceNumber
      ? [startPoint, endPoint]
      : [startPoint];
    const directCells: ThumbnailCell[] = [];
    const enclosedCells: ThumbnailCell[] = [];
    for (const claim of claimResult.rows) {
      (claim.kind === 'direct' ? directCells : enclosedCells).push({ x: claim.x, y: claim.y });
    }
    return {
      flightId,
      userId: flight.userId,
      directCells,
      enclosedCells,
      trackPoints: points,
    };
  }

  return {
    async generateForFlight(flightId) {
      const input = await (options.loadInput ?? loadInput)(flightId);
      if (!input) throw new Error('Cannot generate a thumbnail for an unknown flight.');
      await thumbnails.generate(input);
    },

    async deleteForFlight(input) {
      const keys = flightThumbnailKeys(options.bucketFolder, input.userId, input.flightId);
      let firstError: unknown;
      for (const key of [keys.wideKey, keys.squareKey]) {
        try {
          await options.s3Client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: key }));
        } catch (error) {
          if (isMissingObject(error)) continue;
          firstError ??= error;
          console.error('Unable to delete flight thumbnail object', { key, error: error instanceof Error ? error.message : 'unknown error' });
        }
      }
      if (firstError) throw firstError;
    },
  };
}
