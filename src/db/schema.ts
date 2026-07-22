import { bigint, boolean, check, customType, date, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const geometryPoint4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(point,4326)',
});

const geometryMultiPolygon6933 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon,6933)',
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

export const pilotFollows = pgTable(
  'pilot_follows',
  {
    followerUserId: uuid('follower_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    followedUserId: uuid('followed_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerUserId, table.followedUserId] }),
    check('pilot_follows_no_self_follow', sql`${table.followerUserId} <> ${table.followedUserId}`),
    index('pilot_follows_follower_user_id_idx').on(table.followerUserId),
    index('pilot_follows_followed_user_id_idx').on(table.followedUserId),
  ],
);

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
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
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
    index('flights_user_id_processed_at_flight_id_idx').on(table.userId, table.processedAt, table.id),
    index('flights_igc_file_id_idx').on(table.igcFileId),
  ],
);

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    activityType: text('activity_type').notNull().default('flight'),
    sourceFlightId: uuid('source_flight_id').unique().references(() => flights.id, { onDelete: 'cascade' }),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique('activities_id_actor_user_id_unique').on(table.id, table.actorUserId),
    index('activities_actor_user_id_published_at_id_idx').on(table.actorUserId, table.publishedAt, table.id),
    index('activities_published_at_id_idx').on(table.publishedAt, table.id),
    index('activities_activity_type_source_flight_id_idx').on(table.activityType, table.sourceFlightId),
    check('activities_flight_source_required', sql`${table.activityType} <> 'flight' OR ${table.sourceFlightId} IS NOT NULL`),
  ],
);

export const activityReactions = pgTable(
  'activity_reactions',
  {
    activityId: uuid('activity_id').notNull(),
    activityOwnerUserId: uuid('activity_owner_user_id').notNull(),
    reactorUserId: uuid('reactor_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.activityId, table.reactorUserId] }),
    foreignKey({
      name: 'activity_reactions_activity_owner_fkey',
      columns: [table.activityId, table.activityOwnerUserId],
      foreignColumns: [activities.id, activities.actorUserId],
    }).onDelete('cascade'),
    check('activity_reactions_no_self_reaction', sql`${table.activityOwnerUserId} <> ${table.reactorUserId}`),
    index('activity_reactions_reactor_user_id_idx').on(table.reactorUserId),
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

export const arenaType = pgEnum('arena_type', ['launch', 'general', 'state', 'country']);

export const arenas = pgTable(
  'arenas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    state: text('state'),
    city: text('city'),
    location: geometryPoint4326('location'),
    altitudeMeters: integer('altitude_meters'),
    timezone: text('timezone'),
    area: geometryMultiPolygon6933('area').notNull(),
    externalSource: text('external_source'),
    externalId: text('external_id'),
    arenaType: arenaType('arena_type').notNull().default('general'),
    countryCode: text('country_code').notNull(),
    claimableCellCount: bigint('claimable_cell_count', { mode: 'number' }),
  },
  (table) => [
    unique('arenas_source_id_unique').on(table.sourceId),
    unique('arenas_id_arena_type_unique').on(table.id, table.arenaType),
    index('arenas_area_gist_idx').using('gist', table.area),
    check('arenas_country_code_iso2_check', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      'arenas_state_country_external_id_required',
      sql`${table.arenaType} NOT IN ('state', 'country') OR (${table.externalId} IS NOT NULL AND btrim(${table.externalId}) <> '')`,
    ),
    uniqueIndex('arenas_external_source_external_id_unique')
      .on(table.externalSource, table.externalId)
      .where(sql`${table.externalSource} IS NOT NULL AND ${table.externalId} IS NOT NULL`),
    uniqueIndex('arenas_arena_type_external_id_state_country_unique')
      .on(table.arenaType, table.externalId)
      .where(sql`${table.arenaType} IN ('state', 'country')`),
  ],
);

export const arenaSourceIdSequence = pgSequence('arena_source_id_seq', {
  startWith: 10_000,
});

export const arenaLeadershipEventType = pgEnum('arena_leadership_event_type', ['took', 'reclaimed', 'lost']);

/** Canonical per-Arena leadership snapshot used by profile and reconciliation reads. */
export const arenaLeadershipStates = pgTable(
  'arena_leadership_states',
  {
    arenaId: uuid('arena_id').primaryKey(),
    arenaType: arenaType('arena_type').notNull(),
    leadingCellCount: integer('leading_cell_count').notNull().default(0),
    nextRankCellCount: integer('next_rank_cell_count').notNull().default(0),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastReconciliationKey: text('last_reconciliation_key'),
    lastClaimTimestamp: timestamp('last_claim_timestamp', { withTimezone: true, mode: 'date' }),
    lastClaimSourceFlightId: uuid('last_claim_source_flight_id').references(() => flights.id, { onDelete: 'set null' }),
  },
  (table) => [
    foreignKey({
      name: 'arena_leadership_states_arena_id_arena_type_fkey',
      columns: [table.arenaId, table.arenaType],
      foreignColumns: [arenas.id, arenas.arenaType],
    }).onDelete('cascade'),
    check(
      'arena_leadership_states_eligible_arena_type_check',
      sql`${table.arenaType} IN ('general', 'state', 'country')`,
    ),
    check('arena_leadership_states_leading_cell_count_nonnegative', sql`${table.leadingCellCount} >= 0`),
    check('arena_leadership_states_next_rank_cell_count_nonnegative', sql`${table.nextRankCellCount} >= 0`),
    index('arena_leadership_states_arena_type_idx').on(table.arenaType),
  ],
);

/** Current rank-one pilots for an Arena. Multiple rows represent a joint lead. */
export const arenaCurrentLeaders = pgTable(
  'arena_current_leaders',
  {
    arenaId: uuid('arena_id').notNull().references(() => arenaLeadershipStates.arenaId, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cellsClaimed: integer('cells_claimed').notNull(),
    tookLeadAt: timestamp('took_lead_at', { withTimezone: true, mode: 'date' }).notNull(),
    decisiveSourceFlightId: uuid('decisive_source_flight_id').references(() => flights.id, { onDelete: 'set null' }),
    decisiveCellX: integer('decisive_cell_x').notNull(),
    decisiveCellY: integer('decisive_cell_y').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.arenaId, table.userId] }),
    check('arena_current_leaders_cells_claimed_positive', sql`${table.cellsClaimed} > 0`),
    index('arena_current_leaders_user_id_took_lead_at_idx').on(table.userId, table.tookLeadAt),
    index('arena_current_leaders_arena_id_took_lead_at_idx').on(table.arenaId, table.tookLeadAt),
  ],
);

/** Deterministic, replayable internal history of Arena rank-one transitions. */
export const arenaLeadershipEvents = pgTable(
  'arena_leadership_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventKey: text('event_key').notNull(),
    arenaId: uuid('arena_id').notNull().references(() => arenaLeadershipStates.arenaId, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    eventType: arenaLeadershipEventType('event_type').notNull(),
    claimTimestamp: timestamp('claim_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
    sourceFlightId: uuid('source_flight_id').references(() => flights.id, { onDelete: 'set null' }),
    cellX: integer('cell_x').notNull(),
    cellY: integer('cell_y').notNull(),
  },
  (table) => [
    unique('arena_leadership_events_event_key_unique').on(table.eventKey),
    index('arena_leadership_events_arena_id_claim_timestamp_idx').on(table.arenaId, table.claimTimestamp),
    index('arena_leadership_events_arena_id_user_id_claim_timestamp_idx').on(table.arenaId, table.userId, table.claimTimestamp),
    index('arena_leadership_events_source_flight_id_idx').on(table.sourceFlightId),
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
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    claimFlight: uuid('claim_flight').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    claimUser: uuid('claim_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
    claimTimestamp: timestamp('claim_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.claimUser, table.x, table.y, table.claimFlight] }),
    index('user_grid_claims_claim_user_idx').on(table.claimUser),
    index('user_grid_claims_claim_flight_idx').on(table.claimFlight),
  ],
);

export const competitionGridClaims = pgTable(
  'competition_grid_claims',
  {
    competitionMonth: date('competition_month', { mode: 'string' }).notNull(),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    claimFlight: uuid('claim_flight').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    claimUser: uuid('claim_user').notNull().references(() => users.id, { onDelete: 'cascade' }),
    claimTimestamp: timestamp('claim_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.competitionMonth, table.x, table.y, table.claimFlight] }),
    index('competition_grid_claims_month_cell_timestamp_idx').on(
      table.competitionMonth,
      table.x,
      table.y,
      table.claimTimestamp,
    ),
    index('competition_grid_claims_cell_history_idx').on(
      table.x,
      table.y,
      table.competitionMonth,
      table.claimTimestamp,
    ),
    index('competition_grid_claims_claim_flight_idx').on(table.claimFlight),
  ],
);

export const flightProgress = pgTable(
  'flight_progress',
  {
    flightId: uuid('flight_id').primaryKey().references(() => flights.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    directCellCount: integer('direct_cell_count').notNull(),
    enclosedCellCount: integer('enclosed_cell_count').notNull(),
    newPersonalCellCount: integer('new_personal_cell_count').notNull(),
    personalCellTotalAfter: integer('personal_cell_total_after').notNull(),
    progressionVersion: integer('progression_version').notNull().default(1),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('flight_progress_direct_cell_count_nonnegative', sql`${table.directCellCount} >= 0`),
    check('flight_progress_enclosed_cell_count_nonnegative', sql`${table.enclosedCellCount} >= 0`),
    check('flight_progress_new_personal_cell_count_nonnegative', sql`${table.newPersonalCellCount} >= 0`),
    check('flight_progress_personal_cell_total_after_nonnegative', sql`${table.personalCellTotalAfter} >= 0`),
    index('flight_progress_user_id_evaluated_at_idx').on(table.userId, table.evaluatedAt),
  ],
);

export const achievements = pgTable(
  'achievements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    achievementType: text('achievement_type').notNull(),
    achievementKey: text('achievement_key').notNull(),
    sourceFlightId: uuid('source_flight_id').references(() => flights.id, { onDelete: 'set null' }),
    earnedAt: timestamp('earned_at', { withTimezone: true, mode: 'date' }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('achievements_user_id_achievement_key_unique').on(table.userId, table.achievementKey),
    index('achievements_user_id_earned_at_idx').on(table.userId, table.earnedAt),
  ],
);

/** Current, rebuildable achievement progress summary for a pilot. */
export const userAchievementProgress = pgTable(
  'user_achievement_progress',
  {
    userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    lifetimeUniqueCellCount: integer('lifetime_unique_cell_count').notNull().default(0),
    launchArenasVisited: integer('launch_arenas_visited').notNull().default(0),
    generalArenasExplored: integer('general_arenas_explored').notNull().default(0),
    statesFlownIn: integer('states_flown_in').notNull().default(0),
    countriesFlownIn: integer('countries_flown_in').notNull().default(0),
    bestGeneralArenaId: uuid('best_general_arena_id').references(() => arenas.id, { onDelete: 'set null' }),
    bestGeneralClaimedCellCount: integer('best_general_claimed_cell_count').notNull().default(0),
    bestGeneralClaimableCellCount: integer('best_general_claimable_cell_count').notNull().default(0),
    projectionVersion: integer('projection_version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('user_achievement_progress_lifetime_unique_cell_count_nonnegative', sql`${table.lifetimeUniqueCellCount} >= 0`),
    check('user_achievement_progress_launch_arenas_visited_nonnegative', sql`${table.launchArenasVisited} >= 0`),
    check('user_achievement_progress_general_arenas_explored_nonnegative', sql`${table.generalArenasExplored} >= 0`),
    check('user_achievement_progress_states_flown_in_nonnegative', sql`${table.statesFlownIn} >= 0`),
    check('user_achievement_progress_countries_flown_in_nonnegative', sql`${table.countriesFlownIn} >= 0`),
    check('user_achievement_progress_best_general_claimed_cell_count_nonnegative', sql`${table.bestGeneralClaimedCellCount} >= 0`),
    check('user_achievement_progress_best_general_claimable_cell_count_nonnegative', sql`${table.bestGeneralClaimableCellCount} >= 0`),
    check('user_achievement_progress_best_general_claimed_not_above_claimable', sql`${table.bestGeneralClaimableCellCount} = 0 OR ${table.bestGeneralClaimedCellCount} <= ${table.bestGeneralClaimableCellCount}`),
    check('user_achievement_progress_projection_version_positive', sql`${table.projectionVersion} > 0`),
  ],
);

/** Current best value for a durable, user-scoped achievement record. */
export const achievementRecords = pgTable(
  'achievement_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    recordKey: text('record_key').notNull(),
    bestValue: integer('best_value').notNull(),
    sourceFlightId: uuid('source_flight_id').references(() => flights.id, { onDelete: 'set null' }),
    earnedAt: timestamp('earned_at', { withTimezone: true, mode: 'date' }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('achievement_records_user_id_record_key_unique').on(table.userId, table.recordKey),
    check('achievement_records_best_value_nonnegative', sql`${table.bestValue} > 0`),
    index('achievement_records_user_id_updated_at_idx').on(table.userId, table.updatedAt),
  ],
);

/** Immutable history of each strict improvement to a personal-best record. */
export const achievementRecordEvents = pgTable(
  'achievement_record_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id').notNull().references(() => achievementRecords.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sourceFlightId: uuid('source_flight_id').references(() => flights.id, { onDelete: 'set null' }),
    value: integer('value').notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true, mode: 'date' }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('achievement_record_events_record_id_earned_at_idx').on(table.recordId, table.earnedAt),
    index('achievement_record_events_user_id_earned_at_idx').on(table.userId, table.earnedAt),
    check('achievement_record_events_value_nonnegative', sql`${table.value} > 0`),
  ],
);

/** Immutable record of each accepted Ko-fi donation webhook. */
export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: text('message_id').notNull(),
    kofiTransactionId: text('kofi_transaction_id'),
    paymentTimestamp: timestamp('payment_timestamp', { withTimezone: true, mode: 'date' }).notNull(),
    paymentType: text('payment_type').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    isPublic: boolean('is_public').notNull(),
    isSubscriptionPayment: boolean('is_subscription_payment').notNull(),
    isFirstSubscriptionPayment: boolean('is_first_subscription_payment').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('donations_message_id_unique').on(table.messageId),
    index('donations_kofi_transaction_id_idx').on(table.kofiTransactionId),
    check('donations_amount_nonnegative', sql`${table.amount} >= 0`),
  ],
);
