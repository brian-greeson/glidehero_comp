import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateLaunchAreas } from '../../src/services/launchAreaGenerator.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE launch_areas CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

async function insertLaunchArea(sourceId: number, projectedX: number, projectedY: number) {
  await database.pool.query(
    `INSERT INTO launch_areas (
       source_id, name, country, state, city, location, altitude_meters, timezone
     ) VALUES (
       $1, $2, 'United States', 'Test State', 'Test City',
       ST_Transform(ST_SetSRID(ST_MakePoint($3, $4), 6933), 4326),
       1000, 'America/Denver'
     )`,
    [sourceId, `Launch ${sourceId}`, projectedX, projectedY],
  );
}

describe('launch-area generator', () => {
  it('creates an independent centered grid for every launch area', async () => {
    await insertLaunchArea(1, 1_250, 2_250);
    await insertLaunchArea(2, 1_260, 2_260);

    const result = await generateLaunchAreas(database.db, { gridCount: 5, cellSize: 500 });

    expect(result).toEqual({ launchAreaCount: 2, cellCount: 50 });

    const generated = await database.pool.query<{
      source_id: string;
      cell_count: number;
      min_x: number;
      max_x: number;
      min_y: number;
      max_y: number;
      area_square_meters: number;
    }>(
      `SELECT
         area.source_id,
         COUNT(*)::integer AS cell_count,
         MIN(cell.x)::integer AS min_x,
         MAX(cell.x)::integer AS max_x,
         MIN(cell.y)::integer AS min_y,
         MAX(cell.y)::integer AS max_y,
         ST_Area(area.area) AS area_square_meters
       FROM launch_areas area
       INNER JOIN launch_area_cells cell ON cell.launch_area_id = area.id
       GROUP BY area.id
       ORDER BY area.source_id`,
    );

    expect(generated.rows).toEqual([
      {
        source_id: '1',
        cell_count: 25,
        min_x: 0,
        max_x: 4,
        min_y: 2,
        max_y: 6,
        area_square_meters: 6_250_000,
      },
      {
        source_id: '2',
        cell_count: 25,
        min_x: 0,
        max_x: 4,
        min_y: 2,
        max_y: 6,
        area_square_meters: 6_250_000,
      },
    ]);
  });

  it('replaces old cells and geometry when rerun with new settings', async () => {
    await insertLaunchArea(1, 1_250, 2_250);
    await generateLaunchAreas(database.db, { gridCount: 5, cellSize: 500 });

    const result = await generateLaunchAreas(database.db, { gridCount: 3, cellSize: 1_000 });
    const generated = await database.pool.query<{
      cell_count: number;
      cell_sizes: number[];
      area_square_meters: number;
    }>(
      `SELECT
         COUNT(*)::integer AS cell_count,
         array_agg(DISTINCT cell.cell_size ORDER BY cell.cell_size) AS cell_sizes,
         ST_Area(area.area) AS area_square_meters
       FROM launch_areas area
       INNER JOIN launch_area_cells cell ON cell.launch_area_id = area.id
       GROUP BY area.id`,
    );

    expect(result).toEqual({ launchAreaCount: 1, cellCount: 9 });
    expect(generated.rows).toEqual([{
      cell_count: 9,
      cell_sizes: [1_000],
      area_square_meters: 9_000_000,
    }]);
  });
});
