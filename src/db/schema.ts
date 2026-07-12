import { doublePrecision, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    processingStatus: flightProcessingStatus('processing_status').notNull().default('processing'),
    processingError: text('processing_error'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    durationSeconds: integer('duration_seconds'),
    distanceMeters: doublePrecision('distance_meters'),
    launchLatitude: doublePrecision('launch_latitude'),
    launchLongitude: doublePrecision('launch_longitude'),
    ...timestamps,
  },
  (table) => [
    unique('flights_igc_file_id_unique').on(table.igcFileId),
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
