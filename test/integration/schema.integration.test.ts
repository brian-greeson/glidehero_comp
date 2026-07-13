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
      'flight_areas',
      'flights',
      'igc_files',
      'personal_territories',
      'profiles',
      'track_points',
      'user_passwords',
      'users',
    ]);

    const columns = await database.pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'flights' ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'created_at', is_nullable: 'NO' },
      { column_name: 'distance_meters', is_nullable: 'YES' },
      { column_name: 'duration_seconds', is_nullable: 'YES' },
      { column_name: 'ended_at', is_nullable: 'YES' },
      { column_name: 'flight_id', is_nullable: 'NO' },
      { column_name: 'igc_file_id', is_nullable: 'NO' },
      { column_name: 'launch_latitude', is_nullable: 'YES' },
      { column_name: 'launch_longitude', is_nullable: 'YES' },
      { column_name: 'processing_error', is_nullable: 'YES' },
      { column_name: 'processing_status', is_nullable: 'NO' },
      { column_name: 'started_at', is_nullable: 'YES' },
      { column_name: 'updated_at', is_nullable: 'NO' },
      { column_name: 'user_id', is_nullable: 'NO' },
    ]);
  });

  it('stores one cascading JSONB personal-territory projection per pilot', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>(
      `SELECT column_name, data_type, is_nullable, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'personal_territories'
       ORDER BY column_name`,
    );
    const foreignKeys = await database.pool.query<{ confdeltype: string }>(
      `SELECT confdeltype
       FROM pg_constraint
       WHERE conrelid = 'personal_territories'::regclass AND contype = 'f'`,
    );

    expect(columns.rows).toEqual([
      { column_name: 'geojson', data_type: 'jsonb', is_nullable: 'NO', udt_name: 'jsonb' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', udt_name: 'timestamptz' },
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
    ]);
    expect(foreignKeys.rows).toEqual([{ confdeltype: 'c' }]);
  });

  it('stores flight claims as indexed WGS84 polygons', async () => {
    const columns = await database.pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      udt_name: string;
    }>(
      `SELECT column_name, data_type, is_nullable, udt_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'flight_areas'
       ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'area_square_meters', data_type: 'double precision', is_nullable: 'NO', udt_name: 'float8' },
      { column_name: 'flight_area_id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'flight_id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
      { column_name: 'geometry', data_type: 'USER-DEFINED', is_nullable: 'NO', udt_name: 'geometry' },
    ]);

    const geometry = await database.pool.query<{
      srid: number;
      type: string;
    }>(
      `SELECT srid, type
       FROM geometry_columns
       WHERE f_table_schema = 'public'
         AND f_table_name = 'flight_areas'
         AND f_geometry_column = 'geometry'`,
    );
    expect(geometry.rows).toEqual([{ srid: 4326, type: 'POLYGON' }]);

    const indexes = await database.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'flight_areas'
       ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'flight_areas_flight_id_idx',
      'flight_areas_geometry_gist_idx',
      'flight_areas_pkey',
    ]);
  });

  it('enforces a unique source file and ordered point sequence per flight', async () => {
    const constraints = await database.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid IN ('flights'::regclass, 'track_points'::regclass)
       ORDER BY conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toContain('flights_igc_file_id_unique');
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
