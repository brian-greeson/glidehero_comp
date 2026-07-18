import { bigint, customType, date, doublePrecision, index, integer, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const geometryPoint4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(point,4326)',
});

const geometryMultiPolygon6933 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(multipolygon,6933)',
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
    processingToken: text('processing_token'),
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

export const launches = pgTable(
  'launches',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    country: text('country').notNull(),
    state: text('state').notNull(),
    city: text('city').notNull(),
    description: text('description').notNull(),
    xcByMonth: text('xc_by_month').notNull(),
    timezoneOffset: integer('timezone_offset').notNull(),
    xcByYear: text('xc_by_year').notNull(),
    rank: integer('rank').notNull(),
    elevation: integer('elevation').notNull().default(0),
    rank1: integer('rank_1').notNull(),
    rank2: integer('rank_2').notNull(),
    rank3: integer('rank_3').notNull(),
    rank4: integer('rank_4').notNull(),
    rank5: integer('rank_5').notNull(),
    rank6: integer('rank_6').notNull(),
    rank7: integer('rank_7').notNull(),
    rank8: integer('rank_8').notNull(),
    rank9: integer('rank_9').notNull(),
    rank10: integer('rank_10').notNull(),
    rank11: integer('rank_11').notNull(),
    rank12: integer('rank_12').notNull(),
    xcontestLaunchSite: integer('xcontest_launch_site').notNull(),
  },
  (table) => [
    index('launches_name_idx').on(table.name),
    index('launches_country_idx').on(table.country),
    index('launches_state_idx').on(table.state),
    index('launches_xcontest_launch_site_idx').on(table.xcontestLaunchSite),
  ],
);

export const launchAreas = pgTable(
  'launch_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    state: text('state').notNull(),
    city: text('city').notNull(),
    location: geometryPoint4326('location').notNull(),
    altitudeMeters: integer('altitude_meters').notNull(),
    timezone: text('timezone').notNull(),
    area: geometryMultiPolygon6933('area'),
  },
  (table) => [
    unique('launch_areas_source_id_unique').on(table.sourceId),
    index('launch_areas_area_gist_idx').using('gist', table.area).where(sql`${table.area} IS NOT NULL`),
  ],
);

export const customLaunchAreaSourceIdSequence = pgSequence('custom_launch_area_source_id_seq', {
  startWith: 10_000,
});

export const launchAreaCells = pgTable(
  'launch_area_cells',
  {
    launchAreaId: uuid('launch_area_id').notNull().references(() => launchAreas.id, { onDelete: 'cascade' }),
    cellSize: integer('cell_size').notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.launchAreaId, table.cellSize, table.x, table.y] }),
    index('launch_area_cells_cell_idx').on(table.cellSize, table.x, table.y, table.launchAreaId),
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

export const personalGridClaims = pgTable(
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
    primaryKey({ columns: [table.claimUser, table.cellSize, table.x, table.y, table.claimFlight] }),
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
