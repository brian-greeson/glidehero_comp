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
  achievements: PilotAchievement[];
  recentFlights: PilotRecentFlight[];
};

export type PilotAchievement = {
  id: string;
  achievementType: string;
  typeLabel: string;
  earnedDate: string;
  sourceFlightId: string | null;
  title: string;
  description: string;
};

export type PilotRecentFlight = {
  flightId: string;
  flightDate: string;
  distance: string;
  duration: string;
  directCellCount: number;
  enclosedCellCount: number;
  totalCellCount: number;
  newPersonalCellCount: number;
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

type StoredAchievement = {
  id: string;
  achievementType: string;
  sourceFlightId: string | null;
  earnedAt: Date | string;
  details: unknown;
};

type StoredRecentFlight = {
  flightId: string;
  startedAt: Date | string | null;
  distanceMeters: number | string | null;
  durationSeconds: number | string | null;
  directCellCount: number | string;
  enclosedCellCount: number | string;
  newPersonalCellCount: number | string;
};

function numberOrNull(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

function displayDate(value: Date | string | null): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function displayDistance(value: number | string | null): string {
  if (value == null) return '—';
  const kilometers = Number(value) / 1_000;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(kilometers)} km`;
}

function displayDuration(value: number | string | null): string {
  if (value == null) return '—';
  const totalSeconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function detailsObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function detailNumber(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function countText(value: number | null): string {
  return value === null ? 'an unknown number of' : String(value);
}

function achievementDisplay(row: StoredAchievement): PilotAchievement {
  const details = detailsObject(row.details);
  const milestone = detailNumber(details, 'milestone');
  const previousRecord = detailNumber(details, 'previousRecord');
  const newRecord = detailNumber(details, 'newRecord');
  const directCells = detailNumber(details, 'directCells');
  const enclosedCells = detailNumber(details, 'enclosedCells');
  const newCells = detailNumber(details, 'newCells');
  const newTotal = detailNumber(details, 'newTotal');

  if (row.achievementType === 'unique_cells_milestone') {
    const title = milestone === null ? 'Unique Cells Milestone' : `${milestone} Unique Cells`;
    const description = milestone === null
      ? 'Reached a new Personal Map milestone.'
      : `Reached ${milestone} unique Personal Map cells, adding ${countText(newCells)} new cells to a total of ${countText(newTotal)}.`;
    return {
      id: row.id,
      achievementType: row.achievementType,
      typeLabel: 'Unique cell milestone',
      earnedDate: displayDate(row.earnedAt),
      sourceFlightId: row.sourceFlightId,
      title,
      description,
    };
  }

  if (row.achievementType === 'personal_best_total_cells') {
    const record = countText(newRecord);
    const description = previousRecord === null
      ? `Established an initial total-cell record of ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`
      : `Improved the total-cell record from ${previousRecord} to ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`;
    return {
      id: row.id,
      achievementType: row.achievementType,
      typeLabel: 'Total-cell personal best',
      earnedDate: displayDate(row.earnedAt),
      sourceFlightId: row.sourceFlightId,
      title: 'New Flight Cell Record',
      description,
    };
  }

  if (row.achievementType === 'personal_best_enclosed_cells') {
    const record = countText(newRecord);
    const description = previousRecord === null
      ? `Established an initial enclosed-cell record of ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`
      : `Improved the enclosed-cell record from ${previousRecord} to ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`;
    return {
      id: row.id,
      achievementType: row.achievementType,
      typeLabel: 'Enclosed-cell personal best',
      earnedDate: displayDate(row.earnedAt),
      sourceFlightId: row.sourceFlightId,
      title: 'New Enclosed Cell Record',
      description,
    };
  }

  return {
    id: row.id,
    achievementType: row.achievementType,
    typeLabel: 'Progress achievement',
    earnedDate: displayDate(row.earnedAt),
    sourceFlightId: row.sourceFlightId,
    title: 'Progress Achievement',
    description: 'A progression achievement earned during a flight.',
  };
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
      const [achievementRows, recentFlightRows] = await Promise.all([
        database.execute<StoredAchievement>(sql`
          SELECT
            id,
            achievement_type AS "achievementType",
            source_flight_id AS "sourceFlightId",
            earned_at AS "earnedAt",
            details
          FROM achievements
          WHERE user_id = ${userId}
          ORDER BY earned_at DESC, id DESC
          LIMIT 50
        `),
        database.execute<StoredRecentFlight>(sql`
          SELECT
            progress.flight_id AS "flightId",
            flights.started_at AS "startedAt",
            flights.distance_meters AS "distanceMeters",
            flights.duration_seconds AS "durationSeconds",
            progress.direct_cell_count AS "directCellCount",
            progress.enclosed_cell_count AS "enclosedCellCount",
            progress.new_personal_cell_count AS "newPersonalCellCount"
          FROM flight_progress progress
          INNER JOIN flights ON flights.flight_id = progress.flight_id
          WHERE progress.user_id = ${userId}
          ORDER BY progress.evaluated_at DESC, progress.flight_id DESC
          LIMIT 20
        `),
      ]);
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
        achievements: achievementRows.rows.map(achievementDisplay),
        recentFlights: recentFlightRows.rows.map((flight) => {
          const directCellCount = Number(flight.directCellCount);
          const enclosedCellCount = Number(flight.enclosedCellCount);
          return {
            flightId: flight.flightId,
            flightDate: displayDate(flight.startedAt),
            distance: displayDistance(flight.distanceMeters),
            duration: displayDuration(flight.durationSeconds),
            directCellCount,
            enclosedCellCount,
            totalCellCount: directCellCount + enclosedCellCount,
            newPersonalCellCount: Number(flight.newPersonalCellCount),
          };
        }),
      };
    },
  };
}
