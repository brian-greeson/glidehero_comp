import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase } from '../db/client.js';
import { importStateArenas, parseStateArenaGeoJson } from '../services/stateArenaImportService.js';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: npm run import:state-arenas -- path/to/states.geojson');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const parsed: unknown = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
const states = parseStateArenaGeoJson(parsed);
const database = createDatabase(process.env.DATABASE_URL);
try {
  const totals = await importStateArenas(database.db, states);
  console.log(`State Arenas: created ${totals.created}, updated ${totals.updated}, unchanged ${totals.unchanged}, rejected ${totals.rejected}.`);
} finally {
  await database.pool.end();
}
