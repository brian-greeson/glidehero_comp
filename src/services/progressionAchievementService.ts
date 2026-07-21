import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { achievements, flightProgress } from '../db/schema.js';

export const uniqueCellsAchievementType = 'unique_cells_milestone' as const;

const fixedUniqueCellMilestones = [10, 25, 50, 100, 200, 500, 1_000] as const;
const recurringUniqueCellMilestoneStep = 1_000;

export function nextUniqueCellMilestone(currentTotal: number): number {
  const fixedMilestone = fixedUniqueCellMilestones.find((milestone) => milestone > currentTotal);
  if (fixedMilestone !== undefined) return fixedMilestone;

  const firstRecurringMilestone = fixedUniqueCellMilestones.at(-1)! + recurringUniqueCellMilestoneStep;
  if (currentTotal < firstRecurringMilestone) return firstRecurringMilestone;

  return (Math.floor(currentTotal / recurringUniqueCellMilestoneStep) + 1) * recurringUniqueCellMilestoneStep;
}

export function uniqueCellMilestonesCrossed(previousTotal: number, newTotal: number): number[] {
  if (newTotal <= previousTotal) return [];

  const milestones: number[] = [];
  for (let milestone = nextUniqueCellMilestone(previousTotal); milestone <= newTotal;) {
    milestones.push(milestone);
    milestone = nextUniqueCellMilestone(milestone);
  }
  return milestones;
}

export type UniqueCellMilestoneInput = {
  userId: string;
  sourceFlightId: string;
  earnedAt: Date;
  flightStartedAt: Date;
  previousTotal: number;
  newTotal: number;
  newCells: number;
};

export type PersonalBestAchievementInput = {
  userId: string;
  sourceFlightId: string;
  earnedAt: Date;
  flightStartedAt: Date;
  directCells: number;
  enclosedCells: number;
  previousRecords?: {
    totalCells: number | null;
    enclosedCells: number | null;
  };
};

export type ProgressionAchievementService = {
  awardUniqueCellMilestones(
    database: Pick<Database, 'insert'>,
    input: UniqueCellMilestoneInput,
  ): Promise<number[]>;
  awardPersonalBestAchievements(
    database: Pick<Database, 'insert' | 'select'>,
    input: PersonalBestAchievementInput,
  ): Promise<string[]>;
};

function nullableNumber(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

export function createProgressionAchievementService(): ProgressionAchievementService {
  return {
    async awardUniqueCellMilestones(database, input) {
      const milestones = uniqueCellMilestonesCrossed(input.previousTotal, input.newTotal);
      if (!milestones.length) return milestones;

      await database
        .insert(achievements)
        .values(milestones.map((milestone) => ({
          userId: input.userId,
          achievementType: uniqueCellsAchievementType,
          achievementKey: 'unique-cells:' + milestone,
          sourceFlightId: input.sourceFlightId,
          earnedAt: input.earnedAt,
          details: {
            milestone,
            previousTotal: input.previousTotal,
            newTotal: input.newTotal,
            newCells: input.newCells,
            flightStartedAt: input.flightStartedAt.toISOString(),
          },
        })))
        .onConflictDoNothing({
          target: [achievements.userId, achievements.achievementKey],
        });

      return milestones;
    },

    async awardPersonalBestAchievements(database, input) {
      const totalCells = input.directCells + input.enclosedCells;
      if (totalCells <= 0 && input.enclosedCells <= 0) return [];

      let previousTotalRecord: number | null;
      let previousEnclosedRecord: number | null;
      if (input.previousRecords) {
        previousTotalRecord = input.previousRecords.totalCells;
        previousEnclosedRecord = input.previousRecords.enclosedCells;
      } else {
        const [prior] = await database
          .select({
            totalCells: sql<number | null>`MAX(
              CASE
                WHEN ${flightProgress.directCellCount} + ${flightProgress.enclosedCellCount} > 0
                THEN ${flightProgress.directCellCount} + ${flightProgress.enclosedCellCount}
              END
            )`,
            enclosedCells: sql<number | null>`MAX(
              CASE
                WHEN ${flightProgress.enclosedCellCount} > 0
                THEN ${flightProgress.enclosedCellCount}
              END
            )`,
          })
          .from(flightProgress)
          .where(and(
            eq(flightProgress.userId, input.userId),
            ne(flightProgress.flightId, input.sourceFlightId),
          ));

        previousTotalRecord = nullableNumber(prior?.totalCells);
        previousEnclosedRecord = nullableNumber(prior?.enclosedCells);
      }
      const rows: Array<{
        userId: string;
        achievementType: string;
        achievementKey: string;
        sourceFlightId: string;
        earnedAt: Date;
        details: Record<string, unknown>;
      }> = [];
      const details = {
        previousRecord: previousTotalRecord,
        newRecord: totalCells,
        directCells: input.directCells,
        enclosedCells: input.enclosedCells,
        totalCells,
        flightStartedAt: input.flightStartedAt.toISOString(),
      };

      if (totalCells > 0 && (previousTotalRecord === null || totalCells > previousTotalRecord)) {
        rows.push({
          userId: input.userId,
          achievementType: 'personal_best_total_cells',
          achievementKey: 'personal-best-total-cells:' + input.sourceFlightId,
          sourceFlightId: input.sourceFlightId,
          earnedAt: input.earnedAt,
          details,
        });
      }

      if (input.enclosedCells > 0 && (previousEnclosedRecord === null || input.enclosedCells > previousEnclosedRecord)) {
        rows.push({
          userId: input.userId,
          achievementType: 'personal_best_enclosed_cells',
          achievementKey: 'personal-best-enclosed-cells:' + input.sourceFlightId,
          sourceFlightId: input.sourceFlightId,
          earnedAt: input.earnedAt,
          details: {
            ...details,
            previousRecord: previousEnclosedRecord,
            newRecord: input.enclosedCells,
          },
        });
      }

      if (!rows.length) return [];
      await database
        .insert(achievements)
        .values(rows)
        .onConflictDoNothing({
          target: [achievements.userId, achievements.achievementKey],
        });
      return rows.map((row) => row.achievementType);
    },
  };
}
