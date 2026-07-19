import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
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
      'app_sessions',
      'arenas',
      'competition_grid_claims',
      'flights',
      'igc_files',
      'launches',
      'profiles',
      'track_points',
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
      { column_name: 'processing_error', is_nullable: 'YES' },
      { column_name: 'processing_status', is_nullable: 'NO' },
      { column_name: 'processing_token', is_nullable: 'YES' },
      { column_name: 'started_at', is_nullable: 'YES' },
      { column_name: 'updated_at', is_nullable: 'NO' },
      { column_name: 'user_id', is_nullable: 'NO' },
    ]);
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
    ]);
    expect(geometryColumns.rows).toEqual([
      { f_geometry_column: 'area', srid: 6933, type: 'MULTIPOLYGON' },
      { f_geometry_column: 'location', srid: 4326, type: 'POINT' },
    ]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'arenas_area_gist_idx',
      'arenas_external_source_external_id_unique',
      'arenas_pkey',
      'arenas_source_id_unique',
    ]);
    expect(indexes.rows.find(({ indexname }) => indexname === 'arenas_area_gist_idx')?.indexdef)
      .toContain('USING gist (area)');
    expect(indexes.rows.find(({ indexname }) => indexname === 'arenas_external_source_external_id_unique')?.indexdef)
      .toContain('WHERE ((external_source IS NOT NULL) AND (external_id IS NOT NULL))');
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
      { column_name: 'cell_size', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
      { column_name: 'claim_flight', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'claim_timestamp', data_type: 'timestamp with time zone', is_nullable: 'NO', udt_name: 'timestamptz' },
      { column_name: 'claim_user', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'x', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
      { column_name: 'y', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
    ]);
    expect(primaryKey.rows).toEqual([{ definition: 'PRIMARY KEY (claim_user, cell_size, x, y, claim_flight)' }]);
    expect(foreignKeys.rows).toEqual([{ confdeltype: 'c' }, { confdeltype: 'c' }]);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'user_grid_claims_claim_flight_idx',
      'user_grid_claims_claim_user_cell_size_idx',
      'user_grid_claims_pkey',
    ]);
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
      { column_name: 'cell_size', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
      { column_name: 'claim_flight', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'claim_timestamp', data_type: 'timestamp with time zone', is_nullable: 'NO', udt_name: 'timestamptz' },
      { column_name: 'claim_user', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'competition_month', data_type: 'date', is_nullable: 'NO', udt_name: 'date' },
      { column_name: 'x', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
      { column_name: 'y', data_type: 'integer', is_nullable: 'NO', udt_name: 'int4' },
    ]);
    expect(primaryKey.rows).toEqual([{
      definition: 'PRIMARY KEY (competition_month, cell_size, x, y, claim_flight)',
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
