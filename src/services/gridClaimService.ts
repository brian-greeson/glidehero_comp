import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims, flights, personalGridClaims } from '../db/schema.js';
import { emptyViewportStats, type ViewportStats } from '../domain/territory/viewportStats.js';
import { rebuildGridClaims } from './gridClaimRebuild.js';
import { createProgressionAchievementService, type ProgressionAchievementService } from './progressionAchievementService.js';
import { createArenaAchievementService, type ArenaAchievementEvaluation, type ArenaAchievementService } from './arenaAchievementService.js';
import { viewportCtes, type ViewportBounds } from './viewportGrid.js';

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
): TransactionalGridClaimService {
  async function processInTransaction(
    transaction: GridClaimTransaction,
    input: { flightId: string; userId: string; launchTimezone: string },
    evaluateAchievements = true,
  ): Promise<GridClaimProcessResult> {
    await lockUserProgression(transaction, input.userId);
    const [flight] = await transaction
      .select({ startedAt: flights.startedAt, createdAt: flights.createdAt })
      .from(flights)
      .where(eq(flights.id, input.flightId));
    await transaction.delete(personalGridClaims).where(and(
      eq(personalGridClaims.claimFlight, input.flightId),
      eq(personalGridClaims.cellSize, options.cellSize),
    ));
    await transaction.delete(competitionGridClaims).where(and(
      eq(competitionGridClaims.claimFlight, input.flightId),
      eq(competitionGridClaims.cellSize, options.cellSize),
    ));

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
    result.arenaAchievements = flight && evaluateAchievements
      ? await arenaAchievements.evaluateInTransaction(transaction, {
        userId: input.userId,
        sourceFlightId: input.flightId,
        cellSize: options.cellSize,
        earnedAt: result.evaluatedAt,
      })
      : { newlyEarned: [], alreadyEarned: 0, record: null };
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
            AND claims.cell_size = ${options.cellSize}
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
        const [flight] = await tx
          .select({ userId: flights.userId, processingStatus: flights.processingStatus, launchTimezone: flights.launchTimezone })
          .from(flights)
          .where(eq(flights.id, flightId));
        if (!flight) return { status: 'not_found' as const };
        if (flight.processingStatus !== 'completed' || !flight.launchTimezone) {
          return { status: 'not_completed' as const };
        }

        await lockUserProgression(tx, flight.userId);
        await tx.delete(personalGridClaims).where(eq(personalGridClaims.claimFlight, flightId));
        await tx.delete(competitionGridClaims).where(eq(competitionGridClaims.claimFlight, flightId));
        const result = await processInTransaction(tx, {
          flightId,
          userId: flight.userId,
          launchTimezone: flight.launchTimezone,
        });
        return { status: 'completed' as const, result };
      });
    },
  };
}
