import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDatabase } from '../../src/db/client.js';

export function testDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  validateDisposableTestDatabase(connectionString);
  return createDatabase(connectionString);
}

export function validateDisposableTestDatabase(connectionString: string): string {
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  } catch (error) {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.', { cause: error });
  }
  if (!databaseName || !/(^|[-_])test($|[-_])/i.test(databaseName)) {
    throw new Error(`Refusing destructive test reset for non-test database "${databaseName || '<unnamed>'}".`);
  }
  return databaseName;
}

export async function resetAndMigrateTestDatabase(): Promise<ReturnType<typeof testDatabase>> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  const expectedDatabaseName = validateDisposableTestDatabase(connectionString);

  const resetPool = new pg.Pool({ connectionString });
  try {
    const identity = await resetPool.query<{ databaseName: string }>('SELECT current_database() AS "databaseName"');
    if (identity.rows[0]?.databaseName !== expectedDatabaseName) {
      throw new Error(`Refusing destructive test reset: connected to "${identity.rows[0]?.databaseName ?? '<unknown>'}" instead of "${expectedDatabaseName}".`);
    }
    await resetPool.query('DROP EXTENSION IF EXISTS postgis CASCADE');
    await resetPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await resetPool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await resetPool.query('CREATE SCHEMA public');
    await resetPool.query('CREATE EXTENSION postgis');
  } finally {
    await resetPool.end();
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      'npm',
      ['run', 'db:migrate'],
      {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: {
          ...process.env,
          DATABASE_URL: connectionString,
          VALKEY_URL: 'redis://localhost:6379',
          BUCKET_SECRET: 'test-secret',
          BUCKET_ID: 'test-id',
          BUCKET_NAME: 'glidehero-test-files',
          BUCKET_URL: 'https://s3.example.test',
          BUCKET_FOLDER: 'glidehero-test',
          MAPTILER_API_KEY: 'maptiler-test-key',
          KOFI_VERIFICATION_TOKEN: 'kofi-test-token',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `db:migrate failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve();
      },
    );
  });

  return createDatabase(connectionString);
}
