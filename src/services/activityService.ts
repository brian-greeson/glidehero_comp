import { and, eq, exists, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { activities, activityReactions, arenas, flightProgress, flights, pilotFollows, profiles } from '../db/schema.js';
import { arenaPath } from '../domain/arena/arenaRoute.js';
import {
  loadFlightAccomplishments,
  type FlightAccomplishment,
} from './flightAccomplishmentService.js';

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
  likeCount: number;
  viewerHasLiked: boolean;
  /** True when this card belongs to the viewer; owners cannot react to themselves. */
  isOwn: boolean;
};

export type ActivityAccomplishment = FlightAccomplishment;

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

export class SelfLikeError extends Error {
  constructor() {
    super('You cannot send a Like to your own activity.');
    this.name = 'SelfLikeError';
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
  regenerateFlightActivity(input: { flightId: string }): Promise<'completed' | 'not_found' | 'not_completed'>;
  listFeed(input: { viewerUserId: string; limit?: number; before?: string; q?: string; scope?: ActivityFeedScope }): Promise<ActivityFeedPage>;
  toggleLike(input: { viewerUserId: string; activityId: string }): Promise<{ reacted: boolean; totalCount: number }>;
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

    async regenerateFlightActivity({ flightId }) {
      if (!database) throw new Error('Activity writes require a database.');
      const [flight] = await database
        .select({
          userId: flights.userId,
          processingStatus: flights.processingStatus,
          processedAt: flights.processedAt,
          createdAt: flights.createdAt,
        })
        .from(flights)
        .where(eq(flights.id, flightId))
        .limit(1);
      if (!flight) return 'not_found';
      if (flight.processingStatus !== 'completed') return 'not_completed';

      await database
        .insert(activities)
        .values({
          actorUserId: flight.userId,
          activityType: 'flight',
          sourceFlightId: flightId,
          publishedAt: flight.processedAt ?? flight.createdAt,
        })
        .onConflictDoUpdate({
          target: activities.sourceFlightId,
          set: { actorUserId: flight.userId, publishedAt: flight.processedAt ?? flight.createdAt },
        });
      return 'completed';
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
        likeCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM ${activityReactions} reaction_count
          WHERE reaction_count.activity_id = ${activities.id}
        )`,
        viewerHasLiked: sql<boolean>`CASE
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
          likeCount: Number(row.likeCount ?? 0),
          viewerHasLiked: Boolean(row.viewerHasLiked),
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

    async toggleLike({ viewerUserId, activityId }) {
      if (!database) throw new Error('Activity reactions require a database.');
      return database.transaction(async (transaction) => {
        const [activity] = await transaction
          .select({ id: activities.id, actorUserId: activities.actorUserId })
          .from(activities)
          .where(eq(activities.id, activityId))
          .for('update');
        if (!activity) throw new ActivityNotFoundError();
        if (activity.actorUserId === viewerUserId) throw new SelfLikeError();

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
