import { bigint, boolean, check, customType, date, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const geometryPoint4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(point,4326)',
});

const geometryMultiPolygon6933 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon,6933)',
});

const geometryMultiPolygon4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon,4326)',
});

const geometryMultiLineString4326 = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiLineString,4326)',
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

export const pilotGroupMembershipStatus = pgEnum('pilot_group_membership_status', ['pending', 'accepted']);

export const pilotGroups = pgTable('pilot_groups', {
  id: uuid('group_id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ...timestamps,
}, (table) => [
  index('pilot_groups_owner_user_id_idx').on(table.ownerUserId),
]);

export type PlanTurnpoint = { latitude: number; longitude: number };

export type StoredPlanRoute = {
  route: PlanTurnpoint[];
  legs: Array<{
    directDistanceMeters: number;
    maximumDistanceMeters: number;
    routeDistanceMeters: number;
  }>;
  directDistanceMeters: number;
  maximumRouteDistanceMeters: number;
  routeDistanceMeters: number;
  actualExtraDistanceMeters: number;
  actualDeviationPercent: number;
  thermalCoverage: 'available' | 'unavailable';
};

export const planRoutingPriority = pgEnum('plan_routing_priority', ['shorter', 'balanced', 'thermal']);

/** Owner-scoped, durable snapshots of routes created in the planner. */
export const plans = pgTable('plans', {
  id: uuid('plan_id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  turnpoints: jsonb('turnpoints').$type<PlanTurnpoint[]>().notNull(),
  generatedRoute: jsonb('generated_route').$type<StoredPlanRoute>().notNull(),
  routingPriority: planRoutingPriority('routing_priority').notNull(),
  isPrivate: boolean('is_private').notNull().default(true),
  ...timestamps,
}, (table) => [
  check('plans_name_normalized', sql`${table.name} = btrim(${table.name})`),
  check('plans_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 80`),
  index('plans_owner_user_id_updated_at_plan_id_idx').on(table.ownerUserId, table.updatedAt, table.id),
]);

export const pilotGroupMemberships = pgTable('pilot_group_memberships', {
  groupId: uuid('group_id').notNull().references(() => pilotGroups.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: pilotGroupMembershipStatus('status').notNull(),
  invitedAt: timestamp('invited_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
  ...timestamps,
}, (table) => [
  primaryKey({ columns: [table.groupId, table.userId] }),
  index('pilot_group_memberships_user_status_idx').on(table.userId, table.status),
  index('pilot_group_memberships_group_status_idx').on(table.groupId, table.status),
]);

export const userPasswords = pgTable('user_passwords', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  ...timestamps,
});

export const gliderModels = pgTable(
  'glider_models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manufacturer: text('manufacturer').notNull(),
    model: text('model').notNull(),
    size: text('size').notNull(),
    enRating: text('en_rating').notNull(),
    discipline: text('discipline').notNull(),
    catalogStatus: text('catalog_status').notNull(),
    sourceUrl: text('source_url').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => [
    unique('glider_models_manufacturer_model_size_unique').on(table.manufacturer, table.model, table.size),
    unique('glider_models_sort_order_unique').on(table.sortOrder),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    territoryColor: text('territory_color').notNull().default('#1769AA'),
    gliderModelId: uuid('glider_model_id').references(() => gliderModels.id),
    gliderYear: integer('glider_year'),
    gliderCompetitionId: text('glider_competition_id'),
    gliderHoursSeconds: integer('glider_hours_seconds').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('profiles_user_id_idx').on(table.userId),
    check('profiles_glider_hours_seconds_nonnegative', sql`${table.gliderHoursSeconds} >= 0`),
    check('profiles_glider_year_supported', sql`${table.gliderYear} IS NULL OR ${table.gliderYear} >= 1980`),
    check(
      'profiles_glider_identity_complete',
      sql`(${table.gliderModelId} IS NULL AND ${table.gliderYear} IS NULL)
        OR (${table.gliderModelId} IS NOT NULL AND ${table.gliderYear} IS NOT NULL)`,
    ),
  ],
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

export const flightProcessingStatus = pgEnum('flight_processing_status', ['pending', 'processing', 'completed', 'failed']);

export const uploadBatchStatus = pgEnum('upload_batch_status', ['open', 'sealed', 'cancelled']);
export const workflowMemberStatus = pgEnum('workflow_member_status', ['pending', 'processing', 'completed', 'failed', 'skipped']);
export const bulkImportPhase = pgEnum('bulk_import_phase', ['preparing', 'processing', 'replaying', 'completed', 'failed', 'cancelled']);

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
    launchGpsAltitudeMeters: integer('launch_gps_altitude_meters'),
    minGpsAltitudeMeters: integer('min_gps_altitude_meters'),
    maxGpsAltitudeMeters: integer('max_gps_altitude_meters'),
    launchLatitude: doublePrecision('launch_latitude'),
    launchLongitude: doublePrecision('launch_longitude'),
    launchTimezone: text('launch_timezone'),
    launchId: bigint('launch_id', { mode: 'number' }).references(() => launches.id, { onDelete: 'restrict' }),
    launchMatchVersion: integer('launch_match_version'),
    ...timestamps,
  },
  (table) => [
    unique('flights_igc_file_id_unique').on(table.igcFileId),
    unique('flights_content_hash_unique').on(table.contentHash),
    index('flights_user_id_idx').on(table.userId),
    index('flights_user_id_processed_at_flight_id_idx').on(table.userId, table.processedAt, table.id),
    index('flights_igc_file_id_idx').on(table.igcFileId),
    index('flights_started_at_idx').on(table.startedAt),
    index('flights_launch_id_idx').on(table.launchId),
    index('flights_launch_match_version_idx').on(table.launchMatchVersion),
    check('flights_launch_match_version_positive', sql`${table.launchMatchVersion} IS NULL OR ${table.launchMatchVersion} > 0`),
  ],
);

/** Durable, rebuildable spatial read model for the flight map. */
export const flightMapFeatures = pgTable(
  'flight_map_features',
  {
    flightId: uuid('flight_id').primaryKey().references(() => flights.id, { onDelete: 'cascade' }),
    projectionVersion: integer('projection_version').notNull(),
    fullTrack: geometryMultiLineString4326('full_track').notNull(),
    west: doublePrecision('west').notNull(),
    south: doublePrecision('south').notNull(),
    east: doublePrecision('east').notNull(),
    north: doublePrecision('north').notNull(),
    crossesAntimeridian: boolean('crosses_antimeridian').notNull(),
    landingLatitude: doublePrecision('landing_latitude').notNull(),
    landingLongitude: doublePrecision('landing_longitude').notNull(),
    sourcePointCount: integer('source_point_count').notNull(),
    projectedAt: timestamp('projected_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('flight_map_features_projection_version_positive', sql`${table.projectionVersion} > 0`),
    check('flight_map_features_source_point_count_valid', sql`${table.sourcePointCount} >= 2`),
    check('flight_map_features_latitude_bounds_valid', sql`${table.south} >= -90 AND ${table.north} <= 90 AND ${table.south} <= ${table.north}`),
    check('flight_map_features_longitude_bounds_valid', sql`${table.west} >= -180 AND ${table.west} <= 180 AND ${table.east} >= -180 AND ${table.east} <= 180`),
    index('flight_map_features_full_track_gist_idx').using('gist', table.fullTrack),
  ],
);

/** Zoom-specific rendering derivatives. Never used for spatial eligibility. */
export const flightMapGeometryLods = pgTable(
  'flight_map_geometry_lods',
  {
    flightId: uuid('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
    projectionVersion: integer('projection_version').notNull(),
    minZoom: integer('min_zoom').notNull(),
    maxZoom: integer('max_zoom').notNull(),
    toleranceMeters: doublePrecision('tolerance_meters').notNull(),
    geometry: geometryMultiLineString4326('geometry').notNull(),
    pointCount: integer('point_count').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.flightId, table.projectionVersion, table.minZoom] }),
    check('flight_map_geometry_lods_projection_version_positive', sql`${table.projectionVersion} > 0`),
    check('flight_map_geometry_lods_zoom_range_valid', sql`${table.minZoom} >= 0 AND ${table.maxZoom} >= ${table.minZoom}`),
    check('flight_map_geometry_lods_tolerance_positive', sql`${table.toleranceMeters} > 0`),
    check('flight_map_geometry_lods_point_count_valid', sql`${table.pointCount} >= 2`),
    index('flight_map_geometry_lods_geometry_gist_idx').using('gist', table.geometry),
    index('flight_map_geometry_lods_zoom_idx').on(table.minZoom, table.maxZoom),
  ],
);

/** Durable progress through the optional, new-account onboarding experience. */
export const userOnboardingState = pgTable('user_onboarding_state', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  firstFlightId: uuid('first_flight_id').references(() => flights.id, { onDelete: 'set null' }),
  firstFlightCompletedAt: timestamp('first_flight_completed_at', { withTimezone: true, mode: 'date' }),
  personalMapViewedAt: timestamp('personal_map_viewed_at', { withTimezone: true, mode: 'date' }),
  competitiveMapViewedAt: timestamp('competitive_map_viewed_at', { withTimezone: true, mode: 'date' }),
  followedThreePilotsAt: timestamp('followed_three_pilots_at', { withTimezone: true, mode: 'date' }),
  groupsAt: timestamp('groups_at', { withTimezone: true, mode: 'date' }),
  gliderAddedAt: timestamp('glider_added_at', { withTimezone: true, mode: 'date' }),
  historyImportCompletedAt: timestamp('history_import_completed_at', { withTimezone: true, mode: 'date' }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  ...timestamps,
});

export const regularUploadBatches = pgTable('regular_upload_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: uploadBatchStatus('status').notNull().default('open'),
  ...timestamps,
}, (table) => [index('regular_upload_batches_user_created_idx').on(table.userId, table.createdAt)]);

export const regularUploadMembers = pgTable('regular_upload_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id').notNull().references(() => regularUploadBatches.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  flightId: uuid('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
  uploadJobId: text('upload_job_id'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
  status: workflowMemberStatus('status').notNull().default('pending'),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
  failureReason: text('failure_reason'),
  ...timestamps,
}, (table) => [
  unique('regular_upload_members_flight_unique').on(table.flightId),
  uniqueIndex('regular_upload_members_upload_job_unique_idx').on(table.uploadJobId),
  index('regular_upload_members_queue_idx').on(table.userId, table.status, table.startedAt, table.flightId),
  uniqueIndex('regular_upload_members_one_processing_per_user_idx').on(table.userId).where(sql`${table.status} = 'processing'`),
]);

export const bulkImports = pgTable('bulk_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  phase: bulkImportPhase('phase').notNull().default('preparing'),
  replayCursor: integer('replay_cursor').notNull().default(0),
  replayCheckpointCount: integer('replay_checkpoint_count').notNull().default(0),
  lastError: text('last_error'),
  ...timestamps,
}, (table) => [
  index('bulk_imports_user_phase_idx').on(table.userId, table.phase),
  uniqueIndex('bulk_imports_one_active_per_user_idx').on(table.userId)
    .where(sql`${table.phase} IN ('preparing', 'processing', 'replaying', 'failed')`),
]);

export const bulkImportMembers = pgTable('bulk_import_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  importId: uuid('import_id').notNull().references(() => bulkImports.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  flightId: uuid('flight_id').notNull().references(() => flights.id, { onDelete: 'cascade' }),
  uploadJobId: text('upload_job_id'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
  status: workflowMemberStatus('status').notNull().default('pending'),
  claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
  failureReason: text('failure_reason'),
  ...timestamps,
}, (table) => [
  unique('bulk_import_members_import_flight_unique').on(table.importId, table.flightId),
  uniqueIndex('bulk_import_members_upload_job_unique_idx').on(table.uploadJobId),
  index('bulk_import_members_queue_idx').on(table.importId, table.status, table.startedAt, table.flightId),
  uniqueIndex('bulk_import_members_one_processing_idx').on(table.importId).where(sql`${table.status} = 'processing'`),
]);

export const userWorkflowState = pgTable('user_workflow_state', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  dirtyAchievementBoundary: timestamp('dirty_achievement_boundary', { withTimezone: true, mode: 'date' }),
  dirtyRevision: integer('dirty_revision').notNull().default(0),
  ...timestamps,
});

export type TotalDistanceMetadata = Record<string, never>;

export interface NPointDistanceMetadata {
  points: Array<{
    sequenceNumber: number;
    recordedAt: string;
    latitude: number;
    longitude: number;
    gpsAltitudeMeters: number;
  }>;
}

/** Current calculated scoring values for a completed flight. */
export const flightScores = pgTable(
  'flight_scores',
  {
    flightId: uuid('flight_id').primaryKey().references(() => flights.id, { onDelete: 'cascade' }),
    totalDistanceMeters: doublePrecision('total_distance_meters').notNull(),
    totalDistanceCalcVersion: integer('total_distance_calc_version').notNull().default(1),
    totalDistanceMetadata: jsonb('total_distance_metadata').$type<TotalDistanceMetadata>().notNull(),
    threePointDistanceMeters: doublePrecision('three_point_distance_meters'),
    threePointDistanceCalcVersion: integer('three_point_distance_calc_version'),
    threePointDistanceMetadata: jsonb('three_point_distance_metadata').$type<NPointDistanceMetadata>(),
    fourPointDistanceMeters: doublePrecision('four_point_distance_meters'),
    fourPointDistanceCalcVersion: integer('four_point_distance_calc_version'),
    fourPointDistanceMetadata: jsonb('four_point_distance_metadata').$type<NPointDistanceMetadata>(),
    fivePointDistanceMeters: doublePrecision('five_point_distance_meters'),
    fivePointDistanceCalcVersion: integer('five_point_distance_calc_version'),
    fivePointDistanceMetadata: jsonb('five_point_distance_metadata').$type<NPointDistanceMetadata>(),
    sixPointDistanceMeters: doublePrecision('six_point_distance_meters'),
    sixPointDistanceCalcVersion: integer('six_point_distance_calc_version'),
    sixPointDistanceMetadata: jsonb('six_point_distance_metadata').$type<NPointDistanceMetadata>(),
  },
  (table) => [
    check('flight_scores_total_distance_meters_nonnegative', sql`${table.totalDistanceMeters} >= 0`),
    check('flight_scores_total_distance_calc_version_positive', sql`${table.totalDistanceCalcVersion} > 0`),
    check('flight_scores_three_point_distance_meters_nonnegative', sql`${table.threePointDistanceMeters} >= 0`),
    check('flight_scores_three_point_distance_calc_version_positive', sql`${table.threePointDistanceCalcVersion} > 0`),
    check(
      'flight_scores_three_point_distance_complete',
      sql`(
        ${table.threePointDistanceMeters} IS NULL
        AND ${table.threePointDistanceCalcVersion} IS NULL
        AND ${table.threePointDistanceMetadata} IS NULL
      ) OR (
        ${table.threePointDistanceMeters} IS NOT NULL
        AND ${table.threePointDistanceCalcVersion} IS NOT NULL
        AND ${table.threePointDistanceMetadata} IS NOT NULL
      )`,
    ),
    check('flight_scores_four_point_distance_meters_nonnegative', sql`${table.fourPointDistanceMeters} >= 0`),
    check('flight_scores_four_point_distance_calc_version_positive', sql`${table.fourPointDistanceCalcVersion} > 0`),
    check(
      'flight_scores_four_point_distance_complete',
      sql`(
        ${table.fourPointDistanceMeters} IS NULL
        AND ${table.fourPointDistanceCalcVersion} IS NULL
        AND ${table.fourPointDistanceMetadata} IS NULL
      ) OR (
        ${table.fourPointDistanceMeters} IS NOT NULL
        AND ${table.fourPointDistanceCalcVersion} IS NOT NULL
        AND ${table.fourPointDistanceMetadata} IS NOT NULL
      )`,
    ),
    check('flight_scores_five_point_distance_meters_nonnegative', sql`${table.fivePointDistanceMeters} >= 0`),
    check('flight_scores_five_point_distance_calc_version_positive', sql`${table.fivePointDistanceCalcVersion} > 0`),
    check(
      'flight_scores_five_point_distance_complete',
      sql`(
        ${table.fivePointDistanceMeters} IS NULL
        AND ${table.fivePointDistanceCalcVersion} IS NULL
        AND ${table.fivePointDistanceMetadata} IS NULL
      ) OR (
        ${table.fivePointDistanceMeters} IS NOT NULL
        AND ${table.fivePointDistanceCalcVersion} IS NOT NULL
        AND ${table.fivePointDistanceMetadata} IS NOT NULL
      )`,
    ),
    check('flight_scores_six_point_distance_meters_nonnegative', sql`${table.sixPointDistanceMeters} >= 0`),
    check('flight_scores_six_point_distance_calc_version_positive', sql`${table.sixPointDistanceCalcVersion} > 0`),
    check(
      'flight_scores_six_point_distance_complete',
      sql`(
        ${table.sixPointDistanceMeters} IS NULL
        AND ${table.sixPointDistanceCalcVersion} IS NULL
        AND ${table.sixPointDistanceMetadata} IS NULL
      ) OR (
        ${table.sixPointDistanceMeters} IS NOT NULL
        AND ${table.sixPointDistanceCalcVersion} IS NOT NULL
        AND ${table.sixPointDistanceMetadata} IS NOT NULL
      )`,
    ),
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
    index('launches_location_geography_gist_idx').using(
      'gist',
      sql`(ST_SetSRID(ST_MakePoint(${table.longitude}, ${table.latitude}), 4326)::geography)`,
    ),
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

/** Current personal progress projection for each Arena a pilot has touched. */
export const userArenaProgress = pgTable(
  'user_arena_progress',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    arenaId: uuid('arena_id').notNull().references(() => arenas.id, { onDelete: 'cascade' }),
    claimedCellCount: integer('claimed_cell_count').notNull().default(0),
    visited: boolean('visited').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.arenaId] }),
    check('user_arena_progress_claimed_cell_count_nonnegative', sql`${table.claimedCellCount} >= 0`),
    index('user_arena_progress_arena_id_claimed_cell_count_idx')
      .on(table.arenaId, table.claimedCellCount)
      .where(sql`${table.claimedCellCount} > 0`),
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
    index('competition_grid_claims_month_user_flight_idx').on(
      table.competitionMonth,
      table.claimUser,
      table.claimFlight,
    ),
  ],
);

export const thermalTileProcessingStatus = pgEnum('thermal_tile_processing_status', [
  'pending',
  'processing',
  'complete',
  'empty',
  'failed',
]);

export const thermalActivityBand = pgEnum('thermal_activity_band', ['dark_blue', 'cyan', 'yellow_orange', 'red']);
export const thermalCrawlJobStatus = pgEnum('thermal_crawl_job_status', ['pending', 'running', 'paused', 'complete', 'cancelled', 'failed']);
export const thermalCrawlTileStatus = pgEnum('thermal_crawl_tile_status', ['pending', 'processing', 'cached', 'empty', 'failed']);

/** Cached Thermal.kk raster tiles. Only native zoom-12 tiles are vectorized. */
export const thermalRasterTiles = pgTable(
  'thermal_raster_tiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceLayerKey: text('source_layer_key').notNull().default('thermals_all_all'),
    zoom: integer('zoom').notNull(),
    tileX: integer('tile_x').notNull(),
    tmsY: integer('tms_y').notNull(),
    bucketKey: text('bucket_key').notNull(),
    checksum: text('checksum').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentType: text('content_type').notNull().default('image/png'),
    processingStatus: thermalTileProcessingStatus('processing_status'),
    processingVersion: integer('processing_version').notNull().default(1),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    lastProcessingError: text('last_processing_error'),
    cachedAt: timestamp('cached_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    ...timestamps,
  },
  (table) => [
    unique('thermal_raster_tiles_source_coordinates_unique').on(table.sourceLayerKey, table.zoom, table.tileX, table.tmsY),
    uniqueIndex('thermal_raster_tiles_bucket_key_idx').on(table.bucketKey),
    index('thermal_raster_tiles_processing_queue_idx').on(table.processingStatus, table.leaseExpiresAt, table.cachedAt),
    check('thermal_raster_tiles_zoom_supported', sql`${table.zoom} >= 0 AND ${table.zoom} <= 12`),
    check('thermal_raster_tiles_coordinates_nonnegative', sql`${table.tileX} >= 0 AND ${table.tmsY} >= 0`),
    check('thermal_raster_tiles_byte_size_positive', sql`${table.byteSize} > 0`),
    check('thermal_raster_tiles_attempts_nonnegative', sql`${table.processingAttempts} >= 0`),
    check(
      'thermal_raster_tiles_processing_zoom',
      sql`(${table.zoom} = 12 AND ${table.processingStatus} IS NOT NULL) OR (${table.zoom} <> 12 AND ${table.processingStatus} IS NULL)`,
    ),
  ],
);

/** Tile-local, versioned lift areas derived from cached zoom-12 rasters. */
export const thermalAreas = pgTable(
  'thermal_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rasterTileId: uuid('raster_tile_id').notNull().references(() => thermalRasterTiles.id, { onDelete: 'cascade' }),
    componentIndex: integer('component_index').notNull(),
    activityBand: thermalActivityBand('activity_band').notNull(),
    relativeScore: doublePrecision('relative_score').notNull(),
    geometry: geometryMultiPolygon4326('geometry').notNull(),
    areaSquareMeters: doublePrecision('area_square_meters').notNull(),
    rasterChecksum: text('raster_checksum').notNull(),
    processingVersion: integer('processing_version').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('thermal_areas_tile_version_component_unique').on(table.rasterTileId, table.processingVersion, table.activityBand, table.componentIndex),
    index('thermal_areas_geometry_idx').using('gist', table.geometry),
    index('thermal_areas_geography_idx').using('gist', sql`(${table.geometry}::geography)`),
    index('thermal_areas_score_idx').on(table.relativeScore),
    index('thermal_areas_tile_idx').on(table.rasterTileId),
    check('thermal_areas_component_nonnegative', sql`${table.componentIndex} >= 0`),
    check('thermal_areas_score_range', sql`${table.relativeScore} > 0 AND ${table.relativeScore} <= 1`),
    check('thermal_areas_area_positive', sql`${table.areaSquareMeters} > 0`),
  ],
);

export const thermalCrawlJobs = pgTable(
  'thermal_crawl_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sourceLayerKey: text('source_layer_key').notNull().default('thermals_all_all'),
    targetGeometry: geometryMultiPolygon4326('target_geometry').notNull(),
    status: thermalCrawlJobStatus('status').notNull().default('pending'),
    createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [index('thermal_crawl_jobs_status_created_idx').on(table.status, table.createdAt)],
);

export const thermalCrawlJobTiles = pgTable(
  'thermal_crawl_job_tiles',
  {
    jobId: uuid('job_id').notNull().references(() => thermalCrawlJobs.id, { onDelete: 'cascade' }),
    zoom: integer('zoom').notNull().default(12),
    tileX: integer('tile_x').notNull(),
    tmsY: integer('tms_y').notNull(),
    status: thermalCrawlTileStatus('status').notNull().default('pending'),
    rasterTileId: uuid('raster_tile_id').references(() => thermalRasterTiles.id, { onDelete: 'set null' }),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.zoom, table.tileX, table.tmsY] }),
    index('thermal_crawl_job_tiles_queue_idx').on(table.status, table.jobId, table.tileX, table.tmsY),
    check('thermal_crawl_job_tiles_zoom_12', sql`${table.zoom} = 12`),
    check('thermal_crawl_job_tiles_coordinates_nonnegative', sql`${table.tileX} >= 0 AND ${table.tmsY} >= 0`),
    check('thermal_crawl_job_tiles_attempts_nonnegative', sql`${table.attemptCount} >= 0`),
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
    index('achievements_source_flight_id_idx').on(table.sourceFlightId),
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
    index('achievement_record_events_source_flight_id_idx').on(table.sourceFlightId),
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
