import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { claimCellCenterSql } from './arenaGeometrySql.js';

export type LaunchArenaProgress = {
  kind: 'launch';
  firstProgressDate: Date | null;
  mostRecentProgressDate: Date | null;
  visited: boolean;
  claimedCells: number;
  totalCells: number;
  complete: boolean;
};

export type GeneralArenaProgress = {
  kind: 'general';
  firstProgressDate: Date | null;
  mostRecentProgressDate: Date | null;
  claimedCells: number;
  totalCells: number;
  coveragePercentage: number;
  nextMilestone: number | null;
};

export type StateArenaProgress = { kind: 'state'; firstProgressDate: Date | null; mostRecentProgressDate: Date | null; flownIn: boolean };
export type CountryArenaProgress = { kind: 'country'; firstProgressDate: Date | null; mostRecentProgressDate: Date | null; flownIn: boolean };
export type ArenaPersonalProgress =
  | LaunchArenaProgress
  | GeneralArenaProgress
  | StateArenaProgress
  | CountryArenaProgress;

export interface ArenaProgressService {
  get(input: { arenaId: string; userId: string }): Promise<ArenaPersonalProgress>;
}

type StoredProgress = {
  arenaType: ArenaPersonalProgress['kind'];
  claimableCellCount: number | string | null;
  claimableCellSize: number | string | null;
  claimedCells: number | string;
  firstProgressDate: Date | null;
  mostRecentProgressDate: Date | null;
  visited: boolean;
};

const GENERAL_MILESTONES = [10, 25, 50, 75, 100] as const;

export function createArenaProgressService(database: Database, options: { cellSize: number }): ArenaProgressService {
  const { cellSize } = options;
  return {
    async get({ arenaId, userId }) {
      const result = await database.execute<StoredProgress>(sql`
        WITH selected AS (
          SELECT id, arena_type, claimable_cell_count, claimable_cell_size, area
          FROM arenas
          WHERE id = ${arenaId}
        ),
        matching_claims AS (
          SELECT claims.x, claims.y, claims.claim_timestamp
          FROM user_grid_claims claims
          INNER JOIN selected arena ON ST_Covers(
            arena.area,
            ${claimCellCenterSql({ x: sql`claims.x`, y: sql`claims.y`, cellSize: sql`claims.cell_size` })}
          )
          WHERE claims.claim_user = ${userId}
            AND claims.cell_size = ${cellSize}
        ),
        personal_cells AS (
          SELECT DISTINCT matching_claims.x, matching_claims.y
          FROM matching_claims
        ),
        progress_dates AS (
          SELECT MIN(matching_claims.claim_timestamp) AS first_progress_date,
                 MAX(matching_claims.claim_timestamp) AS most_recent_progress_date
          FROM matching_claims
        ),
        counts AS (
          SELECT
            selected.arena_type,
            selected.claimable_cell_count,
            selected.claimable_cell_size,
            COUNT(personal_cells.x)::integer AS claimed_cells,
            progress_dates.first_progress_date,
            progress_dates.most_recent_progress_date,
            EXISTS (
              SELECT 1
              FROM flights flight
              WHERE flight.user_id = ${userId}
                AND flight.processing_status = 'completed'
                AND flight.launch_latitude IS NOT NULL
                AND flight.launch_longitude IS NOT NULL
                AND ST_Covers(
                  selected.area,
                  ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
                )
            ) AS visited
          FROM selected
          LEFT JOIN personal_cells ON true
          CROSS JOIN progress_dates
          GROUP BY selected.arena_type, selected.claimable_cell_count, selected.claimable_cell_size, selected.area,
                   progress_dates.first_progress_date, progress_dates.most_recent_progress_date
        )
        SELECT
          arena_type AS "arenaType",
          claimable_cell_count AS "claimableCellCount",
          claimable_cell_size AS "claimableCellSize",
          claimed_cells AS "claimedCells",
          first_progress_date AS "firstProgressDate",
          most_recent_progress_date AS "mostRecentProgressDate",
          visited
        FROM counts
      `);
      const row = result.rows[0];
      if (!row) throw new Error('Arena not found.');

      const claimedCells = Number(row.claimedCells);
      if (!Number.isSafeInteger(claimedCells) || claimedCells < 0) {
        throw new Error('Arena personal progress has an invalid claimed-cell count.');
      }
      if (row.arenaType === 'state') return {
        kind: 'state',
        firstProgressDate: row.firstProgressDate,
        mostRecentProgressDate: row.mostRecentProgressDate,
        flownIn: claimedCells > 0,
      };
      if (row.arenaType === 'country') return {
        kind: 'country',
        firstProgressDate: row.firstProgressDate,
        mostRecentProgressDate: row.mostRecentProgressDate,
        flownIn: claimedCells > 0,
      };

      const totalCells = Number(row.claimableCellCount);
      const storedCellSize = Number(row.claimableCellSize);
      if (!Number.isSafeInteger(totalCells) || totalCells <= 0 || storedCellSize !== cellSize) {
        throw new Error('Arena personal progress has invalid claimable grid metadata.');
      }
      if (row.arenaType === 'launch') {
        return {
          kind: 'launch',
          firstProgressDate: row.firstProgressDate,
          mostRecentProgressDate: row.mostRecentProgressDate,
          visited: row.visited,
          claimedCells,
          totalCells,
          complete: claimedCells === totalCells,
        };
      }
      const exactCoveragePercentage = Math.min(100, (claimedCells / totalCells) * 100);
      const coveragePercentage = Math.floor(exactCoveragePercentage * 10) / 10;
      const nextMilestone = GENERAL_MILESTONES.find((milestone) => exactCoveragePercentage < milestone) ?? null;
      return { kind: 'general', firstProgressDate: row.firstProgressDate, mostRecentProgressDate: row.mostRecentProgressDate, claimedCells, totalCells, coveragePercentage, nextMilestone };
    },
  };
}
