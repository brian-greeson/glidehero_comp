import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { nextUniqueCellMilestone } from './progressionAchievementService.js';
import { findAchievementDefinition, type AchievementCategory, type AchievementDefinition } from '../domain/achievement/catalog.js';
import {
  generalCoverageMilestones,
  generalExplorationMilestones,
  launchVisitMilestones,
  milestoneProgressPercent,
  nextFixedMilestone,
  regionalMilestones,
  selectClosestMilestones,
} from '../domain/achievement/progress.js';
import { arenaPath } from '../domain/arena/arenaRoute.js';

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
  nextUniqueCellMilestone: number;
  uniqueCellsToNextMilestone: number;
  nextUniqueCellMilestoneProgressPercent: number;
  achievementProgress: AchievementProgressCard[];
  completedFlightCount: number;
  lifetimeDirectCellCount: number;
  lifetimeEnclosedCellCount: number;
  currentTotalCellRecord: number | null;
  currentEnclosedCellRecord: number | null;
  achievementCount: number;
  achievements: PilotAchievement[];
  recentFlights: PilotRecentFlight[];
};

export type AchievementProgressCard = {
  key: 'unique_cells' | 'launches_visited' | 'general_arenas_explored' | 'general_coverage' | 'states_flown_in' | 'countries_flown_in';
  achievementType: 'unique_cells_milestone' | 'threshold';
  achievementCategory?: AchievementCategory;
  badgeLabel: string;
  badgeAriaLabel: string;
  typeLabel: string;
  title: string;
  currentValue: number;
  targetValue: number;
  currentLabel: string;
  targetLabel: string;
  progressPercent: number;
  currentDescription: string;
  otherDescription: string;
  arenaPath?: string;
};

export type PilotAchievement = {
  id: string;
  achievementType: string;
  achievementCategory?: AchievementCategory;
  typeLabel: string;
  earnedDate: string;
  sourceFlightId: string | null;
  title: string;
  description: string;
  badgeLabel: string;
  badgeAriaLabel?: string;
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
  getDashboardAchievementProgress(userId: string): Promise<AchievementProgressCard[]>;
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
  achievementKey: string;
  sourceFlightId: string | null;
  earnedAt: Date | string;
  details: unknown;
  isRecordEvent: boolean;
  value: number | string | null;
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

type StoredArenaAchievementProgress = {
  launchArenasVisited: number | string;
  generalArenasExplored: number | string;
  statesFlownIn: number | string;
  countriesFlownIn: number | string;
  bestGeneralClaimedCells: number | string | null;
  bestGeneralTotalCells: number | string | null;
  bestGeneralSourceId: number | string | null;
  bestGeneralName: string | null;
  bestGeneralCountryCode: string | null;
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

function newCellCountText(value: number | null): string {
  return `${countText(value)} new ${value === 1 ? 'cell' : 'cells'}`;
}

function cellCountText(value: number | null): string {
  return `${countText(value)} ${value === 1 ? 'cell' : 'cells'}`;
}

const achievementCategoryLabels: Record<AchievementCategory, string> = {
  launch: 'Launch Arena',
  general: 'General Arena',
  state: 'State',
  country: 'Country',
};

function catalogAchievementDisplay(row: StoredAchievement, definition: AchievementDefinition): PilotAchievement {
  const categoryLabel = achievementCategoryLabels[definition.category];
  const isRecord = definition.kind === 'record';
  const badgeLabel = 'threshold' in definition
    ? (definition.category === 'general' && definition.key.startsWith('general_coverage_')
      ? `${definition.threshold}%`
      : String(definition.threshold))
    : isRecord ? String(row.value ?? detailNumber(detailsObject(row.details), 'value') ?? 'PB') : '★';
  return {
    id: row.id,
    achievementType: definition.kind,
    achievementCategory: definition.category,
    typeLabel: isRecord ? `${categoryLabel} personal best` : categoryLabel,
    earnedDate: displayDate(row.earnedAt),
    sourceFlightId: row.sourceFlightId,
    title: definition.title,
    description: definition.description,
    badgeLabel,
    badgeAriaLabel: `${categoryLabel} ${isRecord ? 'personal-best' : definition.kind} achievement${'threshold' in definition ? `: ${badgeLabel}` : ''}`,
  };
}

function recordEventDisplay(row: StoredAchievement, definition: AchievementDefinition): PilotAchievement {
  const value = Number(row.value ?? detailNumber(detailsObject(row.details), 'value') ?? 0);
  const previousValue = detailNumber(detailsObject(row.details), 'previousValue');
  const launchCount = `${value} Launch Arena${value === 1 ? '' : 's'}`;
  const description = previousValue === null
    ? `Tagged ${launchCount} during one flight, establishing an initial record.`
    : `Tagged ${launchCount} during one flight, improving the previous best of ${previousValue}.`;
  return {
    id: row.id,
    achievementType: definition.kind,
    achievementCategory: definition.category,
    typeLabel: 'Launch Arena personal best',
    earnedDate: displayDate(row.earnedAt),
    sourceFlightId: row.sourceFlightId,
    title: definition.title,
    description,
    badgeLabel: String(value),
    badgeAriaLabel: `Launch Arena personal-best record: ${value} tagged`,
  };
}

function achievementDisplay(row: StoredAchievement): PilotAchievement {
  const definition = findAchievementDefinition(row.achievementKey);
  // Record definitions are written only through achievement_record_events. Treat a
  // malformed ordinary row as legacy data instead of presenting it as a valid event.
  if (definition && (row.isRecordEvent || definition.kind !== 'record')) {
    return row.isRecordEvent ? recordEventDisplay(row, definition) : catalogAchievementDisplay(row, definition);
  }

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
      : `Reached ${milestone} unique Personal Map cells, adding ${newCellCountText(newCells)} to a total of ${countText(newTotal)}.`;
    return {
      id: row.id,
      achievementType: row.achievementType,
      typeLabel: 'Unique cell milestone',
      earnedDate: displayDate(row.earnedAt),
      sourceFlightId: row.sourceFlightId,
      title,
      description,
      badgeLabel: milestone === null ? 'Cells' : String(milestone),
    };
  }

  if (row.achievementType === 'personal_best_total_cells') {
    const record = countText(newRecord);
    const description = previousRecord === null
      ? `Established an initial total-cell record of ${cellCountText(newRecord)} (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`
      : `Improved the total-cell record from ${previousRecord} to ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`;
    return {
      id: row.id,
      achievementType: row.achievementType,
      typeLabel: 'Total-cell personal best',
      earnedDate: displayDate(row.earnedAt),
      sourceFlightId: row.sourceFlightId,
      title: 'New Flight Cell Record',
      description,
      badgeLabel: 'PB',
    };
  }

  if (row.achievementType === 'personal_best_enclosed_cells') {
    const record = countText(newRecord);
    const description = previousRecord === null
      ? `Established an initial enclosed-cell record of ${cellCountText(newRecord)} (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`
      : `Improved the enclosed-cell record from ${previousRecord} to ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`;
    return {
      id: row.id,
      achievementType: row.achievementType,
      typeLabel: 'Enclosed-cell personal best',
      earnedDate: displayDate(row.earnedAt),
      sourceFlightId: row.sourceFlightId,
      title: 'New Enclosed Cell Record',
      description,
      badgeLabel: 'Loop',
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
    badgeLabel: 'Award',
  };
}

function countProgressCard(input: {
  key: AchievementProgressCard['key'];
  category?: AchievementCategory;
  current: number;
  target: number;
  typeLabel: string;
  title: string;
  currentDescription: string;
  otherDescription: string;
}): AchievementProgressCard {
  return {
    key: input.key,
    achievementType: input.key === 'unique_cells' ? 'unique_cells_milestone' : 'threshold',
    ...(input.category ? { achievementCategory: input.category } : {}),
    badgeLabel: String(input.target),
    badgeAriaLabel: `${input.typeLabel} progress toward ${input.target}`,
    typeLabel: input.typeLabel,
    title: input.title,
    currentValue: input.current,
    targetValue: input.target,
    currentLabel: String(input.current),
    targetLabel: String(input.target),
    progressPercent: milestoneProgressPercent(input.current, input.target),
    currentDescription: input.currentDescription,
    otherDescription: input.otherDescription,
  };
}

function buildAchievementProgress(
  profile: Pick<StoredPilotProfile, 'displayName'> & { lifetimeUniqueCellCount: number },
  arenaProgress: StoredArenaAchievementProgress,
): AchievementProgressCard[] {
  const cards: AchievementProgressCard[] = [];
  const uniqueTarget = nextUniqueCellMilestone(profile.lifetimeUniqueCellCount);
  const uniqueRemaining = uniqueTarget - profile.lifetimeUniqueCellCount;
  cards.push(countProgressCard({
    key: 'unique_cells', current: profile.lifetimeUniqueCellCount, target: uniqueTarget,
    typeLabel: 'Unique cell milestone', title: `${uniqueTarget} Unique Cells`,
    currentDescription: `Claim ${uniqueRemaining} more ${uniqueRemaining === 1 ? 'cell' : 'cells'} on your Personal Map.`,
    otherDescription: `${profile.displayName} needs ${uniqueRemaining} more ${uniqueRemaining === 1 ? 'cell' : 'cells'} to reach this Personal Map milestone.`,
  }));

  const launchCount = Number(arenaProgress.launchArenasVisited);
  const launchTarget = nextFixedMilestone(launchCount, launchVisitMilestones);
  if (launchTarget !== null) {
    const remaining = launchTarget - launchCount;
    cards.push(countProgressCard({
      key: 'launches_visited', category: 'launch', current: launchCount, target: launchTarget,
      typeLabel: 'Launch Arena milestone', title: `${launchTarget} Launch Arenas Visited`,
      currentDescription: `Visit ${remaining} more Launch Arena${remaining === 1 ? '' : 's'}.`,
      otherDescription: `${profile.displayName} needs to visit ${remaining} more Launch Arena${remaining === 1 ? '' : 's'}.`,
    }));
  }

  const generalCount = Number(arenaProgress.generalArenasExplored);
  const generalTarget = nextFixedMilestone(generalCount, generalExplorationMilestones);
  if (generalTarget !== null) {
    const remaining = generalTarget - generalCount;
    cards.push(countProgressCard({
      key: 'general_arenas_explored', category: 'general', current: generalCount, target: generalTarget,
      typeLabel: 'General Arena milestone', title: `${generalTarget} General Arena${generalTarget === 1 ? '' : 's'} Explored`,
      currentDescription: `Claim a cell in ${remaining} more General Arena${remaining === 1 ? '' : 's'}.`,
      otherDescription: `${profile.displayName} needs to claim a cell in ${remaining} more General Arena${remaining === 1 ? '' : 's'}.`,
    }));
  }

  const bestClaimed = Number(arenaProgress.bestGeneralClaimedCells ?? 0);
  const bestTotal = Number(arenaProgress.bestGeneralTotalCells ?? 0);
  const exactCoverage = bestTotal > 0 ? Math.min(100, bestClaimed * 100 / bestTotal) : 0;
  const coverageTarget = nextFixedMilestone(exactCoverage, generalCoverageMilestones);
  if (coverageTarget !== null) {
    const displayedCoverage = Math.floor(exactCoverage * 10) / 10;
    const arenaName = arenaProgress.bestGeneralName;
    const coverageCard: AchievementProgressCard = {
      key: 'general_coverage', achievementType: 'threshold', achievementCategory: 'general',
      badgeLabel: `${coverageTarget}%`, badgeAriaLabel: `General Arena coverage progress toward ${coverageTarget}%`,
      typeLabel: 'General Arena coverage', title: `${coverageTarget}% General Arena Coverage`,
      currentValue: displayedCoverage, targetValue: coverageTarget,
      currentLabel: `${displayedCoverage}%`, targetLabel: `${coverageTarget}%`,
      progressPercent: milestoneProgressPercent(exactCoverage, coverageTarget),
      currentDescription: arenaName
        ? `Keep claiming cells in ${arenaName} to reach ${coverageTarget}% coverage.`
        : `Claim cells in a General Arena to reach ${coverageTarget}% coverage.`,
      otherDescription: arenaName
        ? `${profile.displayName} is working toward ${coverageTarget}% coverage in ${arenaName}.`
        : `${profile.displayName} needs to claim cells in a General Arena to begin this milestone.`,
    };
    const sourceId = Number(arenaProgress.bestGeneralSourceId);
    if (arenaName && Number.isSafeInteger(sourceId) && sourceId > 0 && arenaProgress.bestGeneralCountryCode) {
      coverageCard.arenaPath = arenaPath({ sourceId, name: arenaName, countryCode: arenaProgress.bestGeneralCountryCode });
    }
    cards.push(coverageCard);
  }

  for (const regional of [
    { key: 'states_flown_in', category: 'state', count: Number(arenaProgress.statesFlownIn), singular: 'State', plural: 'States' },
    { key: 'countries_flown_in', category: 'country', count: Number(arenaProgress.countriesFlownIn), singular: 'Country', plural: 'Countries' },
  ] as const) {
    const target = nextFixedMilestone(regional.count, regionalMilestones);
    if (target === null) continue;
    const remaining = target - regional.count;
    cards.push(countProgressCard({
      key: regional.key, category: regional.category, current: regional.count, target,
      typeLabel: `${regional.singular} milestone`, title: `${target} ${target === 1 ? regional.singular : regional.plural} Flown in`,
      currentDescription: `Claim a cell in ${remaining} more ${remaining === 1 ? regional.singular : regional.plural}.`,
      otherDescription: `${profile.displayName} needs to claim a cell in ${remaining} more ${remaining === 1 ? regional.singular : regional.plural}.`,
    }));
  }
  return cards;
}

async function loadArenaAchievementProgress(
  database: Database,
  options: { cellSize: number },
  userId: string,
): Promise<StoredArenaAchievementProgress> {
  const result = await database.execute<StoredArenaAchievementProgress>(sql`
    WITH arena_cell_counts AS (
      SELECT arena.id, arena.source_id, arena.name, arena.country_code, arena.arena_type,
             arena.claimable_cell_count, arena.claimable_cell_size,
             COALESCE(personal_cells.claimed_cells, 0)::integer AS claimed_cells
      FROM arenas arena
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT (claims.x, claims.y))::integer AS claimed_cells
        FROM user_grid_claims claims
        WHERE claims.claim_user = ${userId}
          AND claims.cell_size = ${options.cellSize}
          AND claims.x BETWEEN FLOOR(ST_XMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_XMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND claims.y BETWEEN FLOOR(ST_YMin(Box3D(arena.area)) / ${options.cellSize})::integer - 1
                           AND CEIL(ST_YMax(Box3D(arena.area)) / ${options.cellSize})::integer + 1
          AND ST_Covers(
            arena.area,
            ST_SetSRID(ST_MakePoint(
              (claims.x + 0.5) * ${options.cellSize},
              (claims.y + 0.5) * ${options.cellSize}
            ), 6933)
          )
      ) personal_cells ON TRUE
      WHERE arena.arena_type IN ('general', 'state', 'country')
    ), launch_visits AS (
      SELECT DISTINCT arena.id
      FROM arenas arena
      INNER JOIN flights flight
        ON flight.user_id = ${userId}
       AND flight.processing_status = 'completed'
       AND flight.launch_latitude IS NOT NULL
       AND flight.launch_longitude IS NOT NULL
       AND ST_Covers(
         arena.area,
         ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
       )
      WHERE arena.arena_type = 'launch'
    ), best_general AS (
      SELECT source_id, name, country_code, claimed_cells, claimable_cell_count
      FROM arena_cell_counts
      WHERE arena_type = 'general'
        AND claimed_cells > 0
        AND claimable_cell_count > 0
        AND claimable_cell_size = ${options.cellSize}
      ORDER BY claimed_cells::numeric / claimable_cell_count DESC, lower(name), source_id
      LIMIT 1
    )
    SELECT
      (SELECT COUNT(*)::integer FROM launch_visits) AS "launchArenasVisited",
      COUNT(*) FILTER (WHERE arena_type = 'general' AND claimed_cells > 0)::integer AS "generalArenasExplored",
      COUNT(*) FILTER (WHERE arena_type = 'state' AND claimed_cells > 0)::integer AS "statesFlownIn",
      COUNT(*) FILTER (WHERE arena_type = 'country' AND claimed_cells > 0)::integer AS "countriesFlownIn",
      (SELECT claimed_cells FROM best_general) AS "bestGeneralClaimedCells",
      (SELECT claimable_cell_count FROM best_general) AS "bestGeneralTotalCells",
      (SELECT source_id FROM best_general) AS "bestGeneralSourceId",
      (SELECT name FROM best_general) AS "bestGeneralName",
      (SELECT country_code FROM best_general) AS "bestGeneralCountryCode"
    FROM arena_cell_counts
  `);
  return result.rows[0] ?? {
    launchArenasVisited: 0,
    generalArenasExplored: 0,
    statesFlownIn: 0,
    countriesFlownIn: 0,
    bestGeneralClaimedCells: null,
    bestGeneralTotalCells: null,
    bestGeneralSourceId: null,
    bestGeneralName: null,
    bestGeneralCountryCode: null,
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

    async getDashboardAchievementProgress(userId) {
      const result = await database.execute<{
        displayName: string;
        lifetimeUniqueCellCount: number | string;
      }>(sql`
        SELECT
          profiles.display_name AS "displayName",
          COUNT(DISTINCT (claims.x, claims.y))::integer AS "lifetimeUniqueCellCount"
        FROM users
        INNER JOIN profiles ON profiles.user_id = users.user_id
        LEFT JOIN user_grid_claims claims
          ON claims.claim_user = users.user_id
         AND claims.cell_size = ${options.cellSize}
        WHERE users.user_id = ${userId}
        GROUP BY users.user_id, profiles.display_name
      `);
      const row = result.rows[0];
      if (!row) return [];
      const progress = buildAchievementProgress({
        displayName: row.displayName,
        lifetimeUniqueCellCount: Number(row.lifetimeUniqueCellCount),
      }, await loadArenaAchievementProgress(database, options, userId));
      return selectClosestMilestones(progress, 3);
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
            (SELECT COUNT(*) FROM achievements earned WHERE earned.user_id = users.user_id)
            + (SELECT COUNT(*) FROM achievement_record_events event WHERE event.user_id = users.user_id)
          )::integer AS "achievementCount"
        FROM users
        INNER JOIN profiles ON profiles.user_id = users.user_id
        WHERE users.user_id = ${userId}
      `);
      const row = result.rows[0];
      if (!row) return null;
      const lifetimeUniqueCellCount = Number(row.lifetimeUniqueCellCount);
      const nextMilestone = nextUniqueCellMilestone(lifetimeUniqueCellCount);
      const [achievementRows, recentFlightRows, arenaProgress] = await Promise.all([
        database.execute<StoredAchievement & { totalCount: number | string }>(sql`
          WITH displayable AS (
            SELECT
              earned.id::text AS id,
              earned.achievement_type AS "achievementType",
              earned.achievement_key AS "achievementKey",
              earned.source_flight_id AS "sourceFlightId",
              earned.earned_at AS "earnedAt",
              earned.details,
              false AS "isRecordEvent",
              NULL::integer AS value
            FROM achievements earned
            WHERE earned.user_id = ${userId}
            UNION ALL
            SELECT
              ('record-event:' || event.id::text) AS id,
              'record' AS "achievementType",
              record.record_key AS "achievementKey",
              event.source_flight_id AS "sourceFlightId",
              event.earned_at AS "earnedAt",
              event.details,
              true AS "isRecordEvent",
              event.value
            FROM achievement_record_events event
            INNER JOIN achievement_records record ON record.id = event.record_id
            WHERE event.user_id = ${userId}
          )
          SELECT displayable.*, COUNT(*) OVER()::integer AS "totalCount"
          FROM displayable
          ORDER BY displayable."earnedAt" DESC, displayable.id DESC
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
          ORDER BY flights.started_at DESC NULLS LAST, progress.evaluated_at DESC, progress.flight_id DESC
          LIMIT 20
        `),
        loadArenaAchievementProgress(database, options, userId),
      ]);
      const achievementProgress = buildAchievementProgress({
        displayName: row.displayName,
        lifetimeUniqueCellCount,
      }, arenaProgress);
      return {
        userId: row.userId,
        displayName: row.displayName,
        territoryColor: row.territoryColor,
        lifetimeUniqueCellCount,
        nextUniqueCellMilestone: nextMilestone,
        uniqueCellsToNextMilestone: nextMilestone - lifetimeUniqueCellCount,
        nextUniqueCellMilestoneProgressPercent: milestoneProgressPercent(lifetimeUniqueCellCount, nextMilestone),
        achievementProgress,
        completedFlightCount: Number(row.completedFlightCount),
        lifetimeDirectCellCount: Number(row.lifetimeDirectCellCount),
        lifetimeEnclosedCellCount: Number(row.lifetimeEnclosedCellCount),
        currentTotalCellRecord: numberOrNull(row.currentTotalCellRecord),
        currentEnclosedCellRecord: numberOrNull(row.currentEnclosedCellRecord),
        achievementCount: Number(achievementRows.rows[0]?.totalCount ?? row.achievementCount),
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
