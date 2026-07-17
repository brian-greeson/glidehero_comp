import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { competitionGridClaims, flights, igcFiles, profiles, users } from '../../src/db/schema.js';
import { createMonthlyCoverageService } from '../../src/services/monthlyCoverageService.js';
import { resetAndPushTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => { database = await resetAndPushTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users, launch_areas CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createPilot(displayName: string) {
  const [user] = await database.db.insert(users).values({ email: `${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  if (!user) throw new Error('Expected a user.');
  await database.db.insert(profiles).values({ userId: user.id, displayName });
  return { userId: user.id, displayName };
}

async function addClaim(pilot: { userId: string }, input: {
  month: string;
  x: number;
  y: number;
  at: string;
  cellSize?: number;
}) {
  const [file] = await database.db.insert(igcFiles).values({
    userId: pilot.userId,
    originalFilename: 'coverage.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flights/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!file) throw new Error('Expected an IGC file.');
  const [flight] = await database.db.insert(flights).values({
    userId: pilot.userId,
    igcFileId: file.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone: 'UTC',
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Expected a flight.');
  await database.db.insert(competitionGridClaims).values({
    competitionMonth: input.month,
    cellSize: input.cellSize ?? 1_000,
    x: input.x,
    y: input.y,
    claimFlight: flight.id,
    claimUser: pilot.userId,
    claimTimestamp: new Date(input.at),
  });
}

const world = { west: -180, south: -89, east: 180, north: 89 };

describe('MonthlyCoverageService with PostGIS', () => {
  it('keeps additive pilot credit, deduplicates repeat flights, and partitions exclusive and shared cells', async () => {
    const alpha = await createPilot('Alpha');
    const bravo = await createPilot('Bravo');
    await addClaim(alpha, { month: '2026-07-01', x: 0, y: 0, at: '2026-07-01T10:00:00Z' });
    await addClaim(alpha, { month: '2026-07-01', x: 0, y: 0, at: '2026-07-02T10:00:00Z' });
    await addClaim(alpha, { month: '2026-07-01', x: 1, y: 0, at: '2026-07-02T11:00:00Z' });
    await addClaim(bravo, { month: '2026-07-01', x: 0, y: 0, at: '2026-07-03T10:00:00Z' });
    await addClaim(bravo, { month: '2026-08-01', x: 1, y: 0, at: '2026-08-03T10:00:00Z' });

    const service = createMonthlyCoverageService(database.db, { cellSize: 1_000 });
    const july = await service.getGlobalLeaderboard({
      competitionMonth: '2026-07', ...world, currentUserId: alpha.userId,
    });
    expect(july.leaders).toEqual([
      expect.objectContaining({
        userId: alpha.userId, claimedCellCount: 2, exclusiveCellCount: 1, sharedCellCount: 1, rank: 1,
      }),
      expect.objectContaining({
        userId: bravo.userId, claimedCellCount: 1, exclusiveCellCount: 0, sharedCellCount: 1, rank: 2,
      }),
    ]);

    const allTime = await service.getGlobalLeaderboard({ period: 'all-time', ...world, currentUserId: alpha.userId });
    expect(allTime.leaders).toEqual([
      expect.objectContaining({ userId: alpha.userId, claimedCellCount: 2, exclusiveCellCount: 0, sharedCellCount: 2 }),
      expect.objectContaining({ userId: bravo.userId, claimedCellCount: 2, exclusiveCellCount: 0, sharedCellCount: 2 }),
    ]);

    const selected = await service.getGlobalTerritory({ competitionMonth: '2026-07', pilotUserId: alpha.userId });
    expect(selected.features).toHaveLength(2);
    expect(selected.features.find((feature) => feature.properties.x === 0)?.properties).toMatchObject({
      claimantCount: 2, isShared: true, pilotUserId: alpha.userId,
    });
    const overview = await service.getGlobalTerritory({ competitionMonth: '2026-07' });
    expect(overview.features).toHaveLength(2);
    expect(overview.features.find((feature) => feature.properties.x === 0)?.properties.pilotUserId).toBeUndefined();
    expect(overview.features.find((feature) => feature.properties.x === 1)?.properties.pilotUserId).toBe(alpha.userId);
    await expect(service.getCellClaimants({ competitionMonth: '2026-07', x: 0, y: 0 }))
      .resolves.toEqual([{ userId: alpha.userId, displayName: 'Alpha' }, { userId: bravo.userId, displayName: 'Bravo' }]);
  });

  it('restricts Arena territory and scoring to exact generated cells', async () => {
    const pilot = await createPilot('Arena Pilot');
    await addClaim(pilot, { month: '2026-07-01', x: 0, y: 0, at: '2026-07-01T10:00:00Z' });
    await addClaim(pilot, { month: '2026-07-01', x: 1, y: 0, at: '2026-07-01T11:00:00Z' });
    const arena = await database.pool.query<{ id: string }>(`
      INSERT INTO launch_areas (
        source_id, name, country, state, city, location, altitude_meters, timezone, area
      ) VALUES (
        745, 'Coverage Arena', 'United States', 'Colorado', 'Boulder',
        ST_Transform(ST_SetSRID(ST_Point(500, 500), 6933), 4326), 1000, 'America/Denver',
        ST_Multi(ST_MakeEnvelope(0, 0, 1000, 1000, 6933))
      ) RETURNING id
    `);
    const arenaId = arena.rows[0]?.id;
    if (!arenaId) throw new Error('Expected an Arena.');
    await database.pool.query('INSERT INTO launch_area_cells (launch_area_id, cell_size, x, y) VALUES ($1, 1000, 0, 0)', [arenaId]);

    const service = createMonthlyCoverageService(database.db, { cellSize: 1_000 });
    const leaderboard = await service.getArenaLeaderboard({
      competitionMonth: '2026-07', launchAreaId: arenaId, currentUserId: pilot.userId,
    });
    expect(leaderboard.leaders).toEqual([
      expect.objectContaining({ userId: pilot.userId, claimedCellCount: 1, exclusiveCellCount: 1 }),
    ]);
    const territory = await service.getArenaTerritory({ competitionMonth: '2026-07', launchAreaId: arenaId });
    expect(territory.features.map((feature) => feature.properties.x)).toEqual([0]);
  });

  it('shares ranks, orders ties alphabetically, caps leaders at ten, and reports signed-in pilots outside the leaders', async () => {
    const pilots = [];
    for (let index = 0; index < 11; index += 1) {
      const pilot = await createPilot(`Pilot ${String(index).padStart(2, '0')}`);
      pilots.push(pilot);
      await addClaim(pilot, {
        month: '2026-07-01',
        x: index,
        y: 0,
        at: '2026-07-10T12:00:00Z',
      });
    }
    const zeroClaimPilot = await createPilot('Zero Claim Pilot');
    const service = createMonthlyCoverageService(database.db, { cellSize: 1_000 });

    const excludedClaimant = await service.getGlobalLeaderboard({
      competitionMonth: '2026-07',
      ...world,
      currentUserId: pilots[10]!.userId,
    });

    expect(excludedClaimant.leaders).toHaveLength(10);
    expect(excludedClaimant.leaders.map((pilot) => pilot.displayName)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Pilot ${String(index).padStart(2, '0')}`),
    );
    expect(excludedClaimant.leaders.every((pilot) => pilot.rank === 1)).toBe(true);
    expect(excludedClaimant.currentPilot).toMatchObject({
      userId: pilots[10]!.userId,
      displayName: 'Pilot 10',
      claimedCellCount: 1,
      exclusiveCellCount: 1,
      sharedCellCount: 0,
      rank: 1,
    });

    const absentPilot = await service.getGlobalLeaderboard({
      competitionMonth: '2026-07',
      ...world,
      currentUserId: zeroClaimPilot.userId,
    });
    expect(absentPilot.currentPilot).toEqual({
      userId: zeroClaimPilot.userId,
      displayName: 'Zero Claim Pilot',
      claimedCellCount: 0,
      exclusiveCellCount: 0,
      sharedCellCount: 0,
      claimedAreaSquareMeters: 0,
      rank: null,
    });
  });

  it('includes cells across an international-date-line-crossing viewport', async () => {
    const indexes = await database.pool.query<{ x: number; y: number }>(`
      SELECT
        floor(ST_X(ST_Transform(ST_SetSRID(ST_Point(179.95, 0), 4326), 6933)) / 1000)::integer AS x,
        floor(ST_Y(ST_Transform(ST_SetSRID(ST_Point(179.95, 0), 4326), 6933)) / 1000)::integer AS y
    `);
    const cell = indexes.rows[0];
    if (!cell) throw new Error('Expected projected grid coordinates.');
    const pilot = await createPilot('Date Line Pilot');
    await addClaim(pilot, {
      month: '2026-07-01',
      x: cell.x,
      y: cell.y,
      at: '2026-07-10T12:00:00Z',
    });

    const result = await createMonthlyCoverageService(database.db, { cellSize: 1_000 })
      .getGlobalLeaderboard({
        competitionMonth: '2026-07',
        west: 179.9,
        south: -0.1,
        east: -179.9,
        north: 0.1,
        currentUserId: pilot.userId,
      });

    expect(result.leaders).toMatchObject([{ userId: pilot.userId, claimedCellCount: 1 }]);
    expect(result.currentPilot).toBeNull();
  });

  it('isolates configured cell sizes and returns deterministic polygons or an empty collection', async () => {
    const pilot = await createPilot('Geometry Pilot');
    await addClaim(pilot, { month: '2026-07-01', x: 1, y: 0, at: '2026-07-10T12:00:00Z' });
    await addClaim(pilot, { month: '2026-07-01', x: 0, y: 0, at: '2026-07-10T13:00:00Z' });
    await addClaim(pilot, {
      month: '2026-07-01',
      x: 2,
      y: 0,
      at: '2026-07-10T14:00:00Z',
      cellSize: 2_000,
    });
    const service = createMonthlyCoverageService(database.db, { cellSize: 1_000 });

    const july = await service.getGlobalTerritory({ competitionMonth: '2026-07' });
    const august = await service.getGlobalTerritory({ competitionMonth: '2026-08' });

    expect(july.features).toHaveLength(2);
    expect(july.features.map((feature) => feature.properties.cellId)).toEqual([
      '1000:0:0',
      '1000:1:0',
    ]);
    expect(july.features.every((feature) => feature.geometry.type === 'Polygon')).toBe(true);
    expect(july.features.flatMap((feature) => feature.geometry.coordinates).flat(2)
      .every((coordinate) => Math.abs(coordinate) <= 180)).toBe(true);
    expect(august).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
