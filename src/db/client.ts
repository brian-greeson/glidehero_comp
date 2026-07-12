import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { relations } from './relations.js';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle({ client: pool, relations });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>['db'];
