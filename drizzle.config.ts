import { defineConfig } from 'drizzle-kit';
import { parseConfig } from './src/config.js';

const config = parseConfig(process.env);

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  schema: './src/db/schema.ts',
  dbCredentials: { url: config.databaseUrl },
  schemaFilter: ['public'],
});
