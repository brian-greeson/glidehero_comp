import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { createDatabase } from '../db/client.js';
import { achievements, flightProgress, flights } from '../db/schema.js';
import { gridClaimCandidateCtes } from '../services/gridClaimCandidates.js';
import { lockUserProgression } from '../services/gridClaimService.js';
import { createProgressionAchievementService } from '../services/progressionAchievementService.js';

const usage = `Usage: npm run backfill:flight-progress [-- --apply]

Dry-run is the default and does not write progression or achievement rows.
Pass --apply to create missing rows.
`;

type BackfillLogger = Pick<Console, 'error' | 'log'>;

export type BackfillSummary = {
  usersInspected: number;
  flightsNeedingBackfill: number;
  flightsReplayedWithProcessedAtOrder: number;
  legacyFlightsReplayedApproximate: number;
  usersAffectedByApproximateOrdering: number;
  progressRowsCreated: number;
  milestoneAchievementsCreated: number;
  totalCellPersonalBestAchievementsCreated: number;
  enclosedCellPersonalBestAchievementsCreated: number;
  usersFailed: number;
};

export type BackfillOptions = {
  apply: boolean;
  cellSize: number;
  logger?: BackfillLogger;
};

type BackfillFlight = {
  id: string;
  userId: string;
  createdAt: Date;
  processedAt: Date | null;
  startedAt: Date | null;
  progressFlightId: string | null;
};

type CandidateCell = { x: number; y: number };

type CandidateQueryRow = {
  cells: unknown;
  directCellCount: number | string;
  enclosedCellCount: number | string;
};

type UserBackfillSummary = Pick<
  BackfillSummary,
  | 'flightsNeedingBackfill'
  | 'progressRowsCreated'
  | 'milestoneAchievementsCreated'
  | 'totalCellPersonalBestAchievementsCreated'
  | 'enclosedCellPersonalBestAchievementsCreated'
>;

type ReplayOrderingSummary = Pick<
  BackfillSummary,
  'flightsReplayedWithProcessedAtOrder' | 'legacyFlightsReplayedApproximate' | 'usersAffectedByApproximateOrdering'
>;

function emptySummary(): BackfillSummary {
  return {
    usersInspected: 0,
    flightsNeedingBackfill: 0,
    flightsReplayedWithProcessedAtOrder: 0,
    legacyFlightsReplayedApproximate: 0,
    usersAffectedByApproximateOrdering: 0,
    progressRowsCreated: 0,
    milestoneAchievementsCreated: 0,
    totalCellPersonalBestAchievementsCreated: 0,
    enclosedCellPersonalBestAchievementsCreated: 0,
    usersFailed: 0,
  };
}

function parseCandidateCells(value: unknown): CandidateCell[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error('Candidate cell query returned an invalid cell list.');
  return parsed.map((cell) => {
    if (typeof cell !== 'object' || cell === null || !('x' in cell) || !('y' in cell)) {
      throw new Error('Candidate cell query returned an invalid cell.');
    }
    const x = Number(cell.x);
    const y = Number(cell.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Candidate cell query returned invalid coordinates.');
    return { x, y };
  });
}

function cellKey(cell: CandidateCell): string {
  return `${cell.x}:${cell.y}`;
}

function summarizeReplayOrdering(flightsForUser: BackfillFlight[]): ReplayOrderingSummary {
  const legacyFlightsReplayedApproximate = flightsForUser.filter((flight) => flight.processedAt === null).length;
  return {
    flightsReplayedWithProcessedAtOrder: flightsForUser.length - legacyFlightsReplayedApproximate,
    legacyFlightsReplayedApproximate,
    usersAffectedByApproximateOrdering: legacyFlightsReplayedApproximate > 0 ? 1 : 0,
  };
}

async function selectCandidateCells(
  database: Pick<Database, 'execute'>,
  flightId: string,
  cellSize: number,
): Promise<{ cells: CandidateCell[]; directCellCount: number; enclosedCellCount: number }> {
  const result = await database.execute<CandidateQueryRow>(sql`
    ${gridClaimCandidateCtes({ flightId, cellSize })},
    candidate_cells AS (
      SELECT x, y
      FROM candidate_events
      GROUP BY x, y
    )
    SELECT
      COALESCE(
        json_agg(json_build_object('x', candidate_cells.x, 'y', candidate_cells.y) ORDER BY candidate_cells.x, candidate_cells.y),
        '[]'::json
      ) AS cells,
      (SELECT count(*)::integer FROM direct_cells) AS "directCellCount",
      (SELECT count(*)::integer FROM enclosed_candidates) AS "enclosedCellCount"
    FROM candidate_cells
  `);
  const row = result.rows[0];
  if (!row) throw new Error(`Candidate query returned no result for flight ${flightId}.`);
  return {
    cells: parseCandidateCells(row.cells),
    directCellCount: Number(row.directCellCount),
    enclosedCellCount: Number(row.enclosedCellCount),
  };
}

async function selectUserFlights(
  database: Pick<Database, 'select'>,
  userId: string,
): Promise<BackfillFlight[]> {
  const rows = await database
    .select({
      id: flights.id,
      userId: flights.userId,
      createdAt: flights.createdAt,
      processedAt: flights.processedAt,
      startedAt: flights.startedAt,
      progressFlightId: flightProgress.flightId,
    })
    .from(flights)
    .leftJoin(flightProgress, eq(flightProgress.flightId, flights.id))
    .where(and(eq(flights.userId, userId), eq(flights.processingStatus, 'completed')))
    .orderBy(
      asc(flights.userId),
      sql`CASE WHEN ${flights.processedAt} IS NULL THEN 0 ELSE 1 END`,
      sql`COALESCE(${flights.processedAt}, ${flights.createdAt})`,
      asc(flights.id),
    );
  return rows;
}

async function backfillUser(
  database: Database,
  userId: string,
  options: BackfillOptions,
): Promise<UserBackfillSummary> {
  const progressionAchievements = createProgressionAchievementService();
  return database.transaction(async (tx) => {
    await lockUserProgression(tx, userId);
    const flightsForUser = await selectUserFlights(tx, userId);
    const flightsNeedingBackfill = flightsForUser.filter((flight) => flight.progressFlightId === null);
    if (!flightsNeedingBackfill.length) {
      return {
        flightsNeedingBackfill: 0,
        progressRowsCreated: 0,
        milestoneAchievementsCreated: 0,
        totalCellPersonalBestAchievementsCreated: 0,
        enclosedCellPersonalBestAchievementsCreated: 0,
      };
    }

    const missingFlightIds = new Set(flightsNeedingBackfill.map((flight) => flight.id));
    const seenCells = new Set<string>();
    let totalRecord: number | null = null;
    let enclosedRecord: number | null = null;
    const summary: UserBackfillSummary = {
      flightsNeedingBackfill: flightsNeedingBackfill.length,
      progressRowsCreated: 0,
      milestoneAchievementsCreated: 0,
      totalCellPersonalBestAchievementsCreated: 0,
      enclosedCellPersonalBestAchievementsCreated: 0,
    };

    for (const flight of flightsForUser) {
      const candidates = await selectCandidateCells(tx, flight.id, options.cellSize);
      const newCells = candidates.cells.filter((cell) => !seenCells.has(cellKey(cell)));
      const previousTotal = seenCells.size;
      for (const cell of candidates.cells) seenCells.add(cellKey(cell));
      const personalCellTotalAfter = seenCells.size;
      const totalCells = candidates.directCellCount + candidates.enclosedCellCount;
      const previousRecords = { totalCells: totalRecord, enclosedCells: enclosedRecord };

      if (missingFlightIds.has(flight.id)) {
        const evaluatedAt = new Date();
        await tx.insert(flightProgress).values({
          flightId: flight.id,
          userId,
          directCellCount: candidates.directCellCount,
          enclosedCellCount: candidates.enclosedCellCount,
          newPersonalCellCount: newCells.length,
          personalCellTotalAfter,
          progressionVersion: 1,
          evaluatedAt,
          updatedAt: evaluatedAt,
        });
        summary.progressRowsCreated += 1;

        const milestones = await progressionAchievements.awardUniqueCellMilestones(tx, {
          userId,
          sourceFlightId: flight.id,
          earnedAt: flight.processedAt ?? flight.createdAt,
          flightStartedAt: flight.startedAt ?? flight.createdAt,
          previousTotal,
          newTotal: personalCellTotalAfter,
          newCells: newCells.length,
        });
        summary.milestoneAchievementsCreated += milestones.length;

        const personalBests = await progressionAchievements.awardPersonalBestAchievements(tx, {
          userId,
          sourceFlightId: flight.id,
          earnedAt: flight.processedAt ?? flight.createdAt,
          flightStartedAt: flight.startedAt ?? flight.createdAt,
          directCells: candidates.directCellCount,
          enclosedCells: candidates.enclosedCellCount,
          previousRecords,
        });
        summary.totalCellPersonalBestAchievementsCreated += personalBests.filter(
          (type) => type === 'personal_best_total_cells',
        ).length;
        summary.enclosedCellPersonalBestAchievementsCreated += personalBests.filter(
          (type) => type === 'personal_best_enclosed_cells',
        ).length;
      }

      if (totalCells > 0 && (totalRecord === null || totalCells > totalRecord)) totalRecord = totalCells;
      if (candidates.enclosedCellCount > 0 && (enclosedRecord === null || candidates.enclosedCellCount > enclosedRecord)) {
        enclosedRecord = candidates.enclosedCellCount;
      }
    }

    if (!options.apply) throw new DryRunRollback(summary);
    return summary;
  }).catch((error) => {
    if (error instanceof DryRunRollback) return error.summary;
    throw error;
  });
}

class DryRunRollback extends Error {
  constructor(public readonly summary: UserBackfillSummary) {
    super('Dry-run transaction rollback.');
  }
}

async function selectUsersNeedingBackfill(database: Pick<Database, 'select'>): Promise<{ userIds: string[]; flightCount: number }> {
  const rows = await database
    .select({ userId: flights.userId, flightId: flights.id })
    .from(flights)
    .leftJoin(flightProgress, eq(flightProgress.flightId, flights.id))
    .where(and(eq(flights.processingStatus, 'completed'), isNull(flightProgress.flightId)))
    .orderBy(asc(flights.userId), asc(flights.createdAt), asc(flights.id));
  const userIds = [...new Set(rows.map((row) => row.userId))];
  return { userIds, flightCount: rows.length };
}

export async function runBackfill(database: Database, options: BackfillOptions): Promise<BackfillSummary> {
  const logger = options.logger ?? console;
  const summary = emptySummary();
  const inventory = await selectUsersNeedingBackfill(database);
  summary.usersInspected = inventory.userIds.length;
  summary.flightsNeedingBackfill = inventory.flightCount;

  for (const userId of inventory.userIds) {
    try {
      const replayOrdering = summarizeReplayOrdering(await selectUserFlights(database, userId));
      summary.flightsReplayedWithProcessedAtOrder += replayOrdering.flightsReplayedWithProcessedAtOrder;
      summary.legacyFlightsReplayedApproximate += replayOrdering.legacyFlightsReplayedApproximate;
      summary.usersAffectedByApproximateOrdering += replayOrdering.usersAffectedByApproximateOrdering;

      const userSummary = await backfillUser(database, userId, options);
      summary.progressRowsCreated += options.apply ? userSummary.progressRowsCreated : userSummary.flightsNeedingBackfill;
      summary.milestoneAchievementsCreated += userSummary.milestoneAchievementsCreated;
      summary.totalCellPersonalBestAchievementsCreated += userSummary.totalCellPersonalBestAchievementsCreated;
      summary.enclosedCellPersonalBestAchievementsCreated += userSummary.enclosedCellPersonalBestAchievementsCreated;
    } catch (error) {
      summary.usersFailed += 1;
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Flight-progress backfill failed for user ${userId}: ${message}`);
    }
  }

  return summary;
}

export function printSummary(summary: BackfillSummary, apply: boolean, logger: BackfillLogger): void {
  const verb = apply ? 'created' : 'would be created';
  logger.log(`Users inspected: ${summary.usersInspected}`);
  logger.log(`Flights needing backfill: ${summary.flightsNeedingBackfill}`);
  logger.log(`Flights replayed with recorded processedAt order: ${summary.flightsReplayedWithProcessedAtOrder}`);
  logger.log(`Legacy flights replayed with approximate createdAt order: ${summary.legacyFlightsReplayedApproximate}`);
  logger.log(`Users affected by approximate ordering: ${summary.usersAffectedByApproximateOrdering}`);
  if (summary.legacyFlightsReplayedApproximate > 0) {
    logger.log('WARNING: Legacy flights have no processedAt timestamp; their createdAt order is approximate and cannot reconstruct exact concurrent processing order.');
  }
  logger.log(`Progress rows ${verb}: ${apply ? summary.progressRowsCreated : summary.flightsNeedingBackfill}`);
  logger.log(`Milestone achievements ${verb}: ${summary.milestoneAchievementsCreated}`);
  logger.log(`Total-cell personal bests ${verb}: ${summary.totalCellPersonalBestAchievementsCreated}`);
  logger.log(`Enclosed-cell personal bests ${verb}: ${summary.enclosedCellPersonalBestAchievementsCreated}`);
  logger.log(`Users failed: ${summary.usersFailed}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(usage);
    return;
  }
  const apply = args.length === 1 && args[0] === '--apply';
  if (args.length > 0 && !apply) throw new Error(`Unknown argument: ${args[0] ?? ''}\n\n${usage}`);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const cellSize = 500;

  const { db, pool } = createDatabase(databaseUrl);
  try {
    const summary = await runBackfill(db, { apply, cellSize });
    printSummary(summary, apply, console);
    if (summary.usersFailed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
