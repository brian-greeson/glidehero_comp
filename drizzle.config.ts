import { defineConfig } from "drizzle-kit";
import { config } from './src/config.js'
export default defineConfig({
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: config.db.url,
  },
  // extensionsFilters: ["postgis"],
  schemaFilter: ["public"],
});
