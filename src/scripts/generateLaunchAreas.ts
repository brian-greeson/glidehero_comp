import { createDatabase } from '../db/client.js';
import { parseLaunchAreaCellSize, parseLaunchAreaGridCount } from '../domain/launch/launchAreaGrid.js';
import { generateLaunchAreas } from '../services/launchAreaGenerator.js';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const gridCount = parseLaunchAreaGridCount(process.argv[2]);
  const cellSize = parseLaunchAreaCellSize(process.env.GRID_CLAIM_CELL_SIZE);
  const { db, pool } = createDatabase(databaseUrl);

  try {
    const result = await generateLaunchAreas(db, { gridCount, cellSize });
    console.log(
      `Generated ${result.launchAreaCount} launch areas with ${result.cellCount} total cells `
      + `(${gridCount}x${gridCount} at ${cellSize} meters).`,
    );
  } finally {
    await pool.end();
  }
}

await main();
