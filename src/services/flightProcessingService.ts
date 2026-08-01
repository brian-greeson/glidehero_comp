import { GetObjectCommand, type S3 } from '@aws-sdk/client-s3';
import { and, DrizzleQueryError, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { flightScores, flights, trackPoints, profiles, userWorkflowState } from '../db/schema.js';
import { resolveLaunchTimeZone } from '../domain/competition/launchTimeZone.js';
import {
  FIVE_POINT_DISTANCE_CALC_VERSION,
  FOUR_POINT_DISTANCE_CALC_VERSION,
  mapNPointDistanceMetadata,
  THREE_POINT_DISTANCE_CALC_VERSION,
  SIX_POINT_DISTANCE_CALC_VERSION,
  TOTAL_DISTANCE_CALC_VERSION,
  type NPointDistances,
} from '../domain/igc/distance.js';
import { IgcParseError } from '../domain/igc/errors.js';
import { parseIgcFlight } from '../domain/igc/parseIgcFlight.js';
import { calculateNPointDistancesInWorker } from '../domain/igc/nPointDistanceWorkerAdapter.js';
import { createActivityService } from './activityService.js';
import { createGridClaimService } from './gridClaimService.js';
import type { UserAchievementProgressService } from './userAchievementProgressService.js';
import type { UserArenaProgressService } from './userArenaProgressService.js';
import { lockArenaCatalogShared } from './arenaCatalogLock.js';

const TRACK_POINT_INSERT_BATCH_SIZE = 1_000;
export const duplicateFlightMessage = 'This flight has already been uploaded.';
class ProcessingFenceLostError extends Error {}

export type FlightProcessingOutcome =
  | { status: 'completed'; flightId: string }
  | { status: 'failed'; flightId: string; message: string }
  | { status: 'superseded'; flightId: string }
  | { status: 'duplicate'; message: typeof duplicateFlightMessage };

export type FlightProcessingPolicy = {
  evaluateAchievements?: boolean;
  publishActivity?: boolean;
  markDirtyBoundary?: boolean;
};

export interface FlightProcessingService {
  process(input: {
    ownerUserId: string;
    igcFileId: string;
    bucketKey: string;
    contentHash: string;
    processingToken: string;
    flightId?: string;
    source?: string;
    policy?: FlightProcessingPolicy;
  }): Promise<FlightProcessingOutcome>;
}

function isContentHashConflict(error: unknown): boolean {
  const databaseError = error instanceof DrizzleQueryError ? error.cause : error;
  return typeof databaseError === 'object'
    && databaseError !== null
    && 'code' in databaseError
    && databaseError.code === '23505'
    && 'constraint' in databaseError
    && databaseError.constraint === 'flights_content_hash_unique';
}

function parserMessage(error: IgcParseError): string {
  if (error.code === 'insufficient_fixes') return 'This IGC file has no valid GPS fixes to process.';
  if (error.code === 'missing_date' || error.code === 'invalid_date') {
    return 'This IGC file is missing a usable flight date.';
  }
  return 'This IGC file is not a valid flight track.';
}

export function createFlightProcessingService(
  database: Database,
  options: {
    s3Client: Pick<S3, 'send'>;
    bucketName: string;
    gridClaimCellSize: number;
    userAchievementProgress?: UserAchievementProgressService;
    userArenaProgress?: UserArenaProgressService;
    calculateNPointDistances?: (points: readonly {
      latitude: number;
      longitude: number;
    }[]) => Promise<NPointDistances>;
    isNPointSolverEnabled?: () => Promise<boolean>;
  },
): FlightProcessingService {
  const gridClaim = options.userAchievementProgress || options.userArenaProgress
    ? createGridClaimService(
      database,
      { cellSize: options.gridClaimCellSize },
      undefined,
      undefined,
      undefined,
      options.userAchievementProgress,
      options.userArenaProgress,
    )
    : createGridClaimService(database, { cellSize: options.gridClaimCellSize });
  const activity = createActivityService();
  const calculateNPointDistances = options.calculateNPointDistances ?? calculateNPointDistancesInWorker;

  async function fail(flightId: string, processingToken: string, message: string): Promise<FlightProcessingOutcome> {
    const updated = await database
      .update(flights)
      .set({ processingStatus: 'failed', processingToken: null, processingError: message })
      .where(and(eq(flights.id, flightId), eq(flights.processingStatus, 'processing'), eq(flights.processingToken, processingToken)))
      .returning({ id: flights.id });
    if (!updated.length) return { status: 'superseded', flightId };
    return { status: 'failed', flightId, message };
  }

  return {
    async process(input) {
      const nPointSolverEnabled = await (options.isNPointSolverEnabled?.() ?? Promise.resolve(true));
      let flight: { id: string } | undefined;
      if (input.flightId) {
        [flight] = await database
          .update(flights)
          .set({ processingStatus: 'processing', processingToken: input.processingToken, processingError: null })
          .where(and(
            eq(flights.id, input.flightId),
            eq(flights.userId, input.ownerUserId),
            eq(flights.igcFileId, input.igcFileId),
            eq(flights.processingStatus, 'pending'),
          ))
          .returning({ id: flights.id });
      } else {
        try {
          [flight] = await database
            .insert(flights)
            .values({ userId: input.ownerUserId, igcFileId: input.igcFileId, contentHash: input.contentHash, processingToken: input.processingToken })
            .returning({ id: flights.id });
        } catch (error) {
          if (isContentHashConflict(error)) return { status: 'duplicate', message: duplicateFlightMessage };
          throw error;
        }
      }
      if (!flight) {
        if (input.flightId) return { status: 'superseded', flightId: input.flightId };
        throw new Error('Flight insert returned no row.');
      }

      let source = input.source;
      if (source === undefined) {
        try {
          const object = await options.s3Client.send(
            new GetObjectCommand({ Bucket: options.bucketName, Key: input.bucketKey }),
          );
          if (!object.Body) {
            return fail(flight.id, input.processingToken, 'We could not read your uploaded IGC file. Please upload it again.');
          }
          source = await object.Body.transformToString();
        } catch (error) {
          console.error('Unable to read uploaded IGC file', error);
          return fail(flight.id, input.processingToken, 'We could not read your uploaded IGC file. Please upload it again.');
        }
      }

      let parsed;
      try {
        parsed = parseIgcFlight(source);
      } catch (error) {
        return fail(
          flight.id,
          input.processingToken,
          error instanceof IgcParseError ? parserMessage(error) : 'This IGC file is not a valid flight track.',
        );
      }

      const launchTimezone = resolveLaunchTimeZone({
        latitude: parsed.launchLatitude,
        longitude: parsed.launchLongitude,
      });
      const nPointDistances = nPointSolverEnabled
        ? await calculateNPointDistances(parsed.points)
        : undefined;
      const nPointDistanceMetadata = nPointDistances
        ? mapNPointDistanceMetadata(parsed.points, nPointDistances)
        : undefined;

      try {
        await database.transaction(async (tx) => {
          await lockArenaCatalogShared(tx);
          const fenced = await tx
            .update(flights)
            .set({
              startedAt: parsed.startedAt,
              endedAt: parsed.endedAt,
              durationSeconds: parsed.durationSeconds,
              distanceMeters: parsed.distanceMeters,
              launchGpsAltitudeMeters: parsed.launchGpsAltitudeMeters,
              minGpsAltitudeMeters: parsed.minGpsAltitudeMeters,
              maxGpsAltitudeMeters: parsed.maxGpsAltitudeMeters,
              launchLatitude: parsed.launchLatitude,
              launchLongitude: parsed.launchLongitude,
              launchTimezone,
            })
            .where(and(
              eq(flights.id, flight.id),
              eq(flights.processingStatus, 'processing'),
              eq(flights.processingToken, input.processingToken),
            ))
            .returning({ id: flights.id });
          if (!fenced.length) throw new ProcessingFenceLostError();
          await tx.insert(flightScores).values({
            flightId: flight.id,
            totalDistanceMeters: parsed.distanceMeters,
            totalDistanceCalcVersion: TOTAL_DISTANCE_CALC_VERSION,
            totalDistanceMetadata: {},
            threePointDistanceMeters: nPointDistances?.threePointDistance.distanceMeters ?? null,
            threePointDistanceCalcVersion: nPointDistances ? THREE_POINT_DISTANCE_CALC_VERSION : null,
            threePointDistanceMetadata: nPointDistanceMetadata
              ? {
                  ...nPointDistanceMetadata.threePointDistance,
                  points: [...nPointDistanceMetadata.threePointDistance.points],
                }
              : null,
            fourPointDistanceMeters: nPointDistances?.fourPointDistance.distanceMeters ?? null,
            fourPointDistanceCalcVersion: nPointDistances ? FOUR_POINT_DISTANCE_CALC_VERSION : null,
            fourPointDistanceMetadata: nPointDistanceMetadata
              ? {
                  ...nPointDistanceMetadata.fourPointDistance,
                  points: [...nPointDistanceMetadata.fourPointDistance.points],
                }
              : null,
            fivePointDistanceMeters: nPointDistances?.fivePointDistance.distanceMeters ?? null,
            fivePointDistanceCalcVersion: nPointDistances ? FIVE_POINT_DISTANCE_CALC_VERSION : null,
            fivePointDistanceMetadata: nPointDistanceMetadata
              ? {
                  ...nPointDistanceMetadata.fivePointDistance,
                  points: [...nPointDistanceMetadata.fivePointDistance.points],
                }
              : null,
            sixPointDistanceMeters: nPointDistances?.sixPointDistance.distanceMeters ?? null,
            sixPointDistanceCalcVersion: nPointDistances ? SIX_POINT_DISTANCE_CALC_VERSION : null,
            sixPointDistanceMetadata: nPointDistanceMetadata
              ? {
                  ...nPointDistanceMetadata.sixPointDistance,
                  points: [...nPointDistanceMetadata.sixPointDistance.points],
                }
              : null,
          });
          for (let start = 0; start < parsed.points.length; start += TRACK_POINT_INSERT_BATCH_SIZE) {
            await tx
              .insert(trackPoints)
              .values(parsed.points.slice(start, start + TRACK_POINT_INSERT_BATCH_SIZE).map((point) => ({ flightId: flight.id, ...point })));
          }

          const claimInput = {
            flightId: flight.id,
            userId: input.ownerUserId,
            launchTimezone,
          };
          const [laterCompletedFlight] = input.policy?.markDirtyBoundary
            ? await tx.select({ id: flights.id }).from(flights).where(and(
                eq(flights.userId, input.ownerUserId),
                eq(flights.processingStatus, 'completed'),
                gt(flights.startedAt, parsed.startedAt),
              )).limit(1)
            : [];
          const deferAchievements = input.policy?.evaluateAchievements === false || Boolean(laterCompletedFlight);
          if (deferAchievements) {
            await gridClaim.processInTransaction(tx, claimInput, {
              evaluateAchievements: false,
              evaluateArenaAchievements: false,
              evaluateLeadership: true,
              awardLeadershipAchievements: false,
            });
          } else {
            await gridClaim.processInTransaction(tx, claimInput);
          }

          const completed = await tx
            .update(flights)
            .set({
              processingStatus: 'completed',
              processingToken: null,
              processingError: null,
              processedAt: sql`clock_timestamp()`,
            })
            .where(and(
              eq(flights.id, flight.id),
              eq(flights.processingStatus, 'processing'),
              eq(flights.processingToken, input.processingToken),
            ))
            .returning({ id: flights.id, actorUserId: flights.userId, processedAt: flights.processedAt });
          const completedFlight = completed[0];
          if (!completedFlight) throw new ProcessingFenceLostError();
          if (!completedFlight.processedAt) throw new Error('Completed flight has no processed timestamp.');
          if (deferAchievements && input.policy?.markDirtyBoundary) {
            await tx.insert(userWorkflowState)
              .values({
                userId: input.ownerUserId,
                dirtyAchievementBoundary: parsed.startedAt,
                dirtyRevision: 1,
              })
              .onConflictDoUpdate({
                target: userWorkflowState.userId,
                set: {
                  dirtyAchievementBoundary: sql`LEAST(COALESCE(${userWorkflowState.dirtyAchievementBoundary}, ${parsed.startedAt}), ${parsed.startedAt})`,
                  dirtyRevision: sql`${userWorkflowState.dirtyRevision} + 1`,
                  updatedAt: new Date(),
                },
              });
          }
          await tx.update(profiles).set({
            gliderHoursSeconds: sql`${profiles.gliderHoursSeconds} + ${parsed.durationSeconds}`,
          }).where(and(
            eq(profiles.userId, input.ownerUserId),
            isNotNull(profiles.gliderModelId),
          ));
          if (input.policy?.publishActivity ?? true) {
            await activity.publishFlightInTransaction(tx, {
              actorUserId: completedFlight.actorUserId,
              sourceFlightId: completedFlight.id,
              publishedAt: completedFlight.processedAt,
            });
          }
        });
      } catch (error) {
        if (error instanceof ProcessingFenceLostError) return { status: 'superseded', flightId: flight.id };
        throw error;
      }

      return { status: 'completed', flightId: flight.id };
    },
  };
}
