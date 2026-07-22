import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createArenaProgressService } from '../../src/services/arenaProgressService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function user(email: string) {
  const result = await database.pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING user_id AS id', [email]);
  return result.rows[0]!.id;
}

async function flight(userId: string, launchProjected?: [number, number]) {
  const id = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  await database.pool.query(
    `INSERT INTO igc_files (igc_file_id, user_id, original_filename, content_type, byte_size, bucket_key)
     VALUES ($1, $2, 'test.igc', 'application/octet-stream', 1, $3)`,
    [fileId, userId, `test/${fileId}`],
  );
  let launch: [number, number] | undefined;
  if (launchProjected) {
    const projected = await database.pool.query<{ longitude: number; latitude: number }>(
      `SELECT ST_X(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 6933), 4326)) AS longitude,
              ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 6933), 4326)) AS latitude`,
      launchProjected,
    );
    launch = [projected.rows[0]!.latitude, projected.rows[0]!.longitude];
  }
  await database.pool.query(
    `INSERT INTO flights (flight_id, user_id, igc_file_id, content_hash, processing_status, launch_latitude, launch_longitude)
     VALUES ($1, $2, $3, $4, 'completed', $5, $6)`,
    [id, userId, fileId, id.replaceAll('-', '').padEnd(64, '0'), launch?.[0] ?? null, launch?.[1] ?? null],
  );
  return id;
}

async function arena(type: string, sourceId: number, options: { total?: number | null; size?: number; minX?: number; minY?: number; width?: number; height?: number } = {}) {
  const size = options.size ?? 1_000;
  const minX = options.minX ?? 0;
  const minY = options.minY ?? 0;
  const maxX = minX + (options.width ?? 2) * size;
  const maxY = minY + (options.height ?? 2) * size;
  const externalId = type === 'state' || type === 'country' ? String(sourceId) : null;
  const result = await database.pool.query<{ id: string }>(
    `INSERT INTO arenas (source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
     VALUES ($1, $2, 'Testland', 'TT', ST_Multi(ST_GeomFromText($3, 6933)), $4, $5, $6)
     RETURNING id`,
    [sourceId, `${type}-${sourceId}`, `POLYGON((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`, type, externalId, type === 'state' || type === 'country' ? null : options.total === undefined ? 4 : options.total],
  );
  return result.rows[0]!.id;
}

async function claim(userId: string, flightId: string, cells: Array<[number, number]>, claimTimestamp = new Date()) {
  for (const [x, y] of cells) {
    await database.pool.query(
      `INSERT INTO user_grid_claims (x, y, claim_flight, claim_user, claim_timestamp)
       VALUES ($1, $2, $3, $4, $5)`, [x, y, flightId, userId, claimTimestamp],
    );
  }
}

describe('ArenaProgressService with PostGIS', () => {
  it('counts distinct covered cells, includes boundary centers, and reports launch/general progress', async () => {
    const service = createArenaProgressService(database.db, { cellSize: 1_000 });
    const pilot = await user('progress@example.com');
    const firstFlight = await flight(pilot, [500, 500]);
    const secondFlight = await flight(pilot);
    const launchId = await arena('launch', 1, { total: 2, minX: 500, minY: 0 });
    const firstClaimTimestamp = new Date('2026-01-01T00:00:00.000Z');
    const secondClaimTimestamp = new Date('2026-02-01T00:00:00.000Z');
    await claim(pilot, firstFlight, [[0, 0], [1, 1]], firstClaimTimestamp);
    await claim(pilot, secondFlight, [[0, 0], [8, 8]], secondClaimTimestamp);
    await expect(service.get({ arenaId: launchId, userId: pilot })).resolves.toEqual({
      kind: 'launch', firstProgressDate: firstClaimTimestamp, mostRecentProgressDate: secondClaimTimestamp,
      visited: true, claimedCells: 2, totalCells: 2, complete: true,
    });

    const generalId = await arena('general', 2, { total: 4 });
    await expect(service.get({ arenaId: generalId, userId: pilot })).resolves.toEqual({
      kind: 'general', firstProgressDate: firstClaimTimestamp, mostRecentProgressDate: secondClaimTimestamp,
      claimedCells: 2, totalCells: 4, coveragePercentage: 50, nextMilestone: 75,
    });
    const belowTenId = await arena('general', 7, { total: 20, minX: 500, width: 1, height: 1 });
    await expect(service.get({ arenaId: belowTenId, userId: pilot })).resolves.toMatchObject({ coveragePercentage: 5, nextMilestone: 10 });
    const exactTenId = await arena('general', 8, { total: 10, minX: 500, width: 1, height: 1 });
    await expect(service.get({ arenaId: exactTenId, userId: pilot })).resolves.toMatchObject({ coveragePercentage: 10, nextMilestone: 25 });
    const repeatingId = await arena('general', 10, { total: 3, minX: 0, width: 1, height: 1 });
    await expect(service.get({ arenaId: repeatingId, userId: pilot })).resolves.toMatchObject({ coveragePercentage: 33.3, nextMilestone: 50 });
    const completeId = await arena('general', 9, { total: 2 });
    await expect(service.get({ arenaId: completeId, userId: pilot })).resolves.toMatchObject({ coveragePercentage: 100, nextMilestone: null });
  });

  it('returns boolean-only state and country progress and excludes a launch visit outside the area', async () => {
    const service = createArenaProgressService(database.db, { cellSize: 1_000 });
    const pilot = await user('boolean@example.com');
    const outsideFlight = await flight(pilot, [3_000, 3_000]);
    await claim(pilot, outsideFlight, [[0, 0]]);
    const stateId = await arena('state', 3);
    const countryId = await arena('country', 4);
    await expect(service.get({ arenaId: stateId, userId: pilot })).resolves.toMatchObject({ kind: 'state', firstProgressDate: expect.any(Date), mostRecentProgressDate: expect.any(Date), flownIn: true });
    await expect(service.get({ arenaId: countryId, userId: pilot })).resolves.toMatchObject({ kind: 'country', firstProgressDate: expect.any(Date), mostRecentProgressDate: expect.any(Date), flownIn: true });
    const emptyPilot = await user('empty@example.com');
    await expect(service.get({ arenaId: stateId, userId: emptyPilot })).resolves.toEqual({ kind: 'state', firstProgressDate: null, mostRecentProgressDate: null, flownIn: false });
    await expect(service.get({ arenaId: countryId, userId: emptyPilot })).resolves.toEqual({ kind: 'country', firstProgressDate: null, mostRecentProgressDate: null, flownIn: false });
    const emptyGeneralId = await arena('general', 11, { total: 4 });
    await expect(service.get({ arenaId: emptyGeneralId, userId: emptyPilot })).resolves.toMatchObject({
      kind: 'general', firstProgressDate: null, mostRecentProgressDate: null, claimedCells: 0,
    });
    const launchId = await arena('launch', 5, { total: 4 });
    await expect(service.get({ arenaId: launchId, userId: pilot })).resolves.toMatchObject({ kind: 'launch', visited: false, firstProgressDate: expect.any(Date), mostRecentProgressDate: expect.any(Date) });
  });

  it('rejects missing or invalid stored denominator metadata', async () => {
    const service = createArenaProgressService(database.db, { cellSize: 1_000 });
    const pilot = await user('invalid@example.com');
    const id = await arena('general', 6, { total: null });
    await expect(service.get({ arenaId: id, userId: pilot })).rejects.toThrow('invalid claimable grid metadata');
  });
});
