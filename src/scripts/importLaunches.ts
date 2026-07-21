import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../db/client.js';
import { parseMysqlLaunchDump } from '../domain/launch/mysqlLaunchDump.js';
import { importLaunchArenas } from '../services/launchArenaImportService.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const rawCellSize = process.env.GRID_CLAIM_CELL_SIZE;
  if (!rawCellSize || !/^\d+$/.test(rawCellSize) || Number(rawCellSize) <= 0) {
    throw new Error('GRID_CLAIM_CELL_SIZE must be a positive integer.');
  }
  const sourcePath = resolve(process.argv[2] ?? 'ingest/launches.sql');
  const rows = parseMysqlLaunchDump(await readFile(sourcePath, 'utf8'));
  const { db, pool } = createDatabase(databaseUrl);
  try {
    const summary = await importLaunchArenas(db, rows, Number(rawCellSize));
    console.log(`Refreshed ${summary.refreshed} launches and imported ${summary.imported} Launch Arenas from ${sourcePath}.`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
