import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from '../db/client.js';
import { parseCountryArenaGeoJson } from '../domain/arena/countryGeoJson.js';
import { importCountryArenas } from '../services/countryArenaImportService.js';

function cellSizeFromEnvironment(): number {
  const value = Number(process.env.GRID_CLAIM_CELL_SIZE);
  if (!Number.isInteger(value) || value <= 0) throw new Error('GRID_CLAIM_CELL_SIZE must be a positive integer.');
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const sourcePath = resolve(process.argv[2] ?? 'ingest/countries.geojson');
  const parsed: unknown = JSON.parse(await readFile(sourcePath, 'utf8'));
  const countries = parseCountryArenaGeoJson(parsed);
  const database = createDatabase(databaseUrl);
  try {
    const summary = await importCountryArenas(database.db, countries, cellSizeFromEnvironment());
    console.log(`Imported ${summary.imported} Country Arenas from ${sourcePath}.`);
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
