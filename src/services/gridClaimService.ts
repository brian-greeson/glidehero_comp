import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims, flights, personalGridClaims } from '../db/schema.js';
import { emptyViewportStats, type ViewportStats } from '../domain/territory/viewportStats.js';
import { createCompetitionGridClaimService, rebuildCompetitionGridClaims } from './competitionGridClaimService.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';
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

export interface PersonalGridClaimService {
  process(input: { flightId: string; userId: string }): Promise<GridClaimProcessResult>;
  getViewportStats(input: ViewportBounds & { userId: string }): Promise<ViewportStats>;
}

export interface GridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<GridClaimProcessResult>;
  reprocess(input: { flightId: string }): Promise<
    | { status: 'completed'; result: GridClaimProcessResult }
    | { status: 'not_found' }
    | { status: 'not_completed' }
  >;
  getViewportStats(input: ViewportBounds & { userId: string }): Promise<ViewportStats>;
}

type ProcessCounts = {
  directCellCount: number;
  enclosedCellCount: number;
  newPersonalCellCount: number;
  personalCellTotalAfter: number;
  progressionVersion: number;
  evaluatedAt: Date;
};

type StoredViewportStats = ViewportStats;
type ClaimDatabase = Pick<Database, 'delete' | 'execute'>;

async function rebuildPersonalClaims(
  database: ClaimDatabase,
  input: { flightId: string; userId: string },
  cellSize: number,
): Promise<GridClaimProcessResult> {
  const result = await database.execute<ProcessCounts>(sql`
    ${gridClaimCandidateCtes({ flightId: input.flightId, cellSize })},
    personal_cells AS (
      SELECT x, y, MAX(claim_timestamp) AS claim_timestamp
      FROM candidate_events
      GROUP BY x, y
    ),
    personal_inserted AS (
      INSERT INTO user_grid_claims (
        cell_size,
        x,
        y,
        claim_flight,
        claim_user,
        claim_timestamp
      )
      SELECT ${cellSize}, x, y, ${input.flightId}, ${input.userId}, claim_timestamp
      FROM personal_cells
      ON CONFLICT (claim_user, cell_size, x, y, claim_flight) DO UPDATE
      SET
        claim_timestamp = EXCLUDED.claim_timestamp
      RETURNING x, y
    ),
    new_personal_cells AS (
      SELECT personal_cells.x, personal_cells.y
      FROM personal_cells
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_grid_claims existing_claims
        WHERE existing_claims.claim_user = ${input.userId}
          AND existing_claims.cell_size = ${cellSize}
          AND existing_claims.x = personal_cells.x
          AND existing_claims.y = personal_cells.y
          AND existing_claims.claim_flight <> ${input.flightId}
      )
    ),
    personal_claim_cells AS (
      SELECT existing_claims.x, existing_claims.y
      FROM user_grid_claims existing_claims
      WHERE existing_claims.claim_user = ${input.userId}
        AND existing_claims.cell_size = ${cellSize}
      UNION
      SELECT x, y
      FROM personal_inserted
    ),
    claim_counts AS (
      SELECT
        (SELECT count(*)::integer FROM direct_cells) AS direct_cell_count,
        (SELECT count(*)::integer FROM enclosed_candidates) AS enclosed_cell_count,
        (SELECT count(*)::integer FROM new_personal_cells) AS new_personal_cell_count,
        (SELECT count(*)::integer FROM personal_claim_cells) AS personal_cell_total_after
    ),
    progression_upsert AS (
      INSERT INTO flight_progress (
        flight_id,
        user_id,
        direct_cell_count,
        enclosed_cell_count,
        new_personal_cell_count,
        personal_cell_total_after,
        progression_version,
        evaluated_at,
        updated_at
      )
      SELECT
        ${input.flightId},
        ${input.userId},
        direct_cell_count,
        enclosed_cell_count,
        new_personal_cell_count,
        personal_cell_total_after,
        1,
        now(),
        now()
      FROM claim_counts
      ON CONFLICT (flight_id) DO UPDATE SET
        direct_cell_count = EXCLUDED.direct_cell_count,
        enclosed_cell_count = EXCLUDED.enclosed_cell_count,
        progression_version = flight_progress.progression_version + 1,
        updated_at = now()
      RETURNING new_personal_cell_count, personal_cell_total_after, progression_version, evaluated_at
    )
    SELECT
      claim_counts.direct_cell_count AS "directCellCount",
      claim_counts.enclosed_cell_count AS "enclosedCellCount",
      progression_upsert.new_personal_cell_count AS "newPersonalCellCount",
      progression_upsert.personal_cell_total_after AS "personalCellTotalAfter",
      progression_upsert.progression_version AS "progressionVersion",
      progression_upsert.evaluated_at AS "evaluatedAt"
    FROM claim_counts
    CROSS JOIN progression_upsert
  `);
  const counts = result.rows[0] ?? {
    directCellCount: 0,
    enclosedCellCount: 0,
    newPersonalCellCount: 0,
    personalCellTotalAfter: 0,
    progressionVersion: 1,
    evaluatedAt: new Date(),
  };

  return {
    flightId: input.flightId,
    cellSize,
    directCellCount: counts.directCellCount,
    enclosedCellCount: counts.enclosedCellCount,
    newPersonalCellCount: counts.newPersonalCellCount,
    personalCellTotalAfter: counts.personalCellTotalAfter,
    progressionVersion: counts.progressionVersion,
    evaluatedAt: new Date(counts.evaluatedAt),
  };
}

async function lockUserProgression(database: Pick<Database, 'execute'>, userId: string): Promise<void> {
  await database.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))
  `);
}

export function createPersonalGridClaimService(
  database: Database,
  options: { cellSize: number },
  progressionAchievements: ProgressionAchievementService = createProgressionAchievementService(),
): PersonalGridClaimService {
  const { cellSize } = options;

  return {
    async process({ flightId, userId }) {
      return database.transaction(async (tx) => {
        await lockUserProgression(tx, userId);
        const [flight] = await tx
          .select({ startedAt: flights.startedAt, createdAt: flights.createdAt })
          .from(flights)
          .where(eq(flights.id, flightId));
        await tx.delete(personalGridClaims).where(and(
          eq(personalGridClaims.claimFlight, flightId),
          eq(personalGridClaims.cellSize, cellSize),
        ));

        const result = await rebuildPersonalClaims(tx, { flightId, userId }, cellSize);
        if (result.progressionVersion === 1 && flight) {
          await progressionAchievements.awardUniqueCellMilestones(tx, {
            userId,
            sourceFlightId: flightId,
            earnedAt: result.evaluatedAt,
            flightStartedAt: flight.startedAt ?? flight.createdAt,
            previousTotal: result.personalCellTotalAfter - result.newPersonalCellCount,
            newTotal: result.personalCellTotalAfter,
            newCells: result.newPersonalCellCount,
          });
          await progressionAchievements.awardPersonalBestAchievements(tx, {
            userId,
            sourceFlightId: flightId,
            earnedAt: result.evaluatedAt,
            flightStartedAt: flight.startedAt ?? flight.createdAt,
            directCells: result.directCellCount,
            enclosedCells: result.enclosedCellCount,
          });
        }
        return result;
      });
    },

    async getViewportStats({ userId, west, south, east, north }) {
      const result = await database.execute<StoredViewportStats>(sql`
        WITH ${viewportCtes({ west, south, east, north })},
        visible_claims AS (
          SELECT DISTINCT claims.x, claims.y, claims.claim_flight
          FROM user_grid_claims claims
          INNER JOIN viewport_parts viewport ON ST_Intersects(
            ST_MakeEnvelope(
              claims.x * ${cellSize},
              claims.y * ${cellSize},
              (claims.x + 1) * ${cellSize},
              (claims.y + 1) * ${cellSize},
              6933
            ),
            viewport.geometry
          )
          WHERE claims.claim_user = ${userId}
            AND claims.cell_size = ${cellSize}
        ),
        claimed_cells AS (
          SELECT DISTINCT x, y FROM visible_claims
        )
        SELECT
          COUNT(*)::integer AS "claimedCellCount",
          (COUNT(*) * ${cellSize}::bigint * ${cellSize}::bigint)::double precision AS "claimedAreaSquareMeters",
          (SELECT COUNT(DISTINCT claim_flight)::integer FROM visible_claims) AS "flightCount"
        FROM claimed_cells
      `);

      return result.rows[0] ?? emptyViewportStats();
    },
  };
}

export function createGridClaimService(
  database: Database,
  options: { cellSize: number },
  progressionAchievements: ProgressionAchievementService = createProgressionAchievementService(),
): GridClaimService {
  const personalGridClaim = createPersonalGridClaimService(database, options, progressionAchievements);
  const competitionGridClaim = createCompetitionGridClaimService(database, options);

  return {
    getViewportStats: personalGridClaim.getViewportStats,
    async process(input) {
      const result = await personalGridClaim.process({
        flightId: input.flightId,
        userId: input.userId,
      });
      await competitionGridClaim.process(input);
      return result;
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
        const result = await rebuildPersonalClaims(tx, { flightId, userId: flight.userId }, options.cellSize);
        await rebuildCompetitionGridClaims(tx, {
          flightId,
          userId: flight.userId,
          launchTimezone: flight.launchTimezone,
        }, options.cellSize);
        return { status: 'completed' as const, result };
      });
    },
  };
}
