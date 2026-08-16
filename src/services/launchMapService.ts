import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  FlightMapInputError,
  validateFlightMapViewport,
  type FlightMapFilter,
  type FlightMapPeriod,
  type FlightMapScope,
  type FlightMapViewport,
} from './flightMapService.js';

export type LaunchMapMarker = {
  launchId: number;
  name: string;
  longitude: number;
  latitude: number;
  visited: boolean;
};

export type LaunchMapOption = {
  launchId: number;
  name: string;
  state: string;
  country: string;
  longitude: number;
  latitude: number;
};

export type LaunchMapOptionsInput =
  | { viewport: FlightMapViewport; query?: never }
  | { query: string; viewport?: never };

export type LaunchMapDetail = LaunchMapMarker & {
  city: string;
  state: string;
  country: string;
  elevationMeters: number;
  description: string | null;
  matchingFlightCount: number;
  visited: boolean;
};

export type LaunchMapMarkerInput = FlightMapFilter & {
  viewport: FlightMapViewport;
};

/**
 * This intentionally mirrors the current shared map filter. New shared filter
 * dimensions (custom ranges and launch filtering) can be added here without
 * changing the marker query, which is catalog- and viewport-only.
 */
export type LaunchMapDetailInput = FlightMapFilter & {
  launchId: number;
};

export interface LaunchMapService {
  listLaunchOptions(input: LaunchMapOptionsInput): Promise<LaunchMapOption[]>;
  listViewportMarkers(input: LaunchMapMarkerInput): Promise<LaunchMapMarker[]>;
  getLaunchDetail(input: LaunchMapDetailInput): Promise<LaunchMapDetail | null>;
}

type Executor = Pick<Database, 'execute'>;

type StoredMarker = {
  launchId: number | string;
  name: string;
  longitude: number | string;
  latitude: number | string;
  matchingFlightCount: number | string;
};

type StoredDetail = Omit<StoredMarker, 'matchingFlightCount'> & {
  city: string;
  state: string;
  country: string;
  elevationMeters: number | string;
  description: string | null;
  matchingFlightCount: number | string;
};

type StoredOption = {
  launchId: number | string;
  name: string;
  state: string;
  country: string;
  longitude: number | string;
  latitude: number | string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function finiteNumber(value: number | string, label: string): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new Error(`Launch map data contains an invalid ${label}.`);
  return converted;
}

function launchId(value: number | string): number {
  const converted = finiteNumber(value, 'launch ID');
  if (!Number.isSafeInteger(converted) || converted < 1) throw new Error('Launch map data contains an invalid launch ID.');
  return converted;
}

function validateLaunchId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new FlightMapInputError('Launch ID is invalid.');
}

function validateScope(scope: string): asserts scope is FlightMapScope {
  if (scope !== 'personal' && scope !== 'following' && scope !== 'all' && scope !== 'group') {
    throw new FlightMapInputError('Flight map scope is invalid.');
  }
}

function validateGroupScope(input: FlightMapFilter): void {
  if (input.scope === 'group') {
    if (!input.groupId) throw new FlightMapInputError('Group ID is required for group scope.');
    if (!UUID.test(input.groupId)) throw new FlightMapInputError('Group ID is invalid.');
  } else if (input.groupId !== undefined) {
    throw new FlightMapInputError('Group ID is only valid for group scope.');
  }
}

function validateAnchor(period: FlightMapPeriod, anchor: string | undefined): string | undefined {
  if (period === 'all-time') {
    if (anchor !== undefined) throw new FlightMapInputError('All-time does not accept an anchor date.');
    return undefined;
  }
  if (period !== 'day' && period !== 'month' && period !== 'year') {
    throw new FlightMapInputError('Flight map period is invalid.');
  }
  const match = anchor?.match(ISO_DATE);
  if (!match) throw new FlightMapInputError('Flight map anchor must be a YYYY-MM-DD date.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new FlightMapInputError('Flight map anchor date is invalid.');
  }
  return anchor;
}

type ValidatedDates = { anchor?: string; startDate?: string; endDate?: string };

function validIsoDate(value: string | undefined, label: string): string {
  const match = value?.match(ISO_DATE);
  if (!match) throw new FlightMapInputError(`${label} must be a YYYY-MM-DD date.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new FlightMapInputError(`${label} is invalid.`);
  }
  return value as string;
}

function validateDetailInput(input: LaunchMapDetailInput): ValidatedDates {
  validateLaunchId(input.launchId);
  validateLaunchFilter(input.launch);
  if (!UUID.test(input.viewerUserId)) throw new FlightMapInputError('Viewer user ID is invalid.');
  validateScope(input.scope);
  validateGroupScope(input);
  if (input.period !== 'day' && input.period !== 'month' && input.period !== 'year' && input.period !== 'custom' && input.period !== 'all-time') {
    throw new FlightMapInputError('Flight map period is invalid.');
  }
  if (input.period === 'custom') {
    if (input.anchor !== undefined) throw new FlightMapInputError('Custom range does not accept an anchor date.');
    const startDate = validIsoDate(input.startDate, 'Flight map start date');
    const endDate = validIsoDate(input.endDate, 'Flight map end date');
    if (startDate > endDate) throw new FlightMapInputError('Flight map date range is reversed.');
    return { startDate, endDate };
  }
  if (input.startDate !== undefined || input.endDate !== undefined) throw new FlightMapInputError('Calendar periods do not accept a custom range.');
  const anchor = validateAnchor(input.period, input.anchor);
  return anchor === undefined ? {} : { anchor };
}

function validateMarkerInput(input: LaunchMapMarkerInput): ValidatedDates {
  validateLaunchFilter(input.launch);
  if (!UUID.test(input.viewerUserId)) throw new FlightMapInputError('Viewer user ID is invalid.');
  validateScope(input.scope);
  validateGroupScope(input);
  if (input.period !== 'day' && input.period !== 'month' && input.period !== 'year' && input.period !== 'custom' && input.period !== 'all-time') throw new FlightMapInputError('Flight map period is invalid.');
  if (input.period === 'custom') {
    if (input.anchor !== undefined) throw new FlightMapInputError('Custom range does not accept an anchor date.');
    const startDate = validIsoDate(input.startDate, 'Flight map start date');
    const endDate = validIsoDate(input.endDate, 'Flight map end date');
    if (startDate > endDate) throw new FlightMapInputError('Flight map date range is reversed.');
    return { startDate, endDate };
  }
  if (input.startDate !== undefined || input.endDate !== undefined) throw new FlightMapInputError('Calendar periods do not accept a custom range.');
  const anchor = validateAnchor(input.period, input.anchor);
  return anchor === undefined ? {} : { anchor };
}

function periodWindow(period: Exclude<FlightMapPeriod, 'all-time'>, anchor: string): { broadStart: Date; broadEnd: Date } {
  const [yearText, monthText, dayText] = anchor.split('-');
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  let start: number;
  let end: number;
  if (period === 'day') {
    start = Date.UTC(year, month, day);
    end = Date.UTC(year, month, day + 1);
  } else if (period === 'month') {
    start = Date.UTC(year, month, 1);
    end = Date.UTC(year, month + 1, 1);
  } else {
    start = Date.UTC(year, 0, 1);
    end = Date.UTC(year + 1, 0, 1);
  }
  return {
    broadStart: new Date(start - 14 * 60 * 60 * 1_000),
    broadEnd: new Date(end + 12 * 60 * 60 * 1_000),
  };
}

function scopePredicate(scope: FlightMapScope, viewerUserId: string, groupId?: string): SQL {
  if (scope === 'personal') return sql`flight.user_id = ${viewerUserId}`;
  if (scope === 'following') return sql`(
    flight.user_id = ${viewerUserId}
    OR EXISTS (
      SELECT 1 FROM pilot_follows follow
      WHERE follow.follower_user_id = ${viewerUserId}
        AND follow.followed_user_id = flight.user_id
    )
  )`;
  if (scope === 'group') return sql`(
    EXISTS (
      SELECT 1 FROM pilot_group_memberships viewer_membership
      WHERE viewer_membership.group_id = ${groupId}
        AND viewer_membership.user_id = ${viewerUserId}
        AND viewer_membership.status = 'accepted'
    )
    AND EXISTS (
      SELECT 1 FROM pilot_group_memberships roster_membership
      WHERE roster_membership.group_id = ${groupId}
        AND roster_membership.user_id = flight.user_id
        AND roster_membership.status = 'accepted'
    )
  )`;
  return sql`true`;
}

function launchPredicate(launch: FlightMapFilter['launch']): SQL {
  if (launch === undefined) return sql`true`;
  if (launch === 'unknown') return sql`flight.launch_id IS NULL`;
  return sql`flight.launch_id = ${launch}`;
}

function validateLaunchFilter(launch: FlightMapFilter['launch']): void {
  if (launch === undefined || launch === 'unknown') return;
  if (!Number.isSafeInteger(launch) || launch < 1) throw new FlightMapInputError('Launch filter is invalid.');
}

function periodPredicate(period: FlightMapPeriod, dates: ValidatedDates): SQL {
  if (period === 'all-time') return sql`true`;
  if (period === 'custom') return sql`(
    timezone(COALESCE(NULLIF(flight.launch_timezone, ''), 'UTC'), flight.started_at)::date >= ${dates.startDate}::date
    AND timezone(COALESCE(NULLIF(flight.launch_timezone, ''), 'UTC'), flight.started_at)::date <= ${dates.endDate}::date
  )`;
  const safeAnchor = dates.anchor as string;
  const { broadStart, broadEnd } = periodWindow(period, safeAnchor);
  return sql`(
    flight.started_at >= ${broadStart}
    AND flight.started_at < ${broadEnd}
    AND timezone(COALESCE(NULLIF(flight.launch_timezone, ''), 'UTC'), flight.started_at)
      >= date_trunc(${period}, ${safeAnchor}::date::timestamp)
    AND timezone(COALESCE(NULLIF(flight.launch_timezone, ''), 'UTC'), flight.started_at)
      < date_trunc(${period}, ${safeAnchor}::date::timestamp) + ${sql.raw(`interval '1 ${period}'`)}
  )`;
}

function mapMarker(row: StoredMarker): LaunchMapMarker {
  return {
    launchId: launchId(row.launchId),
    name: row.name,
    longitude: finiteNumber(row.longitude, 'longitude'),
    latitude: finiteNumber(row.latitude, 'latitude'),
    visited: Number(row.matchingFlightCount) > 0,
  };
}

function mapOption(row: StoredOption): LaunchMapOption {
  return {
    launchId: launchId(row.launchId),
    name: row.name,
    state: row.state,
    country: row.country,
    longitude: finiteNumber(row.longitude, 'longitude'),
    latitude: finiteNumber(row.latitude, 'latitude'),
  };
}

function validateLaunchSearch(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    throw new FlightMapInputError('Launch search must contain between 2 and 100 characters.');
  }
  return trimmed;
}

export function createLaunchMapService(database: Executor): LaunchMapService {
  return {
    async listLaunchOptions(input) {
      const select = sql`
        SELECT
          launch.id AS "launchId",
          launch.name,
          launch.state,
          launch.country,
          launch.longitude,
          launch.latitude
        FROM launches launch
      `;
      const orderAndLimit = sql`
        ORDER BY lower(launch.name) ASC, launch.id ASC
        LIMIT 25
      `;

      if ('query' in input && input.query !== undefined) {
        const query = validateLaunchSearch(input.query);
        const result = await database.execute<StoredOption>(sql`
          ${select}
          WHERE position(lower(${query}) in lower(launch.name)) > 0
            OR position(lower(${query}) in lower(launch.state)) > 0
            OR position(lower(${query}) in lower(launch.country)) > 0
          ${orderAndLimit}
        `);
        return result.rows.map(mapOption);
      }

      const viewport = validateFlightMapViewport(input.viewport);
      const result = await database.execute<StoredOption>(sql`
        ${select}
        WHERE launch.latitude >= ${viewport.south}
          AND launch.latitude <= ${viewport.north}
          AND (
            (${viewport.west}::double precision <= ${viewport.east}::double precision
              AND launch.longitude >= ${viewport.west}
              AND launch.longitude <= ${viewport.east})
            OR
            (${viewport.west}::double precision > ${viewport.east}::double precision
              AND (launch.longitude >= ${viewport.west} OR launch.longitude <= ${viewport.east}))
          )
        ${orderAndLimit}
      `);
      return result.rows.map(mapOption);
    },

    async listViewportMarkers(input) {
      const viewport = validateFlightMapViewport(input.viewport);
      const dates = validateMarkerInput(input);
      const result = await database.execute<StoredMarker>(sql`
        SELECT
          launch.id AS "launchId",
          launch.name,
          launch.longitude,
          launch.latitude,
          COUNT(flight.flight_id)::integer AS "matchingFlightCount"
        FROM launches launch
        LEFT JOIN flights flight
          ON flight.launch_id = launch.id
          AND flight.processing_status = 'completed'
          AND flight.started_at IS NOT NULL
          AND ${scopePredicate(input.scope, input.viewerUserId, input.groupId)}
          AND ${periodPredicate(input.period, dates)}
          AND ${launchPredicate(input.launch)}
        WHERE launch.latitude >= ${viewport.south}
          AND launch.latitude <= ${viewport.north}
          AND (
            (${viewport.west}::double precision <= ${viewport.east}::double precision
              AND launch.longitude >= ${viewport.west}
              AND launch.longitude <= ${viewport.east})
            OR
            (${viewport.west}::double precision > ${viewport.east}::double precision
              AND (launch.longitude >= ${viewport.west} OR launch.longitude <= ${viewport.east}))
          )
        GROUP BY launch.id
        ORDER BY launch.id ASC
      `);
      return result.rows.map(mapMarker);
    },

    async getLaunchDetail(input) {
      const dates = validateDetailInput(input);
      const result = await database.execute<StoredDetail>(sql`
        SELECT
          launch.id AS "launchId",
          launch.name,
          launch.longitude,
          launch.latitude,
          launch.city,
          launch.state,
          launch.country,
          launch.elevation AS "elevationMeters",
          NULLIF(btrim(launch.description), '') AS description,
          COUNT(flight.flight_id)::integer AS "matchingFlightCount"
        FROM launches launch
        LEFT JOIN flights flight
          ON flight.launch_id = launch.id
          AND flight.processing_status = 'completed'
          AND flight.started_at IS NOT NULL
          AND ${scopePredicate(input.scope, input.viewerUserId, input.groupId)}
          AND ${periodPredicate(input.period, dates)}
          AND ${launchPredicate(input.launch)}
        WHERE launch.id = ${input.launchId}
        GROUP BY launch.id
      `);
      const row = result.rows[0];
      if (!row) return null;
      const count = finiteNumber(row.matchingFlightCount, 'matching flight count');
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Launch map data contains an invalid matching flight count.');
      return {
        ...mapMarker({ ...row, matchingFlightCount: row.matchingFlightCount }),
        city: row.city,
        state: row.state,
        country: row.country,
        elevationMeters: finiteNumber(row.elevationMeters, 'elevation'),
        description: row.description,
        matchingFlightCount: count,
        visited: count > 0,
      };
    },
  };
}
