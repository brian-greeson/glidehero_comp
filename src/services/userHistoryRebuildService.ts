import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  achievementRecordEvents,
  achievementRecords,
  achievements,
  activities,
  arenaLeadershipEvents,
  arenas,
  flightProgress,
  flights,
  userAchievementProgress,
  users,
} from '../db/schema.js';
import { awardAchievement } from './achievementService.js';
import {
  evaluateArenaAchievementsInTransaction,
  type ArenaAchievementSnapshot,
} from './arenaAchievementService.js';
import { lockArenaCatalogShared } from './arenaCatalogLock.js';
import { createActivityService } from './activityService.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';
import { lockUserProgression } from './gridClaimService.js';
import { createProgressionAchievementService } from './progressionAchievementService.js';
import { createUserAchievementProgressService } from './userAchievementProgressService.js';

type RebuildTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type CompletedFlight = {
  id: string;
  startedAt: Date | null;
};

type CandidateCell = { x: number; y: number };

type CandidateQueryRow = {
  cells: unknown;
  directCellCount: number | string;
  enclosedCellCount: number | string;
};

type LeadershipAwardRow = {
  eventType: 'took' | 'reclaimed';
  claimTimestamp: Date;
  sourceFlightId: string | null;
  arenaId: string;
  arenaName: string;
};

export type UserHistoryRebuildSummary = {
  completedFlights: number;
  activitiesDeleted: number;
  achievementsDeleted: number;
  achievementRecordEventsDeleted: number;
  achievementRecordsDeleted: number;
  flightProgressDeleted: number;
  userAchievementProgressDeleted: number;
  activitiesCreated: number;
  achievementsCreated: number;
  achievementRecordEventsCreated: number;
  achievementRecordsCreated: number;
  flightProgressCreated: number;
};

export type UserHistoryRebuildResult =
  | { status: 'completed'; summary: UserHistoryRebuildSummary }
  | { status: 'not_found' }
  | { status: 'no_completed_flights' }
  | { status: 'invalid_flight_history' };

export type UserHistoryRebuildService = {
  rebuild(userId: string): Promise<UserHistoryRebuildResult>;
};

export type UserHistoryRebuildOptions = {
  cellSize: number;
  /** Integration-test seam used to prove the caller-owned transaction is atomic. */
  afterReset?: (transaction: RebuildTransaction) => Promise<void>;
};

function parseCandidateCells(value: unknown): CandidateCell[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error('Candidate cell query returned an invalid cell list.');
  return parsed.map((cell) => {
    if (typeof cell !== 'object' || cell === null || !('x' in cell) || !('y' in cell)) {
      throw new Error('Candidate cell query returned an invalid cell.');
    }
    const x = Number(cell.x);
    const y = Number(cell.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error('Candidate cell query returned invalid coordinates.');
    }
    return { x, y };
  });
}

function cellKey(cell: CandidateCell): string {
  return `${cell.x}:${cell.y}`;
}

async function selectCandidateCells(
  transaction: Pick<Database, 'execute'>,
  flightId: string,
  cellSize: number,
): Promise<{ cells: CandidateCell[]; directCellCount: number; enclosedCellCount: number }> {
  const result = await transaction.execute<CandidateQueryRow>(sql`
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

async function restoreLeadershipAchievements(
  transaction: RebuildTransaction,
  userId: string,
): Promise<void> {
  const rows = await transaction
    .select({
      eventType: arenaLeadershipEvents.eventType,
      claimTimestamp: arenaLeadershipEvents.claimTimestamp,
      sourceFlightId: arenaLeadershipEvents.sourceFlightId,
      arenaId: arenaLeadershipEvents.arenaId,
      arenaName: arenas.name,
    })
    .from(arenaLeadershipEvents)
    .innerJoin(arenas, eq(arenas.id, arenaLeadershipEvents.arenaId))
    .where(and(
      eq(arenaLeadershipEvents.userId, userId),
      sql`${arenaLeadershipEvents.eventType} IN ('took', 'reclaimed')`,
    ))
    .orderBy(
      asc(arenaLeadershipEvents.claimTimestamp),
      asc(arenaLeadershipEvents.arenaId),
      asc(arenaLeadershipEvents.eventKey),
    ) as LeadershipAwardRow[];

  const firstByType = new Map<LeadershipAwardRow['eventType'], LeadershipAwardRow>();
  for (const row of rows) {
    if (!firstByType.has(row.eventType)) firstByType.set(row.eventType, row);
  }
  for (const row of firstByType.values()) {
    await awardAchievement(transaction, {
      userId,
      key: row.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena',
      earnedAt: row.claimTimestamp,
      sourceFlightId: row.sourceFlightId,
      details: { arenaId: row.arenaId, arenaName: row.arenaName },
    });
  }
}

async function countUserHistory(transaction: RebuildTransaction, userId: string) {
  const [counts] = await transaction.execute<{
    achievements: number | string;
    achievementRecords: number | string;
    achievementRecordEvents: number | string;
  }>(sql`
    SELECT
      (SELECT count(*) FROM achievements WHERE user_id = ${userId}) AS achievements,
      (SELECT count(*) FROM achievement_records WHERE user_id = ${userId}) AS "achievementRecords",
      (SELECT count(*) FROM achievement_record_events WHERE user_id = ${userId}) AS "achievementRecordEvents"
  `).then((result) => result.rows);
  return {
    achievements: Number(counts?.achievements ?? 0),
    achievementRecords: Number(counts?.achievementRecords ?? 0),
    achievementRecordEvents: Number(counts?.achievementRecordEvents ?? 0),
  };
}

/** Rebuild one pilot's derived achievement and Activity history from flight time. */
export function createUserHistoryRebuildService(
  database: Database,
  options: UserHistoryRebuildOptions,
): UserHistoryRebuildService {
  const progressionAchievements = createProgressionAchievementService();
  const activity = createActivityService();
  const progressProjection = createUserAchievementProgressService(database, { cellSize: options.cellSize });

  return {
    rebuild(userId) {
      return database.transaction(async (transaction): Promise<UserHistoryRebuildResult> => {
        const [user] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!user) return { status: 'not_found' };

        // This is the established order used by live flight processing.
        await lockArenaCatalogShared(transaction);
        await lockUserProgression(transaction, userId);

        const completedFlights = await transaction
          .select({ id: flights.id, startedAt: flights.startedAt })
          .from(flights)
          .where(and(eq(flights.userId, userId), eq(flights.processingStatus, 'completed')))
          .orderBy(asc(flights.startedAt), asc(flights.id));
        if (completedFlights.length === 0) return { status: 'no_completed_flights' };
        if (completedFlights.some((flight) => flight.startedAt === null)) {
          return { status: 'invalid_flight_history' };
        }

        const summary: UserHistoryRebuildSummary = {
          completedFlights: completedFlights.length,
          activitiesDeleted: (await transaction.delete(activities)
            .where(eq(activities.actorUserId, userId)).returning({ id: activities.id })).length,
          achievementRecordEventsDeleted: (await transaction.delete(achievementRecordEvents)
            .where(eq(achievementRecordEvents.userId, userId)).returning({ id: achievementRecordEvents.id })).length,
          achievementRecordsDeleted: (await transaction.delete(achievementRecords)
            .where(eq(achievementRecords.userId, userId)).returning({ id: achievementRecords.id })).length,
          achievementsDeleted: (await transaction.delete(achievements)
            .where(eq(achievements.userId, userId)).returning({ id: achievements.id })).length,
          flightProgressDeleted: (await transaction.delete(flightProgress)
            .where(eq(flightProgress.userId, userId)).returning({ id: flightProgress.flightId })).length,
          userAchievementProgressDeleted: (await transaction.delete(userAchievementProgress)
            .where(eq(userAchievementProgress.userId, userId)).returning({ id: userAchievementProgress.userId })).length,
          activitiesCreated: 0,
          achievementsCreated: 0,
          achievementRecordEventsCreated: 0,
          achievementRecordsCreated: 0,
          flightProgressCreated: 0,
        };

        await options.afterReset?.(transaction);

        const seenCells = new Set<string>();
        let totalRecord: number | null = null;
        let enclosedRecord: number | null = null;
        const historicalFlightIds: string[] = [];

        let finalArenaSnapshot: ArenaAchievementSnapshot | null = null;
        for (const flight of completedFlights as Array<CompletedFlight & { startedAt: Date }>) {
          const candidates = await selectCandidateCells(transaction, flight.id, options.cellSize);
          const previousTotal = seenCells.size;
          const newCells = candidates.cells.filter((cell) => !seenCells.has(cellKey(cell)));
          for (const cell of candidates.cells) seenCells.add(cellKey(cell));
          const personalCellTotalAfter = seenCells.size;

          await transaction.insert(flightProgress).values({
            flightId: flight.id,
            userId,
            directCellCount: candidates.directCellCount,
            enclosedCellCount: candidates.enclosedCellCount,
            newPersonalCellCount: newCells.length,
            personalCellTotalAfter,
            progressionVersion: 1,
            evaluatedAt: flight.startedAt,
            updatedAt: flight.startedAt,
          });
          summary.flightProgressCreated += 1;

          await progressionAchievements.awardUniqueCellMilestones(transaction, {
            userId,
            sourceFlightId: flight.id,
            earnedAt: flight.startedAt,
            flightStartedAt: flight.startedAt,
            previousTotal,
            newTotal: personalCellTotalAfter,
            newCells: newCells.length,
          });
          await progressionAchievements.awardPersonalBestAchievements(transaction, {
            userId,
            sourceFlightId: flight.id,
            earnedAt: flight.startedAt,
            flightStartedAt: flight.startedAt,
            directCells: candidates.directCellCount,
            enclosedCells: candidates.enclosedCellCount,
            previousRecords: { totalCells: totalRecord, enclosedCells: enclosedRecord },
          });

          const totalCells = candidates.directCellCount + candidates.enclosedCellCount;
          if (totalCells > 0 && (totalRecord === null || totalCells > totalRecord)) totalRecord = totalCells;
          if (candidates.enclosedCellCount > 0
            && (enclosedRecord === null || candidates.enclosedCellCount > enclosedRecord)) {
            enclosedRecord = candidates.enclosedCellCount;
          }

          historicalFlightIds.push(flight.id);
          const arenaEvaluation = await evaluateArenaAchievementsInTransaction(transaction, {
            userId,
            sourceFlightId: flight.id,
            cellSize: options.cellSize,
            earnedAt: flight.startedAt,
            historicalFlightIds,
          });
          if (!arenaEvaluation.snapshot) throw new Error('Arena achievement replay returned no progress snapshot.');
          finalArenaSnapshot = arenaEvaluation.snapshot;
        }

        await restoreLeadershipAchievements(transaction, userId);
        if (!finalArenaSnapshot) throw new Error('Achievement history replay returned no final progress snapshot.');
        await progressProjection.upsertFromArenaSnapshotInTransaction(
          transaction,
          userId,
          finalArenaSnapshot,
          { promoteToComplete: true },
        );

        for (const flight of completedFlights as Array<CompletedFlight & { startedAt: Date }>) {
          await activity.publishFlightInTransaction(transaction, {
            actorUserId: userId,
            sourceFlightId: flight.id,
            publishedAt: flight.startedAt,
          });
          summary.activitiesCreated += 1;
        }

        const rebuilt = await countUserHistory(transaction, userId);
        summary.achievementsCreated = rebuilt.achievements;
        summary.achievementRecordsCreated = rebuilt.achievementRecords;
        summary.achievementRecordEventsCreated = rebuilt.achievementRecordEvents;
        return { status: 'completed', summary };
      });
    },
  };
}
