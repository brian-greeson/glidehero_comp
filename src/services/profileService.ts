import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { profiles } from '../db/schema.js';

const territoryColorPattern = /^#[0-9a-f]{6}$/i;

export type UpdateTerritoryColorInput = {
  userId: string;
  territoryColor: string;
};

export type PilotProfileSummary = {
  userId: string;
  displayName: string;
  territoryColor: string;
  lifetimeUniqueCellCount: number;
  completedFlightCount: number;
  lifetimeDirectCellCount: number;
  lifetimeEnclosedCellCount: number;
  currentTotalCellRecord: number | null;
  currentEnclosedCellRecord: number | null;
  achievementCount: number;
};

export class TerritoryColorValidationError extends Error {
  constructor() {
    super('Territory color must be a six-digit hexadecimal value prefixed with #.');
  }
}

export interface ProfileService {
  updateTerritoryColor(input: UpdateTerritoryColorInput): Promise<void>;
  getPilotProfile(userId: string): Promise<PilotProfileSummary | null>;
}

export function normalizeTerritoryColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return territoryColorPattern.test(normalized) ? normalized.toUpperCase() : null;
}

type StoredPilotProfile = {
  userId: string;
  displayName: string;
  territoryColor: string;
  lifetimeUniqueCellCount: number | string;
  completedFlightCount: number | string;
  lifetimeDirectCellCount: number | string;
  lifetimeEnclosedCellCount: number | string;
  currentTotalCellRecord: number | string | null;
  currentEnclosedCellRecord: number | string | null;
  achievementCount: number | string;
};

function numberOrNull(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

export function createProfileService(database: Database, options: { cellSize: number }): ProfileService {
  return {
    async updateTerritoryColor({ userId, territoryColor }) {
      const normalizedColor = normalizeTerritoryColor(territoryColor);
      if (!normalizedColor) throw new TerritoryColorValidationError();

      await database
        .update(profiles)
        .set({ territoryColor: normalizedColor, updatedAt: new Date() })
        .where(eq(profiles.userId, userId));
    },

    async getPilotProfile(userId) {
      const result = await database.execute<StoredPilotProfile>(sql`
        SELECT
          users.user_id AS "userId",
          profiles.display_name AS "displayName",
          profiles.territory_color AS "territoryColor",
          (
            SELECT COUNT(DISTINCT (claims.x, claims.y))::integer
            FROM user_grid_claims claims
            WHERE claims.claim_user = users.user_id
              AND claims.cell_size = ${options.cellSize}
          ) AS "lifetimeUniqueCellCount",
          (
            SELECT COUNT(*)::integer
            FROM flight_progress progress
            WHERE progress.user_id = users.user_id
          ) AS "completedFlightCount",
          (
            SELECT COALESCE(SUM(progress.direct_cell_count), 0)::integer
            FROM flight_progress progress
            WHERE progress.user_id = users.user_id
          ) AS "lifetimeDirectCellCount",
          (
            SELECT COALESCE(SUM(progress.enclosed_cell_count), 0)::integer
            FROM flight_progress progress
            WHERE progress.user_id = users.user_id
          ) AS "lifetimeEnclosedCellCount",
          (
            SELECT MAX(progress.direct_cell_count + progress.enclosed_cell_count)::integer
            FROM flight_progress progress
            WHERE progress.user_id = users.user_id
          ) AS "currentTotalCellRecord",
          (
            SELECT MAX(progress.enclosed_cell_count)::integer
            FROM flight_progress progress
            WHERE progress.user_id = users.user_id
          ) AS "currentEnclosedCellRecord",
          (
            SELECT COUNT(*)::integer
            FROM achievements earned
            WHERE earned.user_id = users.user_id
          ) AS "achievementCount"
        FROM users
        INNER JOIN profiles ON profiles.user_id = users.user_id
        WHERE users.user_id = ${userId}
      `);
      const row = result.rows[0];
      if (!row) return null;
      return {
        userId: row.userId,
        displayName: row.displayName,
        territoryColor: row.territoryColor,
        lifetimeUniqueCellCount: Number(row.lifetimeUniqueCellCount),
        completedFlightCount: Number(row.completedFlightCount),
        lifetimeDirectCellCount: Number(row.lifetimeDirectCellCount),
        lifetimeEnclosedCellCount: Number(row.lifetimeEnclosedCellCount),
        currentTotalCellRecord: numberOrNull(row.currentTotalCellRecord),
        currentEnclosedCellRecord: numberOrNull(row.currentEnclosedCellRecord),
        achievementCount: Number(row.achievementCount),
      };
    },
  };
}
