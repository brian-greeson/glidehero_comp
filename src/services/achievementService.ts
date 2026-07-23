import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  achievementRecordEvents,
  achievementRecords,
  achievements,
} from '../db/schema.js';
import {
  getAchievementDefinition,
  validateAchievementValue,
  type AchievementKey,
} from '../domain/achievement/catalog.js';

type WriteDatabase = Pick<Database, 'insert' | 'select' | 'execute'>;

export type AchievementAwardInput = {
  userId: string;
  key: string;
  earnedAt?: Date;
  sourceFlightId?: string | null;
  value?: number;
  details?: Record<string, unknown>;
};

export type AchievementAwardResult = {
  key: AchievementKey;
  newlyEarned: boolean;
};

export type AchievementBatchAwardResult = {
  newlyEarned: AchievementKey[];
  alreadyEarned: number;
};

export type AchievementRecordInput = {
  userId: string;
  key: string;
  value: number;
  earnedAt?: Date;
  sourceFlightId?: string | null;
  details?: Record<string, unknown>;
};

export type AchievementRecordResult = {
  key: AchievementKey;
  value: number;
  newRecord: boolean;
  previousValue: number | null;
};

function detailsWithMetadata(input: { details?: Record<string, unknown>; value?: number }): Record<string, unknown> {
  return {
    ...(input.details ?? {}),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}

/**
 * Persist ordinary achievements in one insert. Inputs are validated before any
 * database write and duplicate user/key pairs use their first supplied value.
 */
export async function awardAchievementsInBatch(
  database: WriteDatabase,
  inputs: readonly AchievementAwardInput[],
): Promise<AchievementBatchAwardResult> {
  const unique = new Map<string, { input: AchievementAwardInput; key: AchievementKey }>();
  for (const input of inputs) {
    const definition = getAchievementDefinition(input.key);
    if (definition.kind === 'record') {
      throw new Error(`Record achievement must use the personal-best record API: ${input.key}`);
    }
    const value = validateAchievementValue(input.key, input.value);
    const dedupeKey = `${input.userId}\u0000${definition.key}`;
    if (!unique.has(dedupeKey)) unique.set(dedupeKey, { input: { ...input, ...(value === undefined ? {} : { value }) }, key: definition.key });
  }

  if (unique.size === 0) return { newlyEarned: [], alreadyEarned: 0 };
  const rows = [...unique.values()];
  const inserted = await database
    .insert(achievements)
    .values(rows.map(({ input, key }) => {
      const definition = getAchievementDefinition(key);
      const value = validateAchievementValue(key, input.value);
      return {
        userId: input.userId,
        achievementType: definition.kind,
        achievementKey: definition.key,
        sourceFlightId: input.sourceFlightId ?? null,
        earnedAt: input.earnedAt ?? new Date(),
        details: {
          ...detailsWithMetadata({ details: input.details, value }),
          category: definition.category,
          kind: definition.kind,
          ...(value === undefined ? {} : { threshold: definition.kind === 'threshold' ? definition.threshold : undefined }),
        },
      };
    }))
    .onConflictDoNothing({ target: [achievements.userId, achievements.achievementKey] })
    .returning({ userId: achievements.userId, key: achievements.achievementKey });

  const insertedKeys = new Set(inserted.map((row) => `${row.userId}\u0000${row.key}`));
  return {
    newlyEarned: rows.filter(({ input, key }) => insertedKeys.has(`${input.userId}\u0000${key}`)).map(({ key }) => key),
    alreadyEarned: rows.length - inserted.length,
  };
}

/** Alias retained for callers that prefer the shorter batch naming. */
export const awardAchievementsBatch = awardAchievementsInBatch;

export async function awardAchievement(
  database: WriteDatabase,
  input: AchievementAwardInput,
): Promise<AchievementAwardResult> {
  const definition = getAchievementDefinition(input.key);
  if (definition.kind === 'record') {
    throw new Error(`Record achievement must use the personal-best record API: ${input.key}`);
  }
  const value = validateAchievementValue(input.key, input.value);
  const [inserted] = await database
    .insert(achievements)
    .values({
      userId: input.userId,
      achievementType: definition.kind,
      achievementKey: definition.key,
      sourceFlightId: input.sourceFlightId ?? null,
      earnedAt: input.earnedAt ?? new Date(),
      details: {
        ...detailsWithMetadata({ details: input.details, value }),
        category: definition.category,
        kind: definition.kind,
        ...(value === undefined ? {} : { threshold: definition.kind === 'threshold' ? definition.threshold : undefined }),
      },
    })
    .onConflictDoNothing({ target: [achievements.userId, achievements.achievementKey] })
    .returning({ id: achievements.id });

  return { key: definition.key, newlyEarned: inserted !== undefined };
}

/** Execute both the current-best write and its event write in a caller-owned transaction. */
export async function awardAchievementRecordInTransaction(
  database: WriteDatabase,
  input: AchievementRecordInput,
): Promise<AchievementRecordResult> {
  if (!('nestedIndex' in database)) {
    throw new Error('Use awardAchievementRecord for a root database; this function requires a caller-owned transaction.');
  }
  const definition = getAchievementDefinition(input.key);
  if (definition.kind !== 'record') throw new Error(`Achievement is not a personal-best record: ${input.key}`);
  validateAchievementValue(input.key, input.value);
  const earnedAt = input.earnedAt ?? new Date();
  const details = detailsWithMetadata({ details: input.details, value: input.value });

  const [inserted] = await database
    .insert(achievementRecords)
    .values({
      userId: input.userId,
      recordKey: definition.key,
      bestValue: input.value,
      sourceFlightId: input.sourceFlightId ?? null,
      earnedAt,
      details,
    })
    .onConflictDoNothing({ target: [achievementRecords.userId, achievementRecords.recordKey] })
    .returning({ id: achievementRecords.id, bestValue: achievementRecords.bestValue });

  if (inserted) {
    await database.insert(achievementRecordEvents).values({
      recordId: inserted.id,
      userId: input.userId,
      sourceFlightId: input.sourceFlightId ?? null,
      value: input.value,
      earnedAt,
      details,
    });
    return { key: definition.key, value: input.value, newRecord: true, previousValue: null };
  }

  // The conditional update is atomic. A concurrent writer either wins first or
  // observes its committed value here; lower/equal attempts cannot overwrite it.
  const updatedResult = await database.execute<{ id: string; previousValue: number | string }>(sql`
    WITH current AS (
      SELECT id, best_value
      FROM achievement_records
      WHERE user_id = ${input.userId}
        AND record_key = ${definition.key}
        AND best_value < ${input.value}
      FOR UPDATE
    )
    UPDATE achievement_records AS record
    SET best_value = ${input.value},
        source_flight_id = ${input.sourceFlightId ?? null},
        earned_at = ${earnedAt},
        details = ${JSON.stringify(details)}::jsonb,
        updated_at = now()
    FROM current
    WHERE record.id = current.id
    RETURNING record.id, current.best_value AS "previousValue"
  `);
  const updated = updatedResult.rows[0];

  if (!updated) {
    const [current] = await database
      .select({ bestValue: achievementRecords.bestValue })
      .from(achievementRecords)
      .where(and(
        eq(achievementRecords.userId, input.userId),
        eq(achievementRecords.recordKey, definition.key),
      ));
    return {
      key: definition.key,
      value: current?.bestValue ?? input.value,
      newRecord: false,
      previousValue: current?.bestValue ?? null,
    };
  }

  await database.insert(achievementRecordEvents).values({
    recordId: updated.id,
    userId: input.userId,
    sourceFlightId: input.sourceFlightId ?? null,
    value: input.value,
    earnedAt,
    details: { ...details, previousValue: Number(updated.previousValue) },
  });
  return {
    key: definition.key,
    value: input.value,
    newRecord: true,
    previousValue: Number(updated.previousValue),
  };
}

/** Public convenience API: the record and its immutable event share one transaction. */
export function awardAchievementRecord(
  database: Database,
  input: AchievementRecordInput,
): Promise<AchievementRecordResult> {
  return database.transaction((transaction) => awardAchievementRecordInTransaction(transaction, input));
}

export type AchievementService = {
  award(input: AchievementAwardInput): Promise<AchievementAwardResult>;
  awardRecord(input: AchievementRecordInput): Promise<AchievementRecordResult>;
};

export function createAchievementService(database: Database): AchievementService {
  return {
    award: (input) => awardAchievement(database, input),
    awardRecord: (input) => awardAchievementRecord(database, input),
  };
}
