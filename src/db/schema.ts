import { customType, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { FreePolygonClaimGeoJson } from '../domain/territory/freePolygonClaimGeoJson.js';

const polygonGeometry = customType<{ data: string }>({
  dataType: () => 'geometry(polygon,4326)',
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('user_id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  lastLogin: timestamp('last_login', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  ...timestamps,
});

export const userPasswords = pgTable('user_passwords', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    territoryColor: text('territory_color').notNull().default('#1769AA'),
    ...timestamps,
  },
  (table) => [index('profiles_user_id_idx').on(table.userId)],
);

export const appSessions = pgTable(
  'app_sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('app_sessions_user_id_idx').on(table.userId),
    uniqueIndex('app_sessions_token_hash_idx').on(table.tokenHash),
  ],
);

export const igcFiles = pgTable(
  'igc_files',
  {
    id: uuid('igc_file_id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    bucketKey: text('bucket_key').notNull(),
    ...timestamps,
  },
  (table) => [index('igc_files_user_id_idx').on(table.userId), uniqueIndex('igc_files_bucket_key_idx').on(table.bucketKey)],
);

export const flightProcessingStatus = pgEnum('flight_processing_status', ['processing', 'completed', 'failed']);

export const flights = pgTable(
  'flights',
  {
    id: uuid('flight_id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    igcFileId: uuid('igc_file_id').notNull().references(() => igcFiles.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    processingStatus: flightProcessingStatus('processing_status').notNull().default('processing'),
    processingError: text('processing_error'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    durationSeconds: integer('duration_seconds'),
    distanceMeters: doublePrecision('distance_meters'),
    launchLatitude: doublePrecision('launch_latitude'),
    launchLongitude: doublePrecision('launch_longitude'),
    launchTimezone: text('launch_timezone'),
    ...timestamps,
  },
  (table) => [
    unique('flights_igc_file_id_unique').on(table.igcFileId),
    unique('flights_content_hash_unique').on(table.contentHash),
    index('flights_user_id_idx').on(table.userId),
    index('flights_igc_file_id_idx').on(table.igcFileId),
  ],
);

export const trackPoints = pgTable(
  'track_points',
  {
    id: uuid('track_point_id').primaryKey().defaultRandom(),
    flightId: uuid('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'date' }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    gpsAltitudeMeters: integer('gps_altitude_meters').notNull(),
    pressureAltitudeMeters: integer('pressure_altitude_meters').notNull(),
  },
  (table) => [
    unique('track_points_flight_id_sequence_number_unique').on(table.flightId, table.sequenceNumber),
    index('track_points_flight_id_sequence_number_idx').on(table.flightId, table.sequenceNumber),
  ],
);

export const flightAreas = pgTable(
  'flight_areas',
  {
    id: uuid('flight_area_id').primaryKey().defaultRandom(),
    flightId: uuid('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    geometry: polygonGeometry('geometry').notNull(),
    areaSquareMeters: doublePrecision('area_square_meters').notNull(),
  },
  (table) => [
    index('flight_areas_flight_id_idx').on(table.flightId),
    index('flight_areas_geometry_gist_idx').using('gist', table.geometry),
  ],
);

export const personalTerritories = pgTable('personal_territories', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  geojson: jsonb('geojson').$type<FreePolygonClaimGeoJson>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const userGridClaims = pgTable(
  'user_grid_claims',
  {
    cellSize: integer('cell_size').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    claimFlight: uuid('claim_flight').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    claimUser: uuid('claim_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
    claimTimestamp: timestamp('claim_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cellSize, table.x, table.y] }),
    index('user_grid_claims_claim_user_cell_size_idx').on(table.claimUser, table.cellSize),
    index('user_grid_claims_claim_flight_idx').on(table.claimFlight),
  ],
);

export const competitionGridClaims = pgTable(
  'competition_grid_claims',
  {
    competitionMonth: date('competition_month', { mode: 'string' }).notNull(),
    cellSize: integer('cell_size').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    claimFlight: uuid('claim_flight').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    claimUser: uuid('claim_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
    claimTimestamp: timestamp('claim_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.competitionMonth, table.cellSize, table.x, table.y, table.claimFlight] }),
    index('competition_grid_claims_month_cell_timestamp_idx').on(
      table.competitionMonth,
      table.cellSize,
      table.x,
      table.y,
      table.claimTimestamp,
    ),
    index('competition_grid_claims_cell_history_idx').on(
      table.cellSize,
      table.x,
      table.y,
      table.competitionMonth,
      table.claimTimestamp,
    ),
    index('competition_grid_claims_claim_flight_idx').on(table.claimFlight),
  ],
);
