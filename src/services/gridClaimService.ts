import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims, flights, personalGridClaims } from '../db/schema.js';
import { emptyViewportStats, type ViewportStats } from '../domain/territory/viewportStats.js';
import { rebuildGridClaims } from './gridClaimRebuild.js';
import { createProgressionAchievementService, type ProgressionAchievementService } from './progressionAchievementService.js';
import { createArenaAchievementService, type ArenaAchievementEvaluation, type ArenaAchievementService } from './arenaAchievementService.js';
import {
  createArenaLeadershipReconciliationService,
  type ArenaLeadershipReconciliationService,
} from './arenaLeadershipReconciliationService.js';
import { createUserAchievementProgressService, type UserAchievementProgressService } from './userAchievementProgressService.js';
import { createUserArenaProgressService, type UserArenaProgressService } from './userArenaProgressService.js';
import { findEligibleArenaIdsForCompetitionFlight } from './arenaClaimImpact.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';
import { lockArenaCatalogShared } from './arenaCatalogLock.js';

export type GridClaimProcessResult = {
  flightId: string;
  cellSize: number;
  directCellCount: number;
  enclosedCellCount: number;
  newPersonalCellCount: number;
  personalCellTotalAfter: number;
  progressionVersion: number;
  evaluatedAt: Date;
  arenaAchievements: ArenaAchievementEvaluation;
};

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type GridClaimTransaction = Pick<DatabaseTransaction, 'select' | 'delete' | 'insert' | 'execute'>;

export interface GridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<GridClaimProcessResult>;
  reprocess(input: { flightId: string }): Promise<
    | { status: 'completed'; result: GridClaimProcessResult }
    | { status: 'not_found' }
    | { status: 'not_completed' }
  >;
  getViewportStats(input: ViewportBounds & { userId: string }): Promise<ViewportStats>;
}

export interface TransactionalGridClaimService extends GridClaimService {
  processInTransaction(
    transaction: GridClaimTransaction,
    input: { flightId: string; userId: string; launchTimezone: string },
    options?: {
      evaluateAchievements?: boolean;
      evaluateArenaAchievements?: boolean;
      evaluateLeadership?: boolean;
    },
  ): Promise<GridClaimProcessResult>;
}

type StoredViewportStats = ViewportStats;

export async function lockUserProgression(database: Pick<Database, 'execute'>, userId: string): Promise<void> {
  await database.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))
  `);
}

export function createGridClaimService(
  database: Database,
  options: { cellSize: number },
  progressionAchievements: ProgressionAchievementService = createProgressionAchievementService(),
  arenaAchievements: ArenaAchievementService = createArenaAchievementService(),
  arenaLeadership: ArenaLeadershipReconciliationService = createArenaLeadershipReconciliationService(database, options),
  userAchievementProgress: UserAchievementProgressService = createUserAchievementProgressService(database, options),
  userArenaProgress: UserArenaProgressService = createUserArenaProgressService(database, options),
): TransactionalGridClaimService {
  async function processInTransaction(
    transaction: GridClaimTransaction,
    input: { flightId: string; userId: string; launchTimezone: string },
    evaluationOptions: {
      evaluateAchievements?: boolean;
      evaluateArenaAchievements?: boolean;
      evaluateLeadership?: boolean;
    } = {},
  ): Promise<GridClaimProcessResult> {
    const evaluateAchievements = evaluationOptions.evaluateAchievements ?? true;
    const evaluateArenaAchievements = evaluationOptions.evaluateArenaAchievements ?? evaluateAchievements;
    const evaluateLeadership = evaluationOptions.evaluateLeadership ?? true;
    await lockArenaCatalogShared(transaction);
    await lockUserProgression(transaction, input.userId);
    const [flight] = await transaction
      .select({ startedAt: flights.startedAt, createdAt: flights.createdAt })
      .from(flights)
      .where(eq(flights.id, input.flightId));
    await transaction.delete(personalGridClaims).where(eq(personalGridClaims.claimFlight, input.flightId));
    await transaction.delete(competitionGridClaims).where(eq(competitionGridClaims.claimFlight, input.flightId));

    const result = await rebuildGridClaims(transaction, input, options.cellSize);
    if (evaluateAchievements && result.progressionVersion === 1 && flight) {
      await progressionAchievements.awardUniqueCellMilestones(transaction, {
        userId: input.userId,
        sourceFlightId: input.flightId,
        earnedAt: result.evaluatedAt,
        flightStartedAt: flight.startedAt ?? flight.createdAt,
        previousTotal: result.personalCellTotalAfter - result.newPersonalCellCount,
        newTotal: result.personalCellTotalAfter,
        newCells: result.newPersonalCellCount,
      });
      await progressionAchievements.awardPersonalBestAchievements(transaction, {
        userId: input.userId,
        sourceFlightId: input.flightId,
        earnedAt: result.evaluatedAt,
        flightStartedAt: flight.startedAt ?? flight.createdAt,
        directCells: result.directCellCount,
        enclosedCells: result.enclosedCellCount,
      });
    }

    const shouldEvaluateArenaAchievements = evaluateArenaAchievements && result.progressionVersion === 1 && Boolean(flight);
    let arenaEvaluation: ArenaAchievementEvaluation = { newlyEarned: [], alreadyEarned: 0, record: null };
    if (shouldEvaluateArenaAchievements) {
      const { before, after } = await userArenaProgress.applyFlightInTransaction(transaction, {
        userId: input.userId,
        flightId: input.flightId,
        previousLifetimeUniqueCellCount: result.personalCellTotalAfter - result.newPersonalCellCount,
        lifetimeUniqueCellCount: result.personalCellTotalAfter,
      });
      arenaEvaluation = await arenaAchievements.evaluateTransitionInTransaction(transaction, {
        userId: input.userId,
        sourceFlightId: input.flightId,
        cellSize: options.cellSize,
        earnedAt: result.evaluatedAt,
      }, before, after);
      await userAchievementProgress.upsertFromArenaSnapshotInTransaction(transaction, input.userId, after);
    }
    if (evaluateLeadership) {
      const arenaIds = await findEligibleArenaIdsForCompetitionFlight(transaction, {
        flightId: input.flightId,
        cellSize: options.cellSize,
        newlyUniqueOnly: true,
      });
      if (arenaIds.length > 0) {
        if (arenaLeadership.applyFlightInTransaction) {
          await arenaLeadership.applyFlightInTransaction(transaction, { arenaIds, flightId: input.flightId });
        } else {
          await arenaLeadership.reconcileInTransaction(transaction, { arenaIds });
        }
      }
    }
    result.arenaAchievements = {
      newlyEarned: arenaEvaluation.newlyEarned,
      alreadyEarned: arenaEvaluation.alreadyEarned,
      record: arenaEvaluation.record,
    };
    return result;
  }

  return {
    async getViewportStats({ userId, west, south, east, north }) {
      const result = await database.execute<StoredViewportStats>(sql`
        WITH ${viewportCtes({ west, south, east, north })},
        visible_claims AS (
          SELECT DISTINCT claims.x, claims.y, claims.claim_flight
          FROM user_grid_claims claims
          INNER JOIN viewport_parts viewport ON ST_Intersects(
            ST_MakeEnvelope(
              claims.x * ${options.cellSize},
              claims.y * ${options.cellSize},
              (claims.x + 1) * ${options.cellSize},
              (claims.y + 1) * ${options.cellSize},
              6933
            ),
            viewport.geometry
          )
          WHERE claims.claim_user = ${userId}
        ),
        claimed_cells AS (
          SELECT DISTINCT x, y FROM visible_claims
        )
        SELECT
          COUNT(*)::integer AS "claimedCellCount",
          (COUNT(*) * ${options.cellSize}::bigint * ${options.cellSize}::bigint)::double precision AS "claimedAreaSquareMeters",
          (SELECT COUNT(DISTINCT claim_flight)::integer FROM visible_claims) AS "flightCount"
        FROM claimed_cells
      `);

      return result.rows[0] ?? emptyViewportStats();
    },
    async process(input) {
      return database.transaction((tx) => processInTransaction(tx, input));
    },
    processInTransaction,
    async reprocess({ flightId }) {
      return database.transaction(async (tx) => {
        await lockArenaCatalogShared(tx);
        const [flight] = await tx
          .select({ userId: flights.userId, processingStatus: flights.processingStatus, launchTimezone: flights.launchTimezone })
          .from(flights)
          .where(eq(flights.id, flightId));
        if (!flight) return { status: 'not_found' as const };
        if (flight.processingStatus !== 'completed' || !flight.launchTimezone) {
          return { status: 'not_completed' as const };
        }

        await lockUserProgression(tx, flight.userId);
        const oldArenaIds = await findEligibleArenaIdsForCompetitionFlight(tx, {
          flightId,
          cellSize: options.cellSize,
        });
        await tx.delete(personalGridClaims).where(eq(personalGridClaims.claimFlight, flightId));
        await tx.delete(competitionGridClaims).where(eq(competitionGridClaims.claimFlight, flightId));
        const result = await processInTransaction(tx, {
          flightId,
          userId: flight.userId,
          launchTimezone: flight.launchTimezone,
        }, { evaluateArenaAchievements: false, evaluateLeadership: false });
        // Reprocessing replaces the flight's claims, so rebuild the durable
        // Arena projection from canonical claims even when this is the first
        // progression evaluation. Reprocess correction must never evaluate
        // transition achievements a second time.
        const arenaSnapshot = await userArenaProgress.rebuildInTransaction(tx, flight.userId);
        await userAchievementProgress.upsertFromArenaSnapshotInTransaction(tx, flight.userId, arenaSnapshot, { promoteToComplete: true });
        const newArenaIds = await findEligibleArenaIdsForCompetitionFlight(tx, {
          flightId,
          cellSize: options.cellSize,
        });
        const arenaIds = [...new Set([...oldArenaIds, ...newArenaIds])]
          .sort((left, right) => left.localeCompare(right));
        if (arenaIds.length > 0) {
          await arenaLeadership.reconcileInTransaction(tx, { arenaIds });
        }
        return { status: 'completed' as const, result };
      });
    },
  };
}
