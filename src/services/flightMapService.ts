import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export type FlightMapScope = 'personal' | 'following' | 'all';
export type FlightMapPeriod = 'day' | 'month' | 'year' | 'all-time';
export type FlightMapGeography = 'global' | 'map-area';
export type FlightMapSort = 'distance' | 'latest' | 'duration';

export type FlightMapViewport = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type FlightMapFilter = {
  viewerUserId: string;
  scope: FlightMapScope;
  period: FlightMapPeriod;
  /** A YYYY-MM-DD date within the selected day, month, or year. Omit for all-time. */
  anchor?: string;
};

export type FlightMapTrackInput = FlightMapFilter & {
  viewport: FlightMapViewport;
  zoom: number;
  limit?: number;
};

export type FlightMapListInput = FlightMapFilter & {
  geography: FlightMapGeography;
  viewport?: FlightMapViewport;
  sort: FlightMapSort;
  cursor?: string;
  limit?: number;
};

export type FlightMapBounds = FlightMapViewport & { crossesAntimeridian: boolean };

export type FlightMapGeometry = {
  type: 'MultiLineString';
  coordinates: number[][][];
};

export type FlightMapTrack = {
  flightId: string;
  pilotUserId: string;
  pilotDisplayName: string;
  pilotColor: string;
  startedAt: string;
  durationSeconds: number | null;
  fivePointDistanceMeters: number | null;
  bounds: FlightMapBounds;
  geometry: FlightMapGeometry;
  geometryMinZoom: number | null;
};

export type FlightMapListItem = {
  flightId: string;
  pilotUserId: string;
  pilotDisplayName: string;
  pilotColor: string;
  startedAt: string;
  launchTimezone: string;
  launchName: string | null;
  durationSeconds: number | null;
  fivePointDistanceMeters: number | null;
  launchLatitude: number | null;
  launchLongitude: number | null;
  landingLatitude: number | null;
  landingLongitude: number | null;
  bounds: FlightMapBounds;
};

export type FlightMapTrackPage = { tracks: FlightMapTrack[]; truncated: boolean };
export type FlightMapListPage = { items: FlightMapListItem[]; nextCursor: string | null };

export interface FlightMapService {
  listViewportTracks(input: FlightMapTrackInput): Promise<FlightMapTrackPage>;
  listFlights(input: FlightMapListInput): Promise<FlightMapListPage>;
}

type Executor = Pick<Database, 'execute'>;

type StoredTrack = {
  flightId: string;
  pilotUserId: string;
  pilotDisplayName: string;
  pilotColor: string;
  startedAt: Date | string;
  durationSeconds: number | string | null;
  fivePointDistanceMeters: number | string | null;
  west: number | string;
  south: number | string;
  east: number | string;
  north: number | string;
  crossesAntimeridian: boolean;
  geometry: FlightMapGeometry | string;
  geometryMinZoom: number | string | null;
};

type StoredListItem = Omit<StoredTrack, 'geometry' | 'geometryMinZoom'> & {
  launchTimezone: string | null;
  launchName: string | null;
  launchLatitude: number | string | null;
  launchLongitude: number | string | null;
  landingLatitude: number | string | null;
  landingLongitude: number | string | null;
  sortValue: number | string | null;
};

type FlightMapCursor = {
  v: 1;
  sort: FlightMapSort;
  value: number | null;
  startedAt: string;
  flightId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const DEFAULT_TRACK_LIMIT = 500;
const MAX_TRACK_LIMIT = 1_000;

export class FlightMapInputError extends Error {}

function finiteNumber(value: number | string): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) throw new Error('Flight map data contains an invalid number.');
  return converted;
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : finiteNumber(value);
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Flight map data contains an invalid start time.');
  return date.toISOString();
}

function parseGeometry(value: FlightMapGeometry | string): FlightMapGeometry {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'MultiLineString' || !Array.isArray((parsed as { coordinates?: unknown }).coordinates)) {
    throw new Error('Flight map data contains invalid geometry.');
  }
  return parsed as FlightMapGeometry;
}

function validateScope(scope: string): asserts scope is FlightMapScope {
  if (scope !== 'personal' && scope !== 'following' && scope !== 'all') throw new FlightMapInputError('Flight map scope is invalid.');
}

function validatePeriod(period: string): asserts period is FlightMapPeriod {
  if (period !== 'day' && period !== 'month' && period !== 'year' && period !== 'all-time') throw new FlightMapInputError('Flight map period is invalid.');
}

function validateSort(sort: string): asserts sort is FlightMapSort {
  if (sort !== 'distance' && sort !== 'latest' && sort !== 'duration') throw new FlightMapInputError('Flight map sort is invalid.');
}

function validateUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new FlightMapInputError(`${label} is invalid.`);
}

export function validateFlightMapViewport(viewport: FlightMapViewport): FlightMapViewport {
  const values = [viewport.west, viewport.south, viewport.east, viewport.north];
  if (!values.every(Number.isFinite)
    || viewport.west < -180 || viewport.west > 180
    || viewport.east < -180 || viewport.east > 180
    || viewport.south < -90 || viewport.south > 90
    || viewport.north < -90 || viewport.north > 90
    || viewport.south >= viewport.north
    || viewport.west === viewport.east) {
    throw new FlightMapInputError('Flight map viewport is invalid.');
  }
  return viewport;
}

function validateAnchor(period: FlightMapPeriod, anchor: string | undefined): string | undefined {
  if (period === 'all-time') {
    if (anchor !== undefined) throw new FlightMapInputError('All-time does not accept an anchor date.');
    return undefined;
  }
  const match = anchor?.match(ISO_DATE);
  if (!match) throw new FlightMapInputError('Flight map anchor must be a YYYY-MM-DD date.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new FlightMapInputError('Flight map anchor date is invalid.');
  }
  return anchor;
}

function validateLimit(value: number | undefined, fallback: number, maximum: number): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new FlightMapInputError('Flight map limit is invalid.');
  return limit;
}

function validateFilter(input: FlightMapFilter): string | undefined {
  validateUuid(input.viewerUserId, 'Viewer user ID');
  validateScope(input.scope);
  validatePeriod(input.period);
  return validateAnchor(input.period, input.anchor);
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
    // IANA zones range from UTC-12 through UTC+14. These broad bounds keep the
    // indexed started_at predicate safe before applying the exact local test.
    broadStart: new Date(start - 14 * 60 * 60 * 1_000),
    broadEnd: new Date(end + 12 * 60 * 60 * 1_000),
  };
}

function scopePredicate(scope: FlightMapScope, viewerUserId: string): SQL {
  if (scope === 'personal') return sql`flight.user_id = ${viewerUserId}`;
  if (scope === 'following') return sql`(
    flight.user_id = ${viewerUserId}
    OR EXISTS (
      SELECT 1 FROM pilot_follows follow
      WHERE follow.follower_user_id = ${viewerUserId}
        AND follow.followed_user_id = flight.user_id
    )
  )`;
  return sql`true`;
}

function periodPredicate(period: FlightMapPeriod, anchor: string | undefined): SQL {
  if (period === 'all-time') return sql`true`;
  const safeAnchor = anchor as string;
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

function viewportCte(viewport: FlightMapViewport): SQL {
  return sql`viewport_parts AS (
    SELECT ST_MakeEnvelope(${viewport.west}, ${viewport.south}, ${viewport.east}, ${viewport.north}, 4326) AS geometry
    WHERE ${viewport.west}::double precision <= ${viewport.east}::double precision
    UNION ALL
    SELECT ST_MakeEnvelope(${viewport.west}, ${viewport.south}, 180, ${viewport.north}, 4326)
    WHERE ${viewport.west}::double precision > ${viewport.east}::double precision
    UNION ALL
    SELECT ST_MakeEnvelope(-180, ${viewport.south}, ${viewport.east}, ${viewport.north}, 4326)
    WHERE ${viewport.west}::double precision > ${viewport.east}::double precision
  )`;
}

function intersectionPredicate(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM viewport_parts viewport
    WHERE feature.full_track && viewport.geometry
      AND ST_Intersects(feature.full_track, viewport.geometry)
  )`;
}

function metricExpression(sort: FlightMapSort): SQL {
  if (sort === 'distance') return sql`score.five_point_distance_meters`;
  if (sort === 'duration') return sql`flight.duration_seconds::double precision`;
  return sql`EXTRACT(EPOCH FROM flight.started_at)`;
}

export function encodeFlightMapCursor(cursor: FlightMapCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeFlightMapCursor(encoded: string | undefined, expectedSort: FlightMapSort): FlightMapCursor | null {
  if (!encoded) return null;
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<FlightMapCursor>;
    if (value.v !== 1 || value.sort !== expectedSort || (value.value !== null && !Number.isFinite(value.value))
      || typeof value.startedAt !== 'string' || Number.isNaN(new Date(value.startedAt).getTime())
      || typeof value.flightId !== 'string' || !UUID.test(value.flightId)) {
      throw new Error('invalid');
    }
    return value as FlightMapCursor;
  } catch {
    throw new FlightMapInputError('Flight map cursor is invalid.');
  }
}

function cursorPredicate(cursor: FlightMapCursor | null, metric: SQL): SQL {
  if (!cursor) return sql`true`;
  const startedAt = new Date(cursor.startedAt);
  const withinSameMetric = sql`(
    flight.started_at < ${startedAt}
    OR (flight.started_at = ${startedAt} AND flight.flight_id < ${cursor.flightId}::uuid)
  )`;
  if (cursor.value === null) return sql`${metric} IS NULL AND ${withinSameMetric}`;
  return sql`(
    ${metric} IS NULL
    OR ${metric} < ${cursor.value}
    OR (${metric} = ${cursor.value} AND ${withinSameMetric})
  )`;
}

function bounds(row: Pick<StoredTrack, 'west' | 'south' | 'east' | 'north' | 'crossesAntimeridian'>): FlightMapBounds {
  return {
    west: finiteNumber(row.west),
    south: finiteNumber(row.south),
    east: finiteNumber(row.east),
    north: finiteNumber(row.north),
    crossesAntimeridian: Boolean(row.crossesAntimeridian),
  };
}

function mapListItem(row: StoredListItem): FlightMapListItem {
  return {
    flightId: row.flightId,
    pilotUserId: row.pilotUserId,
    pilotDisplayName: row.pilotDisplayName,
    pilotColor: row.pilotColor,
    startedAt: isoDate(row.startedAt),
    launchTimezone: row.launchTimezone || 'UTC',
    launchName: row.launchName,
    durationSeconds: nullableNumber(row.durationSeconds),
    fivePointDistanceMeters: nullableNumber(row.fivePointDistanceMeters),
    launchLatitude: nullableNumber(row.launchLatitude),
    launchLongitude: nullableNumber(row.launchLongitude),
    landingLatitude: nullableNumber(row.landingLatitude),
    landingLongitude: nullableNumber(row.landingLongitude),
    bounds: bounds(row),
  };
}

export function createFlightMapService(database: Executor): FlightMapService {
  return {
    async listViewportTracks(input) {
      const anchor = validateFilter(input);
      const viewport = validateFlightMapViewport(input.viewport);
      if (!Number.isFinite(input.zoom) || input.zoom < 0 || input.zoom > 24) throw new FlightMapInputError('Flight map zoom is invalid.');
      const zoomBucket = Math.floor(input.zoom);
      const limit = validateLimit(input.limit, DEFAULT_TRACK_LIMIT, MAX_TRACK_LIMIT);
      const result = await database.execute<StoredTrack>(sql`
        WITH ${viewportCte(viewport)}
        SELECT
          flight.flight_id AS "flightId",
          flight.user_id AS "pilotUserId",
          profile.display_name AS "pilotDisplayName",
          profile.territory_color AS "pilotColor",
          flight.started_at AS "startedAt",
          flight.duration_seconds AS "durationSeconds",
          score.five_point_distance_meters AS "fivePointDistanceMeters",
          feature.west,
          feature.south,
          feature.east,
          feature.north,
          feature.crosses_antimeridian AS "crossesAntimeridian",
          ST_AsGeoJSON(COALESCE(lod.geometry, feature.full_track))::json AS geometry,
          lod.min_zoom AS "geometryMinZoom"
        FROM flights flight
        INNER JOIN profiles profile ON profile.user_id = flight.user_id
        INNER JOIN flight_map_features feature ON feature.flight_id = flight.flight_id
        LEFT JOIN flight_scores score ON score.flight_id = flight.flight_id
        LEFT JOIN LATERAL (
          SELECT geometry.geometry, geometry.min_zoom
          FROM flight_map_geometry_lods geometry
          WHERE geometry.flight_id = feature.flight_id
            AND geometry.projection_version = feature.projection_version
            AND ${zoomBucket} >= geometry.min_zoom
            AND ${zoomBucket} <= geometry.max_zoom
          ORDER BY geometry.min_zoom DESC
          LIMIT 1
        ) lod ON true
        WHERE flight.processing_status = 'completed'
          AND flight.started_at IS NOT NULL
          AND ${scopePredicate(input.scope, input.viewerUserId)}
          AND ${periodPredicate(input.period, anchor)}
          AND ${intersectionPredicate()}
        ORDER BY score.five_point_distance_meters DESC NULLS LAST, flight.started_at DESC, flight.flight_id DESC
        LIMIT ${limit + 1}
      `);
      const truncated = result.rows.length > limit;
      return {
        truncated,
        tracks: result.rows.slice(0, limit).map((row) => ({
          flightId: row.flightId,
          pilotUserId: row.pilotUserId,
          pilotDisplayName: row.pilotDisplayName,
          pilotColor: row.pilotColor,
          startedAt: isoDate(row.startedAt),
          durationSeconds: nullableNumber(row.durationSeconds),
          fivePointDistanceMeters: nullableNumber(row.fivePointDistanceMeters),
          bounds: bounds(row),
          geometry: parseGeometry(row.geometry),
          geometryMinZoom: nullableNumber(row.geometryMinZoom),
        })),
      };
    },

    async listFlights(input) {
      const anchor = validateFilter(input);
      validateSort(input.sort);
      if (input.geography !== 'global' && input.geography !== 'map-area') throw new FlightMapInputError('Flight map geography is invalid.');
      if (input.geography === 'map-area' && !input.viewport) throw new FlightMapInputError('Map-area requires a viewport.');
      const viewport = input.geography === 'map-area'
        ? validateFlightMapViewport(input.viewport as FlightMapViewport)
        : undefined;
      if (input.geography === 'global' && input.viewport !== undefined) validateFlightMapViewport(input.viewport);
      const limit = validateLimit(input.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
      const cursor = decodeFlightMapCursor(input.cursor, input.sort);
      const metric = metricExpression(input.sort);
      const cte = viewport ? sql`WITH ${viewportCte(viewport)}` : sql``;
      const geographicPredicate = viewport ? intersectionPredicate() : sql`true`;
      const result = await database.execute<StoredListItem>(sql`
        ${cte}
        SELECT
          flight.flight_id AS "flightId",
          flight.user_id AS "pilotUserId",
          profile.display_name AS "pilotDisplayName",
          profile.territory_color AS "pilotColor",
          flight.started_at AS "startedAt",
          COALESCE(NULLIF(flight.launch_timezone, ''), 'UTC') AS "launchTimezone",
          (
            SELECT launch.name
            FROM arenas launch
            WHERE launch.arena_type = 'launch'
              AND flight.launch_latitude IS NOT NULL
              AND flight.launch_longitude IS NOT NULL
              AND ST_Covers(
                launch.area,
                ST_Transform(ST_SetSRID(ST_MakePoint(flight.launch_longitude, flight.launch_latitude), 4326), 6933)
              )
            ORDER BY launch.source_id ASC, launch.id ASC
            LIMIT 1
          ) AS "launchName",
          flight.duration_seconds AS "durationSeconds",
          score.five_point_distance_meters AS "fivePointDistanceMeters",
          flight.launch_latitude AS "launchLatitude",
          flight.launch_longitude AS "launchLongitude",
          feature.landing_latitude AS "landingLatitude",
          feature.landing_longitude AS "landingLongitude",
          feature.west,
          feature.south,
          feature.east,
          feature.north,
          feature.crosses_antimeridian AS "crossesAntimeridian",
          ${metric} AS "sortValue"
        FROM flights flight
        INNER JOIN profiles profile ON profile.user_id = flight.user_id
        INNER JOIN flight_map_features feature ON feature.flight_id = flight.flight_id
        LEFT JOIN flight_scores score ON score.flight_id = flight.flight_id
        WHERE flight.processing_status = 'completed'
          AND flight.started_at IS NOT NULL
          AND ${scopePredicate(input.scope, input.viewerUserId)}
          AND ${periodPredicate(input.period, anchor)}
          AND ${geographicPredicate}
          AND ${cursorPredicate(cursor, metric)}
        ORDER BY (${metric} IS NULL) ASC, ${metric} DESC NULLS LAST, flight.started_at DESC, flight.flight_id DESC
        LIMIT ${limit + 1}
      `);
      const hasMore = result.rows.length > limit;
      const visible = result.rows.slice(0, limit);
      const last = visible.at(-1);
      return {
        items: visible.map(mapListItem),
        nextCursor: hasMore && last ? encodeFlightMapCursor({
          v: 1,
          sort: input.sort,
          value: nullableNumber(last.sortValue),
          startedAt: isoDate(last.startedAt),
          flightId: last.flightId,
        }) : null,
      };
    },
  };
}
