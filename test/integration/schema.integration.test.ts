import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => {
  database = await resetAndMigrateTestDatabase();
});

afterAll(async () => {
  await database.pool.end();
});

describe('authentication schema', () => {
  it('contains flight and track-point tables with the expected columns', async () => {
    const result = await database.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name <> 'spatial_ref_sys'
       ORDER BY table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      'achievement_record_events',
      'achievement_records',
      'achievements',
      'activities',
      'activity_reactions',
      'app_sessions',
      'arena_current_leaders',
      'arena_leadership_events',
      'arena_leadership_states',
      'arenas',
      'competition_grid_claims',
      'donations',
      'flight_progress',
      'flights',
      'igc_files',
      'launches',
      'pilot_follows',
      'profiles',
      'track_points',
      'user_achievement_progress',
      'user_arena_progress',
      'user_grid_claims',
      'user_passwords',
      'users',
    ]);

    const columns = await database.pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'flights' ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'content_hash', is_nullable: 'NO' },
      { column_name: 'created_at', is_nullable: 'NO' },
      { column_name: 'distance_meters', is_nullable: 'YES' },
      { column_name: 'duration_seconds', is_nullable: 'YES' },
      { column_name: 'ended_at', is_nullable: 'YES' },
      { column_name: 'flight_id', is_nullable: 'NO' },
      { column_name: 'igc_file_id', is_nullable: 'NO' },
      { column_name: 'launch_latitude', is_nullable: 'YES' },
      { column_name: 'launch_longitude', is_nullable: 'YES' },
      { column_name: 'launch_timezone', is_nullable: 'YES' },
      { column_name: 'processed_at', is_nullable: 'YES' },
      { column_name: 'processing_error', is_nullable: 'YES' },
      { column_name: 'processing_status', is_nullable: 'NO' },
      { column_name: 'processing_token', is_nullable: 'YES' },
      { column_name: 'started_at', is_nullable: 'YES' },
      { column_name: 'updated_at', is_nullable: 'NO' },
      { column_name: 'user_id', is_nullable: 'NO' },
    ]);
  });

  it('contains empty activity persistence with flight publication constraints', async () => {
    const columns = await database.pool.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'activities'
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'activity_type', is_nullable: 'NO', column_default: "'flight'::text" },
      { column_name: 'actor_user_id', is_nullable: 'NO', column_default: null },
      { column_name: 'created_at', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'id', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
      { column_name: 'published_at', is_nullable: 'NO', column_default: null },
      { column_name: 'source_flight_id', is_nullable: 'YES', column_default: null },
      { column_name: 'updated_at', is_nullable: 'NO', column_default: 'now()' },
    ]);

    const constraints = await database.pool.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'activities'::regclass
       ORDER BY conname`,
    );
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { conname: 'activities_id_actor_user_id_unique', definition: 'UNIQUE (id, actor_user_id)' },
    ]));
    expect(constraints.rows.find(({ conname }) => conname === 'activities_flight_source_required')?.definition)
      .toContain("activity_type <> 'flight'::text");

    const count = await database.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM activities');
    expect(count.rows).toEqual([{ count: 0 }]);
  });

  it('stores nullable flight completion timestamps with per-user completion ordering support', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, udt_name, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'flights' AND column_name = 'processed_at'`,
    );
    expect(columns.rows).toEqual([
      {
        column_name: 'processed_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        udt_name: 'timestamptz',
        column_default: null,
      },
    ]);

    const indexes = await database.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'flights'
         AND indexname = 'flights_user_id_processed_at_flight_id_idx'`,
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).toContain('(user_id, processed_at, flight_id)');
  });

  it('stores achievement history with unique keys, profile ordering, and deletion semantics', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      [
        'SELECT column_name, data_type, is_nullable, column_default',
        'FROM information_schema.columns',
        "WHERE table_schema = 'public' AND table_name = 'achievements'",
        'ORDER BY column_name',
      ].join('\n'),
    );
    expect(columns.rows).toEqual([
      { column_name: 'achievement_key', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'achievement_type', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'details', data_type: 'jsonb', is_nullable: 'NO', column_default: null },
      { column_name: 'earned_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
      { column_name: 'source_flight_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
    ]);

    const constraints = await database.pool.query<{ conname: string; definition: string }>(
      [
        'SELECT conname, pg_get_constraintdef(oid) AS definition',
        'FROM pg_constraint',
        "WHERE conrelid = 'achievements'::regclass",
        'ORDER BY conname',
      ].join('\n'),
    );
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { conname: 'achievements_pkey', definition: 'PRIMARY KEY (id)' },
      { conname: 'achievements_user_id_achievement_key_unique', definition: 'UNIQUE (user_id, achievement_key)' },
    ]));

    const foreignKeys = await database.pool.query<{ referenced_table: string; column_name: string; confdeltype: string }>(
      [
        'SELECT referenced.relname AS referenced_table,',
        '       local.attname AS column_name,',
        '       constraint_row.confdeltype',
        'FROM pg_constraint constraint_row',
        'INNER JOIN pg_class referenced ON referenced.oid = constraint_row.confrelid',
        'INNER JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS local_key(attnum, position) ON true',
        'INNER JOIN pg_attribute local',
        '  ON local.attrelid = constraint_row.conrelid AND local.attnum = local_key.attnum',
        "WHERE constraint_row.conrelid = 'achievements'::regclass",
        "  AND constraint_row.contype = 'f'",
        'ORDER BY local.attname',
      ].join('\n'),
    );
    expect(foreignKeys.rows).toEqual([
      { referenced_table: 'flights', column_name: 'source_flight_id', confdeltype: 'n' },
      { referenced_table: 'users', column_name: 'user_id', confdeltype: 'c' },
    ]);

    const indexes = await database.pool.query<{ indexname: string; indexdef: string }>(
      [
        'SELECT indexname, indexdef',
        'FROM pg_indexes',
        "WHERE schemaname = 'public' AND tablename = 'achievements'",
        'ORDER BY indexname',
      ].join('\n'),
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'achievements_pkey',
      'achievements_user_id_achievement_key_unique',
      'achievements_user_id_earned_at_idx',
    ]);
    expect(indexes.rows.find(({ indexname }) => indexname === 'achievements_user_id_earned_at_idx')?.indexdef)
      .toContain('(user_id, earned_at)');
  });

  it('stores Ko-fi donations with required fields, idempotency, and amount bounds', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'donations'
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'amount', data_type: 'numeric', is_nullable: 'NO', column_default: null },
      { column_name: 'currency', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
      { column_name: 'is_first_subscription_payment', data_type: 'boolean', is_nullable: 'NO', column_default: null },
      { column_name: 'is_public', data_type: 'boolean', is_nullable: 'NO', column_default: null },
      { column_name: 'is_subscription_payment', data_type: 'boolean', is_nullable: 'NO', column_default: null },
      { column_name: 'kofi_transaction_id', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'message_id', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'payload', data_type: 'jsonb', is_nullable: 'NO', column_default: null },
      { column_name: 'payment_timestamp', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: null },
      { column_name: 'payment_type', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'received_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
    ]);

    const constraints = await database.pool.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'donations'::regclass
       ORDER BY conname`,
    );
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { conname: 'donations_amount_nonnegative', definition: 'CHECK ((amount >= (0)::numeric))' },
      { conname: 'donations_message_id_unique', definition: 'UNIQUE (message_id)' },
      { conname: 'donations_pkey', definition: 'PRIMARY KEY (id)' },
    ]));

    const indexes = await database.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'donations'
       ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'donations_kofi_transaction_id_idx',
      'donations_message_id_unique',
      'donations_pkey',
    ]);
    expect(indexes.rows.find(({ indexname }) => indexname === 'donations_kofi_transaction_id_idx')?.indexdef)
      .toContain('(kofi_transaction_id)');
  });

  it('stores canonical Arena polygons and optional launch metadata', async () => {
    const geometryColumns = await database.pool.query<{
      f_geometry_column: string;
      srid: number;
      type: string;
    }>(
      `SELECT f_geometry_column, srid, type
       FROM geometry_columns
       WHERE f_table_schema = 'public' AND f_table_name = 'arenas'
       ORDER BY f_geometry_column`,
    );
    const areaColumns = await database.pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'arenas'
       ORDER BY ordinal_position`,
    );
    const claimableColumns = await database.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'arenas'
         AND column_name IN ('claimable_cell_count')
       ORDER BY column_name`,
    );
    const indexes = await database.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'arenas'
       ORDER BY indexname`,
    );

    expect(areaColumns.rows).toEqual([
      { column_name: 'id', is_nullable: 'NO' },
      { column_name: 'source_id', is_nullable: 'NO' },
      { column_name: 'name', is_nullable: 'NO' },
      { column_name: 'country', is_nullable: 'NO' },
      { column_name: 'state', is_nullable: 'YES' },
      { column_name: 'city', is_nullable: 'YES' },
      { column_name: 'location', is_nullable: 'YES' },
      { column_name: 'altitude_meters', is_nullable: 'YES' },
      { column_name: 'timezone', is_nullable: 'YES' },
      { column_name: 'area', is_nullable: 'NO' },
      { column_name: 'external_source', is_nullable: 'YES' },
      { column_name: 'external_id', is_nullable: 'YES' },
      { column_name: 'arena_type', is_nullable: 'NO' },
      { column_name: 'country_code', is_nullable: 'NO' },
      { column_name: 'claimable_cell_count', is_nullable: 'YES' },
    ]);
    expect(claimableColumns.rows).toEqual([
      { column_name: 'claimable_cell_count', data_type: 'bigint' },
    ]);
    expect(geometryColumns.rows).toEqual([
      { f_geometry_column: 'area', srid: 6933, type: 'MULTIPOLYGON' },
      { f_geometry_column: 'location', srid: 4326, type: 'POINT' },
    ]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'arenas_area_gist_idx',
      'arenas_arena_type_external_id_state_country_unique',
      'arenas_external_source_external_id_unique',
      'arenas_id_arena_type_unique',
      'arenas_pkey',
      'arenas_source_id_unique',
    ]);
    expect(indexes.rows.find(({ indexname }) => indexname === 'arenas_area_gist_idx')?.indexdef)
      .toContain('USING gist (area)');
    expect(indexes.rows.find(({ indexname }) => indexname === 'arenas_external_source_external_id_unique')?.indexdef)
      .toContain('WHERE ((external_source IS NOT NULL) AND (external_id IS NOT NULL))');
    const enumValues = await database.pool.query<{ enumlabel: string }>(
      `SELECT enumlabel
       FROM pg_enum
       INNER JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
       WHERE pg_type.typname = 'arena_type'
       ORDER BY enumsortorder`,
    );
    expect(enumValues.rows.map(({ enumlabel }) => enumlabel)).toEqual(['launch', 'general', 'state', 'country']);
  });

  it('persists eligible Arena leadership snapshots, joint leaders, and replay-safe events', async () => {
    const stateColumns = await database.pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'arena_leadership_states'
       ORDER BY column_name`,
    );
    expect(stateColumns.rows).toEqual([
      { column_name: 'arena_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'arena_type', data_type: 'USER-DEFINED', is_nullable: 'NO', column_default: null },
      { column_name: 'last_claim_source_flight_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'last_claim_timestamp', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { column_name: 'last_reconciled_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'last_reconciliation_key', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'leading_cell_count', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
      { column_name: 'next_rank_cell_count', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
    ]);

    const constraints = await database.pool.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid IN ('arena_leadership_states'::regclass, 'arena_current_leaders'::regclass, 'arena_leadership_events'::regclass)
       ORDER BY conname`,
    );
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { conname: 'arena_leadership_states_eligible_arena_type_check', definition: "CHECK ((arena_type = ANY (ARRAY['general'::arena_type, 'state'::arena_type, 'country'::arena_type])))" },
      { conname: 'arena_leadership_states_leading_cell_count_nonnegative', definition: 'CHECK ((leading_cell_count >= 0))' },
      { conname: 'arena_leadership_states_next_rank_cell_count_nonnegative', definition: 'CHECK ((next_rank_cell_count >= 0))' },
      { conname: 'arena_current_leaders_cells_claimed_positive', definition: 'CHECK ((cells_claimed > 0))' },
      { conname: 'arena_current_leaders_pkey', definition: 'PRIMARY KEY (arena_id, user_id)' },
      { conname: 'arena_leadership_events_event_key_unique', definition: 'UNIQUE (event_key)' },
    ]));

    const foreignKeys = await database.pool.query<{ table_name: string; referenced_table: string; column_name: string; confdeltype: string }>(
      `SELECT local_table.relname AS table_name,
              referenced.relname AS referenced_table,
              local.attname AS column_name,
              constraint_row.confdeltype
       FROM pg_constraint constraint_row
       INNER JOIN pg_class local_table ON local_table.oid = constraint_row.conrelid
       INNER JOIN pg_class referenced ON referenced.oid = constraint_row.confrelid
       INNER JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS local_key(attnum, position) ON true
       INNER JOIN pg_attribute local
         ON local.attrelid = constraint_row.conrelid AND local.attnum = local_key.attnum
       WHERE constraint_row.conrelid IN ('arena_leadership_states'::regclass, 'arena_current_leaders'::regclass, 'arena_leadership_events'::regclass)
         AND constraint_row.contype = 'f'
       ORDER BY table_name, column_name`,
    );
    expect(foreignKeys.rows).toEqual(expect.arrayContaining([
      { table_name: 'arena_current_leaders', referenced_table: 'arena_leadership_states', column_name: 'arena_id', confdeltype: 'c' },
      { table_name: 'arena_current_leaders', referenced_table: 'flights', column_name: 'decisive_source_flight_id', confdeltype: 'n' },
      { table_name: 'arena_current_leaders', referenced_table: 'users', column_name: 'user_id', confdeltype: 'c' },
      { table_name: 'arena_leadership_events', referenced_table: 'arena_leadership_states', column_name: 'arena_id', confdeltype: 'c' },
      { table_name: 'arena_leadership_events', referenced_table: 'flights', column_name: 'source_flight_id', confdeltype: 'n' },
      { table_name: 'arena_leadership_events', referenced_table: 'users', column_name: 'user_id', confdeltype: 'c' },
      { table_name: 'arena_leadership_states', referenced_table: 'flights', column_name: 'last_claim_source_flight_id', confdeltype: 'n' },
    ]));

    const indexes = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename IN ('arena_current_leaders', 'arena_leadership_events')
       ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'arena_current_leaders_arena_id_took_lead_at_idx',
      'arena_current_leaders_pkey',
      'arena_current_leaders_user_id_took_lead_at_idx',
      'arena_leadership_events_arena_id_claim_timestamp_idx',
      'arena_leadership_events_arena_id_user_id_claim_timestamp_idx',
      'arena_leadership_events_event_key_unique',
      'arena_leadership_events_pkey',
      'arena_leadership_events_source_flight_id_idx',
    ]);
  });

  it('stores permanent personal grid contributions with a cascading pilot and flight identity', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>(
      `SELECT column_name, data_type, is_nullable, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_grid_claims'
       ORDER BY column_name`,
    );
    const primaryKey = await database.pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'user_grid_claims'::regclass AND contype = 'p'`,
    );
    const foreignKeys = await database.pool.query<{ confdeltype: string }>(
      `SELECT confdeltype
       FROM pg_constraint
       WHERE conrelid = 'user_grid_claims'::regclass AND contype = 'f'
       ORDER BY conname`,
    );
    const indexes = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'user_grid_claims'
       ORDER BY indexname`,
    );

    expect(columns.rows).toEqual([
      { column_name: 'claim_flight', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'claim_timestamp', data_type: 'timestamp with time zone', is_nullable: 'NO', udt_name: 'timestamptz' },
      { column_name: 'claim_user', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'x', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
      { column_name: 'y', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
    ]);
    expect(primaryKey.rows).toEqual([{ definition: 'PRIMARY KEY (claim_user, x, y, claim_flight)' }]);
    expect(foreignKeys.rows).toEqual([{ confdeltype: 'c' }, { confdeltype: 'c' }]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'user_grid_claims_claim_flight_idx',
      'user_grid_claims_claim_user_idx',
      'user_grid_claims_pkey',
    ]);
  });

  it('stores progression snapshots with nonnegative counts, cascading references, and profile query support', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'flight_progress'
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'direct_cell_count', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'enclosed_cell_count', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'evaluated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'flight_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'new_personal_cell_count', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'personal_cell_total_after', data_type: 'integer', is_nullable: 'NO', column_default: null },
      { column_name: 'progression_version', data_type: 'integer', is_nullable: 'NO', column_default: '1' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
    ]);

    const constraints = await database.pool.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'flight_progress'::regclass
       ORDER BY conname`,
    );
    expect(constraints.rows).toEqual(expect.arrayContaining([
      { conname: 'flight_progress_direct_cell_count_nonnegative', definition: 'CHECK ((direct_cell_count >= 0))' },
      { conname: 'flight_progress_enclosed_cell_count_nonnegative', definition: 'CHECK ((enclosed_cell_count >= 0))' },
      { conname: 'flight_progress_new_personal_cell_count_nonnegative', definition: 'CHECK ((new_personal_cell_count >= 0))' },
      { conname: 'flight_progress_personal_cell_total_after_nonnegative', definition: 'CHECK ((personal_cell_total_after >= 0))' },
      { conname: 'flight_progress_pkey', definition: 'PRIMARY KEY (flight_id)' },
    ]));

    const foreignKeys = await database.pool.query<{ referenced_table: string; column_name: string; confdeltype: string }>(
      `SELECT referenced.relname AS referenced_table,
              local.attname AS column_name,
              constraint_row.confdeltype
       FROM pg_constraint constraint_row
       INNER JOIN pg_class referenced ON referenced.oid = constraint_row.confrelid
       INNER JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS local_key(attnum, position) ON true
       INNER JOIN pg_attribute local
         ON local.attrelid = constraint_row.conrelid AND local.attnum = local_key.attnum
       WHERE constraint_row.conrelid = 'flight_progress'::regclass
         AND constraint_row.contype = 'f'
       ORDER BY local.attname`,
    );
    expect(foreignKeys.rows).toEqual([
      { referenced_table: 'flights', column_name: 'flight_id', confdeltype: 'c' },
      { referenced_table: 'users', column_name: 'user_id', confdeltype: 'c' },
    ]);

    const indexes = await database.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'flight_progress'
       ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'flight_progress_pkey',
      'flight_progress_user_id_evaluated_at_idx',
    ]);
    expect(indexes.rows.find(({ indexname }) => indexname === 'flight_progress_user_id_evaluated_at_idx')?.indexdef)
      .toContain('(user_id, evaluated_at)');
  });

  it('stores monthly competition cell history with cascading ownership references', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>(
      `SELECT column_name, data_type, is_nullable, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'competition_grid_claims'
       ORDER BY column_name`,
    );
    const primaryKey = await database.pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'competition_grid_claims'::regclass AND contype = 'p'`,
    );
    const foreignKeys = await database.pool.query<{ confdeltype: string }>(
      `SELECT confdeltype
       FROM pg_constraint
       WHERE conrelid = 'competition_grid_claims'::regclass AND contype = 'f'
       ORDER BY conname`,
    );
    const indexes = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'competition_grid_claims'
       ORDER BY indexname`,
    );

    expect(columns.rows).toEqual([
      { column_name: 'claim_flight', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'claim_timestamp', data_type: 'timestamp with time zone', is_nullable: 'NO', udt_name: 'timestamptz' },
      { column_name: 'claim_user', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'competition_month', data_type: 'date', is_nullable: 'NO', udt_name: 'date' },
      { column_name: 'x', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
      { column_name: 'y', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
    ]);
    expect(primaryKey.rows).toEqual([{
      definition: 'PRIMARY KEY (competition_month, x, y, claim_flight)',
    }]);
    expect(foreignKeys.rows).toEqual([{ confdeltype: 'c' }, { confdeltype: 'c' }]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'competition_grid_claims_cell_history_idx',
      'competition_grid_claims_claim_flight_idx',
      'competition_grid_claims_month_cell_timestamp_idx',
      'competition_grid_claims_pkey',
    ]);
  });

  it('enforces a unique source file and ordered point sequence per flight', async () => {
    const constraints = await database.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid IN ('flights'::regclass, 'track_points'::regclass)
       ORDER BY conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual(expect.arrayContaining([
      'flights_igc_file_id_unique',
      'flights_content_hash_unique',
    ]));
    expect(constraints.rows.map((row) => row.conname)).toContain('track_points_flight_id_sequence_number_unique');
  });

  it('stores IGC ownership and retrieval metadata', async () => {
    const result = await database.pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'igc_files'
       ORDER BY column_name`,
    );
    expect(result.rows).toEqual([
      { column_name: 'bucket_key', is_nullable: 'NO' },
      { column_name: 'byte_size', is_nullable: 'NO' },
      { column_name: 'content_type', is_nullable: 'NO' },
      { column_name: 'created_at', is_nullable: 'NO' },
      { column_name: 'igc_file_id', is_nullable: 'NO' },
      { column_name: 'original_filename', is_nullable: 'NO' },
      { column_name: 'updated_at', is_nullable: 'NO' },
      { column_name: 'user_id', is_nullable: 'NO' },
    ]);
  });

  it('requires normalized account and credential fields', async () => {
    const result = await database.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'users' AND column_name = 'email')
           OR (table_name = 'user_passwords' AND column_name = 'password_hash')
           OR (table_name = 'app_sessions' AND column_name = 'token_hash'))
         AND is_nullable = 'NO'
       ORDER BY table_name`,
    );
    expect(result.rows).toEqual([
      { table_name: 'app_sessions', column_name: 'token_hash' },
      { table_name: 'user_passwords', column_name: 'password_hash' },
      { table_name: 'users', column_name: 'email' },
    ]);
  });

  it('stores a required territory color with the pilot map default', async () => {
    const result = await database.pool.query<{
      column_default: string | null;
      is_nullable: string;
    }>(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'territory_color'`,
    );

    expect(result.rows).toEqual([
      { column_default: "'#1769AA'::text", is_nullable: 'NO' },
    ]);
  });
});
