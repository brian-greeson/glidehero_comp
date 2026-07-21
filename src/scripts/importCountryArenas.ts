import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from '../db/client.js';
import { parseCountryArenaGeoJson } from '../domain/arena/countryGeoJson.js';
import { importCountryArenas } from '../services/countryArenaImportService.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const sourcePath = resolve(process.argv[2] ?? 'ingest/countries.geojson');
  const parsed: unknown = JSON.parse(await readFile(sourcePath, 'utf8'));
  const countries = parseCountryArenaGeoJson(parsed);
  const database = createDatabase(databaseUrl);
  try {
    const summary = await importCountryArenas(database.db, countries);
    console.log(`Imported ${summary.imported} Country Arenas from ${sourcePath}.`);
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
