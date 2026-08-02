import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema.js';
import { createThermalCrawlService } from '../../src/services/thermalCrawlService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

const target: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[
    [-105.1, 39], [-105, 39], [-105, 39.1], [-105.1, 39.1], [-105.1, 39],
  ]],
};

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE thermal_crawl_jobs, users CASCADE'); });
afterAll(async () => { await database.pool.end(); });

describe('thermal crawl service', () => {
  it('creates intersecting zoom-12 tiles through the real prepared query', async () => {
    const [user] = await database.db.insert(users).values({ email: 'thermal-crawl@example.com' }).returning({ id: users.id });
    const service = createThermalCrawlService(database.db);

    const jobId = await service.create({ name: 'Front Range', geometry: target, userId: user!.id });
    const result = await database.pool.query<{
      status: string;
      srid: number;
      valid: boolean;
      tileCount: number;
      minimumZoom: number;
      maximumZoom: number;
      nonnegativeCoordinates: boolean;
    }>(`
      SELECT job.status, ST_SRID(job.target_geometry)::integer AS srid,
        ST_IsValid(job.target_geometry) AS valid,
        COUNT(tile.job_id)::integer AS "tileCount",
        MIN(tile.zoom)::integer AS "minimumZoom",
        MAX(tile.zoom)::integer AS "maximumZoom",
        BOOL_AND(tile.tile_x >= 0 AND tile.tms_y >= 0) AS "nonnegativeCoordinates"
      FROM thermal_crawl_jobs job
      JOIN thermal_crawl_job_tiles tile ON tile.job_id = job.id
      WHERE job.id = $1
      GROUP BY job.id
    `, [jobId]);

    expect(result.rows[0]).toMatchObject({
      status: 'running', srid: 4326, valid: true,
      minimumZoom: 12, maximumZoom: 12, nonnegativeCoordinates: true,
    });
    expect(result.rows[0]!.tileCount).toBeGreaterThan(0);
    expect(result.rows[0]!.tileCount).toBeLessThanOrEqual(9);
  });

  it('rolls back the job when a valid request produces no intersecting tiles', async () => {
    const [user] = await database.db.insert(users).values({ email: 'empty-thermal-crawl@example.com' }).returning({ id: users.id });
    const service = createThermalCrawlService(database.db);
    const emptyTarget: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[-105, 39], [-105, 39], [-105, 39], [-105, 39]]],
    };

    await expect(service.create({ name: 'Empty target', geometry: emptyTarget, userId: user!.id }))
      .rejects.toThrow('does not intersect any supported tiles');
    expect((await database.pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM thermal_crawl_jobs WHERE name = $1',
      ['Empty target'],
    )).rows[0]?.count).toBe(0);
  });
});
