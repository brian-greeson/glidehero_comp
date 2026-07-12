// index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from '../config.js';
import { Pool } from 'pg';
import { relations } from '../db/relations.js';

export async function migrateDB() {
  const pool = new Pool({
    connectionString: config.db.adminUrl,
  });
  const db = drizzle({
    client: pool,
    relations,
  });
  const result = await migrate(db, { migrationsFolder: 'migrations' });
  console.log('migrate: ', result);
}
