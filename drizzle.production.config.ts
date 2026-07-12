import { defineConfig } from "drizzle-kit";
import { config } from './src/config.js'
export default defineConfig({
  dialect: "postgresql",
  out: "./migrations",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: config.db.adminUrl ?? "",
    ssl: {
      rejectUnauthorized: false,
      ca: config.db.ca,
    },
  },
  // extensionsFilters: ["postgis"],
  schemaFilter: ["public"],
});
