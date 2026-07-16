import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export type LaunchAreaGenerationResult = {
  launchAreaCount: number;
  cellCount: number;
};

export async function generateLaunchAreas(
  database: Database,
  input: { gridCount: number; cellSize: number },
): Promise<LaunchAreaGenerationResult> {
  const { gridCount, cellSize } = input;
  const radius = Math.floor(gridCount / 2);

  return database.transaction(async (transaction) => {
    await transaction.execute(sql`DELETE FROM launch_area_cells`);

    await transaction.execute(sql`
      WITH projected_launches AS (
        SELECT
          id AS launch_area_id,
          floor(ST_X(ST_Transform(location, 6933)) / ${cellSize})::integer AS center_x,
          floor(ST_Y(ST_Transform(location, 6933)) / ${cellSize})::integer AS center_y
        FROM launch_areas
      )
      INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y)
      SELECT
        launch.launch_area_id,
        ${cellSize},
        launch.center_x + x_offset,
        launch.center_y + y_offset
      FROM projected_launches launch
      CROSS JOIN generate_series(${-radius}::integer, ${radius}::integer) AS x_offset
      CROSS JOIN generate_series(${-radius}::integer, ${radius}::integer) AS y_offset
    `);

    await transaction.execute(sql`
      WITH generated_areas AS (
        SELECT
          launch_area_id,
          ST_Multi(
            ST_UnaryUnion(
              ST_Collect(
                ST_MakeEnvelope(
                  x * cell_size,
                  y * cell_size,
                  (x + 1) * cell_size,
                  (y + 1) * cell_size,
                  6933
                )
              )
            )
          )::geometry(multipolygon, 6933) AS area
        FROM launch_area_cells
        GROUP BY launch_area_id
      )
      UPDATE launch_areas launch
      SET area = generated.area
      FROM generated_areas generated
      WHERE launch.id = generated.launch_area_id
    `);

    const counts = await transaction.execute<{
      launch_area_count: number;
      cell_count: number;
    }>(sql`
      SELECT
        COUNT(DISTINCT launch_area_id)::integer AS launch_area_count,
        COUNT(*)::integer AS cell_count
      FROM launch_area_cells
    `);
    const count = counts.rows[0];

    return {
      launchAreaCount: count?.launch_area_count ?? 0,
      cellCount: count?.cell_count ?? 0,
    };
  });
}
