import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDatabase } from '../../src/db/client.js';

export function testDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for integration tests.');
  return createDatabase(connectionString);
}

export async function resetAndPushTestDatabase(): Promise<ReturnType<typeof testDatabase>> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for integration tests.');

  const resetPool = new pg.Pool({ connectionString });
  try {
    await resetPool.query('DROP EXTENSION IF EXISTS postgis CASCADE');
    await resetPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await resetPool.query('CREATE SCHEMA public');
    await resetPool.query('CREATE EXTENSION postgis');
  } finally {
    await resetPool.end();
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      'npm',
      ['run', 'db:push', '--', '--force'],
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
          GRID_CLAIM_CELL_SIZE: '1000',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `db:push failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
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
