import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  achievementRecordEvents,
  achievementRecords,
  achievements,
  activities,
  arenaLeadershipEvents,
  arenas,
  bulkImports,
  flightProgress,
  flights,
  userAchievementProgress,
  userWorkflowState,
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
import {
  createUserAchievementProgressService,
  type UserAchievementProgressService,
} from './userAchievementProgressService.js';

type RebuildTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type CompletedFlight = {
  id: string;
  startedAt: Date | null;
};

export type UserHistoryRebuildFlight = {
  id: string;
  startedAt: Date;
};

export type UserHistoryRebuildSnapshot = {
  userId: string;
  email: string;
  completedFlights: readonly UserHistoryRebuildFlight[];
};

export type UserHistoryRebuildInspection =
  | { status: 'not_found'; email: string }
  | {
      status: 'no_completed_flights';
      userId: string;
      email: string;
      completedFlightCount: 0;
      invalidFlightIds: [];
    }
  | {
      status: 'invalid_flight_history';
      userId: string;
      email: string;
      completedFlightCount: number;
      invalidFlightIds: string[];
    }
  | {
      status: 'ready';
      userId: string;
      email: string;
      completedFlightCount: number;
      invalidFlightIds: [];
      snapshot: UserHistoryRebuildSnapshot;
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

export const USER_HISTORY_REBUILD_BATCH_SIZE = 5;

export type BatchedUserHistoryRebuildSummary = UserHistoryRebuildSummary & {
  totalBatches: number;
  committedBatches: number;
  committedFlights: number;
  resetCommitted: boolean;
  finalizationCommitted: boolean;
};

export type UserHistoryBatchedRebuildService = UserHistoryRebuildService & {
  inspectByEmail(email: string): Promise<UserHistoryRebuildInspection>;
  rebuildSnapshot(
    snapshot: UserHistoryRebuildSnapshot,
    callbacks?: {
      onBatchCommitted?: (progress: {
        batchNumber: number;
        totalBatches: number;
        flightCount: number;
      }) => void;
    },
  ): Promise<BatchedUserHistoryRebuildSummary>;
  /** Replay achievement-derived state without touching Activity rows. */
  replayAchievements?(options: AchievementOnlyReplayOptions): Promise<AchievementOnlyReplayResult>;
};

export type AchievementOnlyReplayOptions = {
  userId: string;
  /** `full` rebuilds all completed flights; `suffix` starts at dirtyStartedAt. */
  mode: 'full' | 'suffix';
  dirtyStartedAt?: Date;
  /** Zero-based flight cursor for restart/resume. */
  cursor?: number;
  /** When supplied, the three-flight replay and its resume cursor commit together. */
  bulkImportId?: string;
  onBatchCommitted?: (progress: { cursor: number; nextCursor: number; flightCount: number; done: boolean }) => void | Promise<void>;
};

export type AchievementOnlyReplayResult = {
  cursor: number;
  nextCursor: number;
  processedFlights: number;
  done: boolean;
};

export const ACHIEVEMENT_REPLAY_BATCH_SIZE = 3;

export class BatchedUserHistoryRebuildError extends Error {
  constructor(
    public readonly summary: BatchedUserHistoryRebuildSummary,
    cause: unknown,
  ) {
    super(`Batched user history rebuild failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'BatchedUserHistoryRebuildError';
  }
}

export type UserHistoryRebuildOptions = {
  cellSize: number;
  /** Integration-test seam used to prove the caller-owned transaction is atomic. */
  afterReset?: (transaction: RebuildTransaction) => Promise<void>;
  /** Integration-test seam used to prove earlier flight batches remain committed. */
  afterBatch?: (transaction: RebuildTransaction, batchNumber: number) => Promise<void>;
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

async function countUserHistory(database: Pick<Database, 'execute'>, userId: string) {
  const [counts] = await database.execute<{
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

function emptySummary(completedFlights: number): UserHistoryRebuildSummary {
  return {
    completedFlights,
    activitiesDeleted: 0,
    achievementsDeleted: 0,
    achievementRecordEventsDeleted: 0,
    achievementRecordsDeleted: 0,
    flightProgressDeleted: 0,
    userAchievementProgressDeleted: 0,
    activitiesCreated: 0,
    achievementsCreated: 0,
    achievementRecordEventsCreated: 0,
    achievementRecordsCreated: 0,
    flightProgressCreated: 0,
  };
}

async function resetUserHistory(
  transaction: RebuildTransaction,
  userId: string,
  completedFlightCount: number,
): Promise<UserHistoryRebuildSummary> {
  const summary = emptySummary(completedFlightCount);
  summary.activitiesDeleted = (await transaction.delete(activities)
    .where(eq(activities.actorUserId, userId)).returning({ id: activities.id })).length;
  summary.achievementRecordEventsDeleted = (await transaction.delete(achievementRecordEvents)
    .where(eq(achievementRecordEvents.userId, userId)).returning({ id: achievementRecordEvents.id })).length;
  summary.achievementRecordsDeleted = (await transaction.delete(achievementRecords)
    .where(eq(achievementRecords.userId, userId)).returning({ id: achievementRecords.id })).length;
  summary.achievementsDeleted = (await transaction.delete(achievements)
    .where(eq(achievements.userId, userId)).returning({ id: achievements.id })).length;
  summary.flightProgressDeleted = (await transaction.delete(flightProgress)
    .where(eq(flightProgress.userId, userId)).returning({ id: flightProgress.flightId })).length;
  summary.userAchievementProgressDeleted = (await transaction.delete(userAchievementProgress)
    .where(eq(userAchievementProgress.userId, userId)).returning({ id: userAchievementProgress.userId })).length;
  return summary;
}

type UserHistoryReplayState = {
  seenCells: Set<string>;
  totalRecord: number | null;
  enclosedRecord: number | null;
  historicalFlightIds: string[];
  finalArenaSnapshot: ArenaAchievementSnapshot | null;
};

function emptyReplayState(): UserHistoryReplayState {
  return {
    seenCells: new Set<string>(),
    totalRecord: null,
    enclosedRecord: null,
    historicalFlightIds: [],
    finalArenaSnapshot: null,
  };
}

async function replayFlights(
  transaction: RebuildTransaction,
  userId: string,
  completedFlights: readonly UserHistoryRebuildFlight[],
  state: UserHistoryReplayState,
  cellSize: number,
  publishActivities = true,
): Promise<{ activitiesCreated: number; flightProgressCreated: number }> {
  const progressionAchievements = createProgressionAchievementService();
  const activity = createActivityService();

  for (const flight of completedFlights) {
    const candidates = await selectCandidateCells(transaction, flight.id, cellSize);
    const previousTotal = state.seenCells.size;
    const newCells = candidates.cells.filter((cell) => !state.seenCells.has(cellKey(cell)));
    for (const cell of candidates.cells) state.seenCells.add(cellKey(cell));
    const personalCellTotalAfter = state.seenCells.size;

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
      previousRecords: { totalCells: state.totalRecord, enclosedCells: state.enclosedRecord },
    });

    const totalCells = candidates.directCellCount + candidates.enclosedCellCount;
    if (totalCells > 0 && (state.totalRecord === null || totalCells > state.totalRecord)) {
      state.totalRecord = totalCells;
    }
    if (candidates.enclosedCellCount > 0
      && (state.enclosedRecord === null || candidates.enclosedCellCount > state.enclosedRecord)) {
      state.enclosedRecord = candidates.enclosedCellCount;
    }

    state.historicalFlightIds.push(flight.id);
    const arenaEvaluation = await evaluateArenaAchievementsInTransaction(transaction, {
      userId,
      sourceFlightId: flight.id,
      cellSize,
      earnedAt: flight.startedAt,
      historicalFlightIds: state.historicalFlightIds,
    });
    if (!arenaEvaluation.snapshot) throw new Error('Arena achievement replay returned no progress snapshot.');
    state.finalArenaSnapshot = arenaEvaluation.snapshot;

    if (publishActivities) {
      await activity.publishFlightInTransaction(transaction, {
        actorUserId: userId,
        sourceFlightId: flight.id,
        publishedAt: flight.startedAt,
      });
    }
  }

  return {
    activitiesCreated: publishActivities ? completedFlights.length : 0,
    flightProgressCreated: completedFlights.length,
  };
}

async function finalizeUserHistory(
  transaction: RebuildTransaction,
  userId: string,
  state: UserHistoryReplayState,
  progressProjection: UserAchievementProgressService,
): Promise<void> {
  await restoreLeadershipAchievements(transaction, userId);
  if (!state.finalArenaSnapshot) throw new Error('Achievement history replay returned no final progress snapshot.');
  await progressProjection.upsertFromArenaSnapshotInTransaction(
    transaction,
    userId,
    state.finalArenaSnapshot,
    { promoteToComplete: true },
  );
}

async function resetAchievementDerived(
  transaction: RebuildTransaction,
  userId: string,
  mode: AchievementOnlyReplayOptions['mode'],
  dirtyStartedAt?: Date,
): Promise<void> {
  if (mode === 'full') {
    await transaction.delete(achievementRecordEvents).where(eq(achievementRecordEvents.userId, userId));
    await transaction.delete(achievementRecords).where(eq(achievementRecords.userId, userId));
    await transaction.delete(achievements).where(eq(achievements.userId, userId));
    await transaction.delete(flightProgress).where(eq(flightProgress.userId, userId));
    await transaction.delete(userAchievementProgress).where(eq(userAchievementProgress.userId, userId));
    return;
  }
  if (!dirtyStartedAt) throw new Error('dirtyStartedAt is required for suffix achievement replay.');
  const suffixFlights = sql`SELECT id FROM flights WHERE user_id = ${userId} AND processing_status = 'completed' AND started_at >= ${dirtyStartedAt}`;
  await transaction.delete(achievementRecordEvents).where(and(
    eq(achievementRecordEvents.userId, userId),
    sql`${achievementRecordEvents.sourceFlightId} IN (${suffixFlights})`,
  ));
  await transaction.delete(achievementRecords).where(and(
    eq(achievementRecords.userId, userId),
    sql`${achievementRecords.sourceFlightId} IN (${suffixFlights})`,
  ));
  await transaction.delete(achievements).where(and(
    eq(achievements.userId, userId),
    sql`${achievements.sourceFlightId} IN (${suffixFlights})`,
  ));
  await transaction.delete(flightProgress).where(and(
    eq(flightProgress.userId, userId),
    sql`${flightProgress.flightId} IN (${suffixFlights})`,
  ));
}

function assignCreatedHistoryCounts(
  summary: UserHistoryRebuildSummary,
  counts: Awaited<ReturnType<typeof countUserHistory>>,
): void {
  summary.achievementsCreated = counts.achievements;
  summary.achievementRecordsCreated = counts.achievementRecords;
  summary.achievementRecordEventsCreated = counts.achievementRecordEvents;
}

function validCompletedFlights(completedFlights: readonly CompletedFlight[]): UserHistoryRebuildFlight[] {
  return completedFlights.map((flight) => {
    if (!flight.startedAt) throw new Error(`Completed flight ${flight.id} is missing its flight date.`);
    return { id: flight.id, startedAt: flight.startedAt };
  });
}

/** Rebuild one pilot's derived achievement and Activity history from flight time. */
export function createUserHistoryRebuildService(
  database: Database,
  options: UserHistoryRebuildOptions,
): UserHistoryBatchedRebuildService {
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

        const summary = await resetUserHistory(transaction, userId, completedFlights.length);
        await options.afterReset?.(transaction);
        const state = emptyReplayState();
        const rebuiltRows = await replayFlights(
          transaction,
          userId,
          validCompletedFlights(completedFlights),
          state,
          options.cellSize,
        );
        summary.activitiesCreated = rebuiltRows.activitiesCreated;
        summary.flightProgressCreated = rebuiltRows.flightProgressCreated;
        await finalizeUserHistory(transaction, userId, state, progressProjection);
        assignCreatedHistoryCounts(summary, await countUserHistory(transaction, userId));
        return { status: 'completed', summary };
      });
    },

    async inspectByEmail(email) {
      const normalizedEmail = email.trim().toLowerCase();
      const [user] = await database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);
      if (!user) return { status: 'not_found', email: normalizedEmail };

      const completedFlights = await database
        .select({ id: flights.id, startedAt: flights.startedAt })
        .from(flights)
        .where(and(eq(flights.userId, user.id), eq(flights.processingStatus, 'completed')))
        .orderBy(asc(flights.startedAt), asc(flights.id));
      const invalidFlightIds = completedFlights
        .filter((flight) => flight.startedAt === null)
        .map((flight) => flight.id);
      const base = {
        userId: user.id,
        email: user.email,
        completedFlightCount: completedFlights.length,
        invalidFlightIds,
      };
      if (completedFlights.length === 0) {
        return {
          status: 'no_completed_flights',
          userId: user.id,
          email: user.email,
          completedFlightCount: 0,
          invalidFlightIds: [],
        };
      }
      if (invalidFlightIds.length > 0) return { ...base, status: 'invalid_flight_history' };
      const snapshot: UserHistoryRebuildSnapshot = {
        userId: user.id,
        email: user.email,
        completedFlights: validCompletedFlights(completedFlights),
      };
      return { ...base, status: 'ready', invalidFlightIds: [], snapshot };
    },

    async rebuildSnapshot(snapshot, callbacks) {
      if (snapshot.completedFlights.length === 0) {
        throw new Error('A user history rebuild snapshot must contain at least one completed flight.');
      }
      const totalBatches = Math.ceil(snapshot.completedFlights.length / USER_HISTORY_REBUILD_BATCH_SIZE);
      const summary: BatchedUserHistoryRebuildSummary = {
        ...emptySummary(snapshot.completedFlights.length),
        totalBatches,
        committedBatches: 0,
        committedFlights: 0,
        resetCommitted: false,
        finalizationCommitted: false,
      };
      const state = emptyReplayState();

      try {
        const deleted = await database.transaction(async (transaction) => {
          await lockArenaCatalogShared(transaction);
          await lockUserProgression(transaction, snapshot.userId);
          const result = await resetUserHistory(
            transaction,
            snapshot.userId,
            snapshot.completedFlights.length,
          );
          await options.afterReset?.(transaction);
          return result;
        });
        Object.assign(summary, deleted);
        summary.resetCommitted = true;

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
          const start = batchIndex * USER_HISTORY_REBUILD_BATCH_SIZE;
          const batch = snapshot.completedFlights.slice(start, start + USER_HISTORY_REBUILD_BATCH_SIZE);
          const created = await database.transaction(async (transaction) => {
            await lockArenaCatalogShared(transaction);
            await lockUserProgression(transaction, snapshot.userId);
            const result = await replayFlights(
              transaction,
              snapshot.userId,
              batch,
              state,
              options.cellSize,
            );
            await options.afterBatch?.(transaction, batchIndex + 1);
            return result;
          });
          summary.committedBatches += 1;
          summary.committedFlights += batch.length;
          summary.activitiesCreated += created.activitiesCreated;
          summary.flightProgressCreated += created.flightProgressCreated;
          callbacks?.onBatchCommitted?.({
            batchNumber: batchIndex + 1,
            totalBatches,
            flightCount: batch.length,
          });
        }

        await database.transaction(async (transaction) => {
          await lockArenaCatalogShared(transaction);
          await lockUserProgression(transaction, snapshot.userId);
          await finalizeUserHistory(transaction, snapshot.userId, state, progressProjection);
        });
        summary.finalizationCommitted = true;
        assignCreatedHistoryCounts(summary, await countUserHistory(database, snapshot.userId));
        return summary;
      } catch (error) {
        try {
          assignCreatedHistoryCounts(summary, await countUserHistory(database, snapshot.userId));
        } catch {
          // Preserve the original rebuild error if diagnostic counting also fails.
        }
        throw new BatchedUserHistoryRebuildError(summary, error);
      }
    },

    async replayAchievements(replayOptions) {
      const cursor = Math.max(0, replayOptions.cursor ?? 0);
      const [initialDirtyState] = await database.select({
        revision: userWorkflowState.dirtyRevision,
      }).from(userWorkflowState).where(eq(userWorkflowState.userId, replayOptions.userId));
      const flightsResult = await database
        .select({ id: flights.id, startedAt: flights.startedAt })
        .from(flights)
        .where(and(
          eq(flights.userId, replayOptions.userId),
          eq(flights.processingStatus, 'completed'),
        ))
        .orderBy(asc(flights.startedAt), asc(flights.id));
      const allFlights = validCompletedFlights(flightsResult);
      const boundary = replayOptions.mode === 'suffix' ? replayOptions.dirtyStartedAt : undefined;
      if (replayOptions.mode === 'suffix' && !boundary) throw new Error('dirtyStartedAt is required for suffix achievement replay.');
      const prefixFlights = boundary ? allFlights.filter((flight) => flight.startedAt < boundary) : [];
      const selectedFlights = boundary ? allFlights.filter((flight) => flight.startedAt >= boundary) : allFlights;
      if (selectedFlights.length === 0) {
        if (replayOptions.bulkImportId) {
          const completed = await database.transaction(async (transaction) => {
            await lockUserProgression(transaction, replayOptions.userId);
            const [currentDirtyState] = await transaction.select({
              revision: userWorkflowState.dirtyRevision,
            }).from(userWorkflowState).where(eq(userWorkflowState.userId, replayOptions.userId));
            if ((currentDirtyState?.revision ?? 0) !== (initialDirtyState?.revision ?? 0)) {
              await transaction.update(bulkImports).set({
                phase: 'replaying',
                replayCursor: 0,
                replayCheckpointCount: 0,
                updatedAt: new Date(),
              }).where(eq(bulkImports.id, replayOptions.bulkImportId!));
              return false;
            }
            await transaction.update(bulkImports).set({
              phase: 'completed',
              lastError: null,
              updatedAt: new Date(),
            }).where(and(
              eq(bulkImports.id, replayOptions.bulkImportId!),
              eq(bulkImports.userId, replayOptions.userId),
            ));
            await transaction.update(userWorkflowState).set({
              dirtyAchievementBoundary: null,
              updatedAt: new Date(),
            }).where(eq(userWorkflowState.userId, replayOptions.userId));
            return true;
          });
          return { cursor, nextCursor: 0, processedFlights: 0, done: completed };
        }
        return { cursor, nextCursor: cursor, processedFlights: 0, done: true };
      }
      if (cursor > selectedFlights.length) throw new Error('Achievement replay cursor is beyond the flight list.');
      if (replayOptions.bulkImportId && cursor === selectedFlights.length && cursor > 0) {
        await database.update(bulkImports).set({
          phase: 'replaying',
          replayCursor: 0,
          replayCheckpointCount: 0,
          updatedAt: new Date(),
        }).where(and(
          eq(bulkImports.id, replayOptions.bulkImportId),
          eq(bulkImports.userId, replayOptions.userId),
        ));
        return { cursor, nextCursor: 0, processedFlights: 0, done: false };
      }
      const nextCursor = Math.min(cursor + ACHIEVEMENT_REPLAY_BATCH_SIZE, selectedFlights.length);
      const batch = selectedFlights.slice(cursor, nextCursor);

      // Build progression context before opening the short write transaction;
      // only the current three-flight batch is processed while locks are held.
      const state = emptyReplayState();
      for (const prior of [...prefixFlights, ...selectedFlights.slice(0, cursor)]) {
        const candidates = await selectCandidateCells(database, prior.id, options.cellSize);
        for (const cell of candidates.cells) state.seenCells.add(cellKey(cell));
        state.historicalFlightIds.push(prior.id);
        const total = candidates.directCellCount + candidates.enclosedCellCount;
        if (total > 0 && (state.totalRecord === null || total > state.totalRecord)) state.totalRecord = total;
        if (candidates.enclosedCellCount > 0 && (state.enclosedRecord === null || candidates.enclosedCellCount > state.enclosedRecord)) {
          state.enclosedRecord = candidates.enclosedCellCount;
        }
      }

      const result = await database.transaction(async (transaction) => {
        await lockArenaCatalogShared(transaction);
        await lockUserProgression(transaction, replayOptions.userId);
        if (cursor === 0) {
          await resetAchievementDerived(
            transaction,
            replayOptions.userId,
            replayOptions.mode,
            replayOptions.dirtyStartedAt,
          );
        }
        await replayFlights(transaction, replayOptions.userId, batch, state, options.cellSize, false);
        if (replayOptions.bulkImportId) {
          const checkpoint = await transaction.update(bulkImports)
            .set({
              replayCursor: nextCursor,
              replayCheckpointCount: sql`${bulkImports.replayCheckpointCount} + ${batch.length}`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(bulkImports.id, replayOptions.bulkImportId),
              eq(bulkImports.userId, replayOptions.userId),
              eq(bulkImports.phase, 'replaying'),
            ))
            .returning({ id: bulkImports.id });
          if (!checkpoint.length) throw new Error('Bulk achievement replay is no longer active.');
        }
        let done = nextCursor >= selectedFlights.length;
        if (done && replayOptions.bulkImportId) {
          const [currentDirtyState] = await transaction.select({
            revision: userWorkflowState.dirtyRevision,
          }).from(userWorkflowState).where(eq(userWorkflowState.userId, replayOptions.userId));
          if ((currentDirtyState?.revision ?? 0) !== (initialDirtyState?.revision ?? 0)) {
            await transaction.update(bulkImports).set({
              replayCursor: 0,
              replayCheckpointCount: 0,
              updatedAt: new Date(),
            }).where(eq(bulkImports.id, replayOptions.bulkImportId));
            done = false;
          }
        }
        if (done) {
          await finalizeUserHistory(transaction, replayOptions.userId, state, progressProjection);
          if (replayOptions.bulkImportId) {
            await transaction.update(bulkImports).set({
              phase: 'completed',
              lastError: null,
              updatedAt: new Date(),
            }).where(and(
              eq(bulkImports.id, replayOptions.bulkImportId),
              eq(bulkImports.userId, replayOptions.userId),
            ));
            await transaction.update(userWorkflowState).set({
              dirtyAchievementBoundary: null,
              updatedAt: new Date(),
            }).where(eq(userWorkflowState.userId, replayOptions.userId));
          }
        }
        return { processedFlights: batch.length, done };
      });
      await replayOptions.onBatchCommitted?.({
        cursor,
        nextCursor,
        flightCount: result.processedFlights,
        done: result.done,
      });
      return {
        cursor,
        nextCursor,
        processedFlights: result.processedFlights,
        done: result.done,
      };
    },
  };
}
