import { defineConfig } from 'drizzle-kit';
import { parseConfig } from './src/config.js';

const config = parseConfig(process.env);

export default defineConfig({
  out: './drizzle',
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  dbCredentials: { url: config.databaseUrl },
  extensionsFilters: ['postgis'],
  schemaFilter: ['public'],
});
