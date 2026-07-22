import { and, eq, exists, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { activities, activityReactions, arenas, flightProgress, flights, pilotFollows, profiles } from '../db/schema.js';
import { arenaPath } from '../domain/arena/arenaRoute.js';
import { findAchievementDefinition } from '../domain/achievement/catalog.js';

export type ActivityTransaction = Pick<Parameters<Parameters<Database['transaction']>[0]>[0], 'insert'>;

export type PublishFlightActivityInput = {
  actorUserId: string;
  sourceFlightId: string;
  publishedAt: Date;
};

export type ActivityFeedItem = {
  id: string;
  actorUserId: string;
  actorDisplayName: string;
  activityType: string;
  sourceFlightId: string | null;
  publishedAt: Date;
  publishedAtIso: string;
  publishedAtLabel: string;
  /** Flight summary fields are absent for future non-flight activity types. */
  flightDate?: string;
  duration?: string;
  distance?: string;
  totalCellCount?: number;
  location?: string;
  launchArenaName?: string | null;
  launchArenaPath?: string | null;
  accomplishments: ActivityAccomplishment[];
  thermalCount: number;
  viewerHasReacted: boolean;
  /** True when this card belongs to the viewer; owners cannot react to themselves. */
  isOwn: boolean;
};

export type ActivityAccomplishment = {
  id: string;
  /** Stable catalog/legacy identity used by presentation adapters. */
  achievementKey: string;
  title: string;
  description: string;
  /** Display metadata shared by the refreshed Activity and Achievements cards. */
  badgeLabel: string;
  category: string;
  kind: string;
  tone: 'green' | 'blue' | 'orange' | 'purple';
  arenaName?: string;
  arenaPath?: string;
};

export type ActivityFeedScope = 'all' | 'following' | 'yours';

export type ActivityCursor = { publishedAt: Date; id: string };

export type ActivityFeedPage = {
  items: ActivityFeedItem[];
  nextCursor: string | null;
};

export class ActivityCursorError extends Error {
  constructor() {
    super('Activity cursor is invalid.');
    this.name = 'ActivityCursorError';
  }
}

export class ActivityNotFoundError extends Error {
  constructor() {
    super('Activity not found.');
    this.name = 'ActivityNotFoundError';
  }
}

export class SelfThermalError extends Error {
  constructor() {
    super('You cannot send a Thermal to your own activity.');
    this.name = 'SelfThermalError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function displayFlightDate(value: Date | null, timeZone: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      timeZone: timeZone || 'UTC',
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
    }).format(value);
  }
}

function displayDistance(value: number | string | null): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value) / 1_000)} km`;
}

function displayDuration(value: number | string | null): string {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const totalSeconds = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function displayCoordinate(value: number | string | null): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(value).toFixed(4);
}

function storedTimestamp(value: Date | string): Date {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error('Activity accomplishment timestamp is invalid.');
  return timestamp;
}

type ActivityAchievementRow = {
  id: string;
  sourceFlightId: string;
  achievementType: string;
  achievementKey: string;
  earnedAt: Date | string;
  details: unknown;
  arenaId: string | null;
  arenaName: string | null;
  arenaSourceId: number | string | null;
  arenaCountryCode: string | null;
};

type ActivityRecordEventRow = {
  id: string;
  sourceFlightId: string;
  recordKey: string;
  value: number;
  earnedAt: Date | string;
  details: unknown;
};

type ActivityLeadershipRow = {
  id: string;
  sourceFlightId: string;
  eventType: 'took' | 'reclaimed';
  claimTimestamp: Date | string;
  arenaId: string;
  arenaName: string;
  arenaSourceId: number | string;
  arenaCountryCode: string;
};

function detailsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function detailNumber(details: Record<string, unknown>, key: string): number | null {
  const value = details[key];
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function countText(value: number | null): string {
  return value === null ? 'an unknown number of' : String(value);
}

function cellCountText(value: number | null): string {
  return `${countText(value)} ${value === 1 ? 'cell' : 'cells'}`;
}

function accomplishmentTone(category: string | undefined, kind: string | undefined): ActivityAccomplishment['tone'] {
  if (kind === 'record') return 'blue';
  if (category === 'leadership') return 'purple';
  if (category === 'launch') return 'orange';
  return 'green';
}

function accomplishmentMetadata(input: {
  key?: string;
  category?: string;
  kind?: string;
  threshold?: number;
  milestone?: number | null;
}): Pick<ActivityAccomplishment, 'badgeLabel' | 'category' | 'kind' | 'tone'> {
  const category = input.category ?? 'general';
  const kind = input.kind ?? 'special';
  const badgeLabel = input.threshold !== undefined
    ? String(input.threshold)
    : input.milestone !== null && input.milestone !== undefined
      ? String(input.milestone)
      : kind === 'record' ? 'PB' : category === 'leadership' ? '★' : '•';
  return { badgeLabel, category, kind, tone: accomplishmentTone(category, kind) };
}

function achievementAccomplishment(row: ActivityAchievementRow): ActivityAccomplishment {
  const details = detailsObject(row.details);
  const definition = findAchievementDefinition(row.achievementKey);
  const arenaName = row.arenaName ?? (typeof details.arenaName === 'string' && details.arenaName.trim() ? details.arenaName.trim() : undefined);
  const linkedArena = arenaName && row.arenaSourceId !== null && row.arenaCountryCode
    ? { arenaName, arenaPath: arenaPath({ sourceId: Number(row.arenaSourceId), name: arenaName, countryCode: row.arenaCountryCode }) }
    : {};
  if (definition) {
    const isLeadership = row.achievementKey === 'took_lead_in_arena' || row.achievementKey === 'reclaimed_lead_in_arena';
    const title = isLeadership && arenaName
      ? `${row.achievementKey === 'took_lead_in_arena' ? 'Took' : 'Reclaimed'} the Lead in ${arenaName}`
      : definition.title;
    const description = isLeadership && arenaName ? `${title}.` : definition.description;
    return {
      id: row.id,
      achievementKey: row.achievementKey,
      title,
      description,
      ...accomplishmentMetadata({ category: definition.category, kind: definition.kind, threshold: 'threshold' in definition ? definition.threshold : undefined }),
      ...linkedArena,
    };
  }

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
      : `Reached ${milestone} unique Personal Map cells, adding ${countText(newCells)} new ${newCells === 1 ? 'cell' : 'cells'} to a total of ${countText(newTotal)}.`;
    return {
      id: row.id,
      achievementKey: row.achievementType,
      title,
      description,
      ...accomplishmentMetadata({ category: 'general', kind: 'threshold', milestone }),
      ...linkedArena,
    };
  }
  if (row.achievementType === 'personal_best_total_cells' || row.achievementType === 'personal_best_enclosed_cells') {
    const enclosed = row.achievementType === 'personal_best_enclosed_cells';
    const record = countText(newRecord);
    const description = previousRecord === null
      ? `Established an initial ${enclosed ? 'enclosed-cell' : 'total-cell'} record of ${cellCountText(newRecord)} (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`
      : `Improved the ${enclosed ? 'enclosed-cell' : 'total-cell'} record from ${previousRecord} to ${record} cells (${countText(directCells)} direct and ${countText(enclosedCells)} enclosed).`;
    return {
      id: row.id,
      achievementKey: row.achievementType,
      title: enclosed ? 'New Enclosed Cell Record' : 'New Flight Cell Record',
      description,
      ...accomplishmentMetadata({ category: 'general', kind: 'record' }),
      ...linkedArena,
    };
  }
  return {
    id: row.id,
    achievementKey: row.achievementKey,
    title: 'Progress Achievement',
    description: 'A progression achievement earned during a flight.',
    ...accomplishmentMetadata({}),
    ...linkedArena,
  };
}

function recordAccomplishment(row: ActivityRecordEventRow): ActivityAccomplishment {
  const definition = findAchievementDefinition(row.recordKey);
  const details = detailsObject(row.details);
  const previousValue = detailNumber(details, 'previousValue');
  const count = `${row.value} Launch Arena${row.value === 1 ? '' : 's'}`;
  return {
    id: row.id,
    achievementKey: row.recordKey,
    title: definition?.title ?? 'Personal Best',
    description: previousValue === null
      ? `Tagged ${count} during one flight, establishing an initial record.`
      : `Tagged ${count} during one flight, improving the previous best of ${previousValue}.`,
    ...accomplishmentMetadata({ category: definition?.category, kind: 'record' }),
  };
}

function leadershipAccomplishment(row: ActivityLeadershipRow): ActivityAccomplishment {
  const verb = row.eventType === 'took' ? 'Took' : 'Reclaimed';
  return {
    id: row.id,
    achievementKey: row.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena',
    title: `${verb} the Lead in ${row.arenaName}`,
    description: `${verb} the lead in ${row.arenaName}.`,
    ...accomplishmentMetadata({ category: 'leadership', kind: 'special' }),
    arenaName: row.arenaName,
    arenaPath: arenaPath({ sourceId: Number(row.arenaSourceId), name: row.arenaName, countryCode: row.arenaCountryCode }),
  };
}

async function loadFlightAccomplishments(database: Database, sourceFlightIds: readonly string[]): Promise<Map<string, ActivityAccomplishment[]>> {
  const result = new Map<string, ActivityAccomplishment[]>();
  const ordered = new Map<string, Array<{ item: ActivityAccomplishment; at: Date; id: string }>>();
  if (sourceFlightIds.length === 0) return result;
  // Keep each read bounded to the visible page. The JSON parameter is expanded
  // by PostgreSQL so no JavaScript array is interpolated into an ANY clause.
  const ids = JSON.stringify([...new Set(sourceFlightIds)]);
  const flightIds = sql`SELECT value::uuid AS flight_id FROM jsonb_array_elements_text(${ids}::jsonb) AS value`;
  const achievementRows = await database.execute<ActivityAchievementRow>(sql`
    WITH flight_ids AS (${flightIds})
    SELECT earned.id, earned.source_flight_id AS "sourceFlightId", earned.achievement_type AS "achievementType",
           earned.achievement_key AS "achievementKey", earned.earned_at AS "earnedAt", earned.details,
           achievement_arena.id AS "arenaId", achievement_arena.name AS "arenaName",
           achievement_arena.source_id AS "arenaSourceId", achievement_arena.country_code AS "arenaCountryCode"
    FROM achievements earned
    INNER JOIN flight_ids ON flight_ids.flight_id = earned.source_flight_id
    LEFT JOIN arenas achievement_arena ON achievement_arena.id = CASE
      WHEN earned.details->>'arenaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (earned.details->>'arenaId')::uuid
      ELSE NULL
    END
    ORDER BY earned.earned_at ASC, earned.id ASC
  `);
  const recordRows = await database.execute<ActivityRecordEventRow>(sql`
    WITH flight_ids AS (${flightIds})
    SELECT event.id, event.source_flight_id AS "sourceFlightId", record.record_key AS "recordKey",
           event.value, event.earned_at AS "earnedAt", event.details
    FROM achievement_record_events event
    INNER JOIN achievement_records record ON record.id = event.record_id
    INNER JOIN flight_ids ON flight_ids.flight_id = event.source_flight_id
    ORDER BY event.earned_at ASC, event.id ASC
  `);
  const leadershipRows = await database.execute<ActivityLeadershipRow>(sql`
    WITH flight_ids AS (${flightIds})
    SELECT event.id, event.source_flight_id AS "sourceFlightId", event.event_type AS "eventType",
           event.claim_timestamp AS "claimTimestamp", arena.id AS "arenaId", arena.name AS "arenaName",
           arena.source_id AS "arenaSourceId", arena.country_code AS "arenaCountryCode"
    FROM arena_leadership_events event
    INNER JOIN flight_ids ON flight_ids.flight_id = event.source_flight_id
    INNER JOIN arenas arena ON arena.id = event.arena_id
    WHERE event.event_type IN ('took', 'reclaimed')
    ORDER BY event.claim_timestamp ASC, event.id ASC
  `);
  const leadershipKeys = new Set(leadershipRows.rows.map((row) => {
    const type = row.eventType === 'took' ? 'took_lead_in_arena' : 'reclaimed_lead_in_arena';
    return `${row.sourceFlightId}:${type}:${row.arenaId}`;
  }));
  for (const row of achievementRows.rows) {
    const isLeadership = row.achievementKey === 'took_lead_in_arena' || row.achievementKey === 'reclaimed_lead_in_arena';
    const arenaId = typeof detailsObject(row.details).arenaId === 'string' ? detailsObject(row.details).arenaId : '';
    if (isLeadership && arenaId && leadershipKeys.has(`${row.sourceFlightId}:${row.achievementKey}:${arenaId}`)) continue;
    const list = ordered.get(row.sourceFlightId) ?? [];
    list.push({ item: achievementAccomplishment(row), at: storedTimestamp(row.earnedAt), id: row.id });
    ordered.set(row.sourceFlightId, list);
  }
  for (const row of recordRows.rows) {
    const list = ordered.get(row.sourceFlightId) ?? [];
    list.push({ item: recordAccomplishment(row), at: storedTimestamp(row.earnedAt), id: row.id });
    ordered.set(row.sourceFlightId, list);
  }
  for (const row of leadershipRows.rows) {
    const list = ordered.get(row.sourceFlightId) ?? [];
    list.push({ item: leadershipAccomplishment(row), at: storedTimestamp(row.claimTimestamp), id: row.id });
    ordered.set(row.sourceFlightId, list);
  }
  for (const [flightId, list] of ordered) {
    list.sort((left, right) => left.at.getTime() - right.at.getTime() || left.id.localeCompare(right.id));
    result.set(flightId, list.map((entry) => entry.item));
  }
  return result;
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify({ publishedAt: cursor.publishedAt.toISOString(), id: cursor.id }), 'utf8')
    .toString('base64url');
}

export function decodeActivityCursor(value: string | undefined): ActivityCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error();
    const candidate = parsed as { publishedAt?: unknown; id?: unknown };
    if (typeof candidate.publishedAt !== 'string' || typeof candidate.id !== 'string' || !uuidPattern.test(candidate.id)) throw new Error();
    const publishedAt = new Date(candidate.publishedAt);
    if (!Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString() !== candidate.publishedAt) throw new Error();
    if (encodeActivityCursor({ publishedAt, id: candidate.id }) !== value) throw new Error();
    return { publishedAt, id: candidate.id };
  } catch {
    throw new ActivityCursorError();
  }
}

export type ActivityService = {
  publishFlightInTransaction(
    transaction: ActivityTransaction,
    input: PublishFlightActivityInput,
  ): Promise<{ id: string }>;
  listFeed(input: { viewerUserId: string; limit?: number; before?: string; q?: string; scope?: ActivityFeedScope }): Promise<ActivityFeedPage>;
  toggleThermal(input: { viewerUserId: string; activityId: string }): Promise<{ reacted: boolean; totalCount: number }>;
};

/** Publish a flight activity using the caller's completion transaction. */
export function createActivityService(database?: Database): ActivityService {
  return {
    async publishFlightInTransaction(transaction, input) {
      const [activity] = await transaction
        .insert(activities)
        .values({
          actorUserId: input.actorUserId,
          activityType: 'flight',
          sourceFlightId: input.sourceFlightId,
          publishedAt: input.publishedAt,
        })
        .returning({ id: activities.id });
      if (!activity) throw new Error('Activity insert returned no row.');
      return activity;
    },

    async listFeed({ viewerUserId, limit = 20, before, scope = 'all' }) {
      if (!database) throw new Error('Activity reads require a database.');
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Activity limit is invalid.');
      if (scope !== 'all' && scope !== 'following' && scope !== 'yours') throw new Error('Activity scope is invalid.');
      const cursor = decodeActivityCursor(before);
      const following = exists(database.select({ one: sql`1` }).from(pilotFollows).where(and(
        eq(pilotFollows.followerUserId, viewerUserId),
        eq(pilotFollows.followedUserId, activities.actorUserId),
      )));
      const visibility = scope === 'yours'
        ? eq(activities.actorUserId, viewerUserId)
        : scope === 'following'
          ? following
          : or(eq(activities.actorUserId, viewerUserId), following);
      const where = cursor
        ? and(visibility, sql`(${activities.publishedAt} < ${cursor.publishedAt} OR (${activities.publishedAt} = ${cursor.publishedAt} AND ${activities.id} < ${cursor.id}))`)
        : visibility;
      const rows = await database.select({
        id: activities.id,
        actorUserId: activities.actorUserId,
        actorDisplayName: profiles.displayName,
        activityType: activities.activityType,
        sourceFlightId: activities.sourceFlightId,
        publishedAt: activities.publishedAt,
        thermalCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM ${activityReactions} reaction_count
          WHERE reaction_count.activity_id = ${activities.id}
        )`,
        viewerHasReacted: sql<boolean>`CASE
          WHEN ${activities.actorUserId} = ${viewerUserId} THEN false
          ELSE EXISTS (
            SELECT 1 FROM ${activityReactions} reaction_viewer
            WHERE reaction_viewer.activity_id = ${activities.id}
              AND reaction_viewer.reactor_user_id = ${viewerUserId}
          )
        END`,
        flightStartedAt: flights.startedAt,
        flightLaunchTimezone: flights.launchTimezone,
        durationSeconds: flights.durationSeconds,
        distanceMeters: flights.distanceMeters,
        launchLatitude: flights.launchLatitude,
        launchLongitude: flights.launchLongitude,
        directCellCount: flightProgress.directCellCount,
        enclosedCellCount: flightProgress.enclosedCellCount,
        launchArenaName: sql<string | null>`(
          SELECT launch.name
          FROM ${arenas} launch
          WHERE launch.arena_type = 'launch'
            AND ${flights.launchLatitude} IS NOT NULL
            AND ${flights.launchLongitude} IS NOT NULL
            AND ST_Covers(
              launch.area,
              ST_Transform(ST_SetSRID(ST_MakePoint(${flights.launchLongitude}, ${flights.launchLatitude}), 4326), 6933)
            )
          ORDER BY launch.source_id ASC, launch.id ASC
          LIMIT 1
        )`,
        launchArenaSourceId: sql<number | null>`(
          SELECT launch.source_id
          FROM ${arenas} launch
          WHERE launch.arena_type = 'launch'
            AND ${flights.launchLatitude} IS NOT NULL
            AND ${flights.launchLongitude} IS NOT NULL
            AND ST_Covers(
              launch.area,
              ST_Transform(ST_SetSRID(ST_MakePoint(${flights.launchLongitude}, ${flights.launchLatitude}), 4326), 6933)
            )
          ORDER BY launch.source_id ASC, launch.id ASC
          LIMIT 1
        )`,
        launchArenaCountryCode: sql<string | null>`(
          SELECT launch.country_code
          FROM ${arenas} launch
          WHERE launch.arena_type = 'launch'
            AND ${flights.launchLatitude} IS NOT NULL
            AND ${flights.launchLongitude} IS NOT NULL
            AND ST_Covers(
              launch.area,
              ST_Transform(ST_SetSRID(ST_MakePoint(${flights.launchLongitude}, ${flights.launchLatitude}), 4326), 6933)
            )
          ORDER BY launch.source_id ASC, launch.id ASC
          LIMIT 1
        )`,
      })
        .from(activities)
        .innerJoin(profiles, eq(profiles.userId, activities.actorUserId))
        .leftJoin(flights, eq(flights.id, activities.sourceFlightId))
        .leftJoin(flightProgress, eq(flightProgress.flightId, flights.id))
        .where(where)
        .orderBy(sql`${activities.publishedAt} DESC`, sql`${activities.id} DESC`)
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;
      const accomplishments = await loadFlightAccomplishments(database, visibleRows
        .filter((row) => row.activityType === 'flight' && row.sourceFlightId !== null)
        .map((row) => row.sourceFlightId as string));
      const items = visibleRows.map((row) => {
        const launchArenaPath = row.launchArenaName && row.launchArenaSourceId !== null && row.launchArenaCountryCode
          ? arenaPath({ sourceId: Number(row.launchArenaSourceId), name: row.launchArenaName, countryCode: row.launchArenaCountryCode })
          : null;
        const latitude = displayCoordinate(row.launchLatitude);
        const longitude = displayCoordinate(row.launchLongitude);
        const location = row.launchArenaName
          ? row.launchArenaName
          : latitude !== null && longitude !== null ? `${latitude}, ${longitude}` : 'Unknown location';
        return {
          id: row.id,
          actorUserId: row.actorUserId,
          actorDisplayName: row.actorDisplayName,
          activityType: row.activityType,
          sourceFlightId: row.sourceFlightId,
          publishedAt: row.publishedAt,
          thermalCount: Number(row.thermalCount ?? 0),
          viewerHasReacted: Boolean(row.viewerHasReacted),
          isOwn: row.actorUserId === viewerUserId,
          flightDate: row.activityType === 'flight' ? displayFlightDate(row.flightStartedAt, row.flightLaunchTimezone) : undefined,
          duration: row.activityType === 'flight' ? displayDuration(row.durationSeconds) : undefined,
          distance: row.activityType === 'flight' ? displayDistance(row.distanceMeters) : undefined,
          totalCellCount: row.activityType === 'flight'
            ? Number(row.directCellCount ?? 0) + Number(row.enclosedCellCount ?? 0)
            : undefined,
          location: row.activityType === 'flight' ? location : undefined,
          launchArenaName: row.activityType === 'flight' ? row.launchArenaName : undefined,
          launchArenaPath: row.activityType === 'flight' ? launchArenaPath : undefined,
          accomplishments: row.activityType === 'flight' && row.sourceFlightId
            ? accomplishments.get(row.sourceFlightId) ?? []
            : [],
          publishedAtIso: row.publishedAt.toISOString(),
          publishedAtLabel: row.publishedAt.toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' }),
        };
      });
      const last = visibleRows.at(-1);
      return { items, nextCursor: hasMore && last ? encodeActivityCursor({ publishedAt: last.publishedAt, id: last.id }) : null };
    },

    async toggleThermal({ viewerUserId, activityId }) {
      if (!database) throw new Error('Activity reactions require a database.');
      return database.transaction(async (transaction) => {
        const [activity] = await transaction
          .select({ id: activities.id, actorUserId: activities.actorUserId })
          .from(activities)
          .where(eq(activities.id, activityId))
          .for('update');
        if (!activity) throw new ActivityNotFoundError();
        if (activity.actorUserId === viewerUserId) throw new SelfThermalError();

        const [existing] = await transaction
          .select({ activityId: activityReactions.activityId })
          .from(activityReactions)
          .where(and(
            eq(activityReactions.activityId, activityId),
            eq(activityReactions.reactorUserId, viewerUserId),
          ))
          .limit(1);
        let reacted: boolean;
        if (existing) {
          await transaction.delete(activityReactions).where(and(
            eq(activityReactions.activityId, activityId),
            eq(activityReactions.reactorUserId, viewerUserId),
          ));
          reacted = false;
        } else {
          await transaction.insert(activityReactions).values({
            activityId,
            activityOwnerUserId: activity.actorUserId,
            reactorUserId: viewerUserId,
          });
          reacted = true;
        }
        const [countRow] = await transaction
          .select({ totalCount: sql<number>`COUNT(*)::int` })
          .from(activityReactions)
          .where(eq(activityReactions.activityId, activityId));
        return { reacted, totalCount: Number(countRow?.totalCount ?? 0) };
      });
    },
  };
}
