import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { competitionGridClaims, flights, personalGridClaims } from '../db/schema.js';
import {
  emptyGridClaimGeoJson,
  type GridClaimGeoJson,
} from '../domain/territory/gridClaimGeoJson.js';
import { emptyViewportStats, type ViewportStats } from '../domain/territory/viewportStats.js';
import { createCompetitionGridClaimService, rebuildCompetitionGridClaims } from './competitionGridClaimService.js';
import { gridClaimCandidateCtes } from './gridClaimCandidates.js';
import { viewportGridCtes, type ViewportBounds } from './viewportGrid.js';

export type GridClaimProcessResult = {
  flightId: string;
  cellSize: number;
  directCellCount: number;
  enclosedCellCount: number;
};

export interface PersonalGridClaimService {
  process(input: { flightId: string; userId: string }): Promise<GridClaimProcessResult>;
  get(input: { userId: string }): Promise<GridClaimGeoJson>;
  getViewportStats(input: ViewportBounds & { userId: string }): Promise<ViewportStats>;
}

export interface GridClaimService {
  process(input: { flightId: string; userId: string; launchTimezone: string }): Promise<GridClaimProcessResult>;
  reprocess(input: { flightId: string }): Promise<
    | { status: 'completed'; result: GridClaimProcessResult }
    | { status: 'not_found' }
    | { status: 'not_completed' }
  >;
  get(input: { userId: string }): Promise<GridClaimGeoJson>;
  getViewportStats(input: ViewportBounds & { userId: string }): Promise<ViewportStats>;
}

type ProcessCounts = {
  directCellCount: number;
  enclosedCellCount: number;
};

type StoredProjection = { geojson: GridClaimGeoJson };
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
    )
    SELECT
      (SELECT count(*)::integer FROM direct_cells) AS "directCellCount",
      (SELECT count(*)::integer FROM enclosed_candidates) AS "enclosedCellCount"
  `);
  const counts = result.rows[0] ?? { directCellCount: 0, enclosedCellCount: 0 };

  return {
    flightId: input.flightId,
    cellSize,
    directCellCount: counts.directCellCount,
    enclosedCellCount: counts.enclosedCellCount,
  };
}

export function createPersonalGridClaimService(
  database: Database,
  options: { cellSize: number },
): PersonalGridClaimService {
  const { cellSize } = options;

  return {
    async process({ flightId, userId }) {
      return database.transaction(async (tx) => {
        await tx.delete(personalGridClaims).where(and(
          eq(personalGridClaims.claimFlight, flightId),
          eq(personalGridClaims.cellSize, cellSize),
        ));

        return rebuildPersonalClaims(tx, { flightId, userId }, cellSize);
      });
    },

    async get({ userId }) {
      const result = await database.execute<StoredProjection>(sql`
        WITH claimed_cells AS (
          SELECT ST_MakeEnvelope(
            x * ${cellSize}, y * ${cellSize},
            (x + 1) * ${cellSize}, (y + 1) * ${cellSize},
            6933
          ) AS geometry
          FROM user_grid_claims
          WHERE claim_user = ${userId}
            AND cell_size = ${cellSize}
        ),
        dissolved AS (
          SELECT ST_UnaryUnion(ST_Collect(geometry)) AS geometry
          FROM claimed_cells
        ),
        connected_regions AS (
          SELECT region.geom AS geometry
          FROM dissolved
          CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(dissolved.geometry, 3)) AS region
          WHERE dissolved.geometry IS NOT NULL
            AND NOT ST_IsEmpty(dissolved.geometry)
        )
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'properties', '{}'::jsonb,
                'geometry', ST_AsGeoJSON(
                  ST_Transform(geometry, 4326)
                )::jsonb
              )
              ORDER BY ST_XMin(geometry), ST_YMin(geometry)
            ),
            '[]'::jsonb
          )
        ) AS geojson
        FROM connected_regions
      `);

      return result.rows[0]?.geojson ?? emptyGridClaimGeoJson();
    },

    async getViewportStats({ userId, west, south, east, north }) {
      const result = await database.execute<StoredViewportStats>(sql`
        WITH ${viewportGridCtes({ west, south, east, north, cellSize })},
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
          (SELECT COUNT(DISTINCT claim_flight)::integer FROM visible_claims) AS "flightCount",
          viewport.visible_cell_count AS "visibleCellCount",
          CASE
            WHEN viewport.visible_cell_count = 0 THEN 0::double precision
            ELSE (COUNT(*)::double precision / viewport.visible_cell_count * 100)::double precision
          END AS "claimedPercentage"
        FROM claimed_cells
        CROSS JOIN viewport_grid_total viewport
        GROUP BY viewport.visible_cell_count
      `);

      return result.rows[0] ?? emptyViewportStats();
    },
  };
}

export function createGridClaimService(
  database: Database,
  options: { cellSize: number },
): GridClaimService {
  const personalGridClaim = createPersonalGridClaimService(database, options);
  const competitionGridClaim = createCompetitionGridClaimService(database, options);

  return {
    get: personalGridClaim.get,
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
