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
    await resetPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await resetPool.query('CREATE SCHEMA public');
  } finally {
    await resetPool.end();
  }

  await new Promise<void>((resolve, reject) => {
    execFile(
      'npm',
      ['run', 'db:push', '--', '--force'],
      {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        env: { ...process.env, DATABASE_URL: connectionString },
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
