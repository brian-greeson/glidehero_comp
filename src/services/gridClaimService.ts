import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims, flights, personalGridClaims } from '../db/schema.js';
import { emptyViewportStats, type ViewportStats } from '../domain/territory/viewportStats.js';
import { rebuildGridClaims } from './gridClaimRebuild.js';
import { createProgressionAchievementService, type ProgressionAchievementService } from './progressionAchievementService.js';
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
};

export interface GridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<GridClaimProcessResult>;
  reprocess(input: { flightId: string }): Promise<
    | { status: 'completed'; result: GridClaimProcessResult }
    | { status: 'not_found' }
    | { status: 'not_completed' }
  >;
  getViewportStats(input: ViewportBounds & { userId: string }): Promise<ViewportStats>;
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
): GridClaimService {
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
      return database.transaction(async (tx) => {
        await lockUserProgression(tx, input.userId);
        const [flight] = await tx
          .select({ startedAt: flights.startedAt, createdAt: flights.createdAt })
          .from(flights)
          .where(eq(flights.id, input.flightId));
        await tx.delete(personalGridClaims).where(and(
          eq(personalGridClaims.claimFlight, input.flightId),
          eq(personalGridClaims.cellSize, options.cellSize),
        ));
        await tx.delete(competitionGridClaims).where(and(
          eq(competitionGridClaims.claimFlight, input.flightId),
          eq(competitionGridClaims.cellSize, options.cellSize),
        ));

        const result = await rebuildGridClaims(tx, input, options.cellSize);
        if (result.progressionVersion === 1 && flight) {
          await progressionAchievements.awardUniqueCellMilestones(tx, {
            userId: input.userId,
            sourceFlightId: input.flightId,
            earnedAt: result.evaluatedAt,
            flightStartedAt: flight.startedAt ?? flight.createdAt,
            previousTotal: result.personalCellTotalAfter - result.newPersonalCellCount,
            newTotal: result.personalCellTotalAfter,
            newCells: result.newPersonalCellCount,
          });
          await progressionAchievements.awardPersonalBestAchievements(tx, {
            userId: input.userId,
            sourceFlightId: input.flightId,
            earnedAt: result.evaluatedAt,
            flightStartedAt: flight.startedAt ?? flight.createdAt,
            directCells: result.directCellCount,
            enclosedCells: result.enclosedCellCount,
          });
        }
        return result;
      });
    },
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
        const result = await rebuildGridClaims(tx, {
          flightId,
          userId: flight.userId,
          launchTimezone: flight.launchTimezone,
        }, options.cellSize);
        return { status: 'completed' as const, result };
      });
    },
  };
}
