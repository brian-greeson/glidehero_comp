import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../db/client.js';
import { importStateArenas, parseStateArenaGeoJson } from '../services/stateArenaImportService.js';

function cellSizeFromEnvironment(): number {
  const value = Number(process.env.GRID_CLAIM_CELL_SIZE);
  if (!Number.isInteger(value) || value <= 0) throw new Error('GRID_CLAIM_CELL_SIZE must be a positive integer.');
  return value;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2] ?? 'ingest/states.geojson';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const parsed: unknown = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
  const states = parseStateArenaGeoJson(parsed);
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    const summary = await importStateArenas(database.db, states, cellSizeFromEnvironment());
    console.log(`Imported ${summary.imported} State Arenas.`);
  } finally {
    await database.pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
