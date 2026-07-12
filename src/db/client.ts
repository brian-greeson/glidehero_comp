import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';
import { relations } from './relations.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.db.url,
});
export const db = drizzle({
  client: pool,
  relations,
});
