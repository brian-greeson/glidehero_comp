import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  competitionGridClaims,
  flights,
  igcFiles,
  personalGridClaims,
  pilotFollows,
  pilotGroupMemberships,
  pilotGroups,
  users,
} from '../../src/db/schema.js';
import { createTerritoryTileService } from '../../src/services/territoryTileService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;
const tile = { z: 7, x: 64, y: 63 };

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE users, arenas CASCADE'); });
afterAll(async () => { if (database) await database.pool.end(); });

async function createPilot(launchTimezone = 'UTC') {
  const [user] = await database.db.insert(users).values({
    email: `${crypto.randomUUID()}@example.com`,
  }).returning({ id: users.id });
  if (!user) throw new Error('Expected a user.');
  const [file] = await database.db.insert(igcFiles).values({
    userId: user.id,
    originalFilename: 'tile.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flights/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!file) throw new Error('Expected an IGC file.');
  const [flight] = await database.db.insert(flights).values({
    userId: user.id,
    igcFileId: file.id,
    contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Expected a flight.');
  return { userId: user.id, flightId: flight.id };
}

async function addPersonalClaims(
  pilot: Awaited<ReturnType<typeof createPilot>>,
  cells: Array<{ x: number; y: number; cellSize?: number; claimTimestamp?: Date }>,
) {
  await database.db.insert(personalGridClaims).values(cells.map((cell) => ({
    cellSize: cell.cellSize ?? 1_000,
    x: cell.x,
    y: cell.y,
    claimFlight: pilot.flightId,
    claimUser: pilot.userId,
    claimTimestamp: cell.claimTimestamp ?? new Date('2026-07-01T00:00:00Z'),
  })));
}

async function addCompetitionClaim(
  pilot: Awaited<ReturnType<typeof createPilot>>,
  input: { x: number; y: number; month?: string; cellSize?: number },
) {
  await database.db.insert(competitionGridClaims).values({
    competitionMonth: input.month ?? '2026-07-01',
    x: input.x,
    y: input.y,
    claimFlight: pilot.flightId,
    claimUser: pilot.userId,
    claimTimestamp: new Date('2026-07-01T00:00:00Z'),
  });
}

function decode(data: Buffer, layerName: string) {
  const vectorTile = new VectorTile(new PbfReader(data));
  const layer = vectorTile.layers[layerName];
  expect(layer).toBeDefined();
  return Array.from({ length: layer!.length }, (_, index) => layer!.feature(index));
}

describe('TerritoryTileService with PostGIS MVT', () => {
  it('returns an empty buffer for a valid empty tile', async () => {
    const pilot = await createPilot();
    await expect(createTerritoryTileService(database.db, { cellSize: 1_000 }).getPersonalTile({
      ...tile,
      userId: pilot.userId,
      period: { period: 'all-time' },
    })).resolves.toEqual({ data: Buffer.alloc(0), featureCount: 0 });
  });

  it('dissolves adjacent Personal cells, keeps disconnected regions, and isolates users and cell sizes', async () => {
    const pilot = await createPilot();
    const other = await createPilot();
    await addPersonalClaims(pilot, [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 },
    ]);
    await addPersonalClaims(other, [{ x: 2, y: 0 }]);

    const result = await createTerritoryTileService(database.db, { cellSize: 1_000 }).getPersonalTile({
      ...tile,
      userId: pilot.userId,
      period: { period: 'all-time' },
    });
    const features = decode(result.data, 'personal-territory');
    const exactCells = decode(result.data, 'personal-territory-cells');
    expect(result.featureCount).toBe(2);
    expect(features).toHaveLength(2);
    expect(exactCells.map((feature) => feature.properties)).toEqual(expect.arrayContaining([
      expect.objectContaining({ cellId: '1000:0:0', x: 0, y: 0 }),
      expect.objectContaining({ cellId: '1000:1:0', x: 1, y: 0 }),
      expect.objectContaining({ cellId: '1000:3:0', x: 3, y: 0 }),
    ]));
    for (const feature of features) {
      expect(feature.type).toBe(3);
      const rings = feature.loadGeometry().flat();
      expect(rings.every(({ x, y }) => x >= -64 && x <= 4160 && y >= -64 && y <= 4160)).toBe(true);
    }
  });

  it('filters Personal cells by the claim month in the flight launch timezone without Competition rows', async () => {
    const pilot = await createPilot('America/Denver');
    await addPersonalClaims(pilot, [{
      x: 0,
      y: 0,
      claimTimestamp: new Date('2026-07-01T05:30:00Z'),
    }]);
    const service = createTerritoryTileService(database.db, { cellSize: 1_000 });

    await expect(service.getPersonalTile({
      ...tile,
      userId: pilot.userId,
      period: { competitionMonth: '2026-06' },
    })).resolves.toMatchObject({ featureCount: 1 });
    await expect(service.getPersonalTile({
      ...tile,
      userId: pilot.userId,
      period: { competitionMonth: '2026-07' },
    })).resolves.toEqual({ data: Buffer.alloc(0), featureCount: 0 });
    await expect(service.getPersonalTile({
      ...tile,
      userId: pilot.userId,
      period: { period: 'all-time' },
    })).resolves.toMatchObject({ featureCount: 1 });

    const competitionCount = await database.db.select({ count: sql<number>`count(*)::integer` })
      .from(competitionGridClaims);
    expect(competitionCount).toEqual([{ count: 0 }]);
  });

  it('encodes exact Competition cells with monthly, shared, selected-pilot, and all-time properties', async () => {
    const alpha = await createPilot();
    const bravo = await createPilot();
    await addCompetitionClaim(alpha, { x: 0, y: 0 });
    await addCompetitionClaim(alpha, { x: 1, y: 0 });
    await addCompetitionClaim(bravo, { x: 0, y: 0 });
    await addCompetitionClaim(bravo, { x: 2, y: 0, month: '2026-08-01' });
    const service = createTerritoryTileService(database.db, { cellSize: 1_000 });

    const july = await service.getGlobalCompetitionTile({
      ...tile,
      period: { competitionMonth: '2026-07' },
    });
    const julyFeatures = decode(july.data, 'competition-coverage');
    expect(julyFeatures).toHaveLength(2);
    const properties = julyFeatures.map((feature) => feature.properties);
    expect(properties).toEqual(expect.arrayContaining([
      expect.objectContaining({ cellId: '1000:0:0', claimantCount: 2, isShared: true }),
      expect.objectContaining({ cellId: '1000:1:0', claimantCount: 1, isShared: false, pilotUserId: alpha.userId }),
    ]));
    expect(properties.find((value) => value.cellId === '1000:0:0')).not.toHaveProperty('pilotUserId');

    const selected = await service.getGlobalCompetitionTile({
      ...tile,
      period: { competitionMonth: '2026-07' },
      pilotUserId: alpha.userId,
    });
    expect(decode(selected.data, 'competition-coverage').map((feature) => feature.properties))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ cellId: '1000:0:0', claimantCount: 2, pilotUserId: alpha.userId }),
        expect.objectContaining({ cellId: '1000:1:0', pilotUserId: alpha.userId }),
      ]));

    const allTime = await service.getGlobalCompetitionTile({ ...tile, period: { period: 'all-time' } });
    expect(decode(allTime.data, 'competition-coverage')).toHaveLength(3);
  });

  it('filters Arena cells by covered centers without changing Global tile data', async () => {
    const pilot = await createPilot();
    await addCompetitionClaim(pilot, { x: 0, y: 0 });
    await addCompetitionClaim(pilot, { x: 1, y: 0 });
    await addCompetitionClaim(pilot, { x: 2, y: 0 });
    const arena = await database.pool.query<{ id: string }>(`
      INSERT INTO arenas (
        source_id, name, country, country_code, state, city, location, altitude_meters, timezone, area
      ) VALUES (
        745, 'Tile Arena', 'United States', 'US', 'Colorado', 'Boulder',
        ST_Transform(ST_SetSRID(ST_Point(500, 500), 6933), 4326), 1000, 'America/Denver',
        ST_Multi(ST_MakeEnvelope(0, 0, 1500, 1000, 6933))
      ) RETURNING id
    `);
    const arenaId = arena.rows[0]?.id;
    if (!arenaId) throw new Error('Expected an Arena.');
    const service = createTerritoryTileService(database.db, { cellSize: 1_000 });

    const arenaTile = await service.getArenaCompetitionTile({
      ...tile,
      arenaId,
      period: { competitionMonth: '2026-07' },
    });
    expect(decode(arenaTile.data, 'competition-coverage').map((feature) => feature.properties.x).sort())
      .toEqual([0, 1]);

    const globalTile = await service.getGlobalCompetitionTile({
      ...tile,
      period: { competitionMonth: '2026-07' },
    });
    expect(decode(globalTile.data, 'competition-coverage')).toHaveLength(3);
  });

  it('supports negative projected grid coordinates and excludes claims outside the tile range', async () => {
    const pilot = await createPilot();
    await addPersonalClaims(pilot, [{ x: -1, y: -1 }, { x: 100_000, y: 100_000 }]);
    const result = await createTerritoryTileService(database.db, { cellSize: 1_000 }).getPersonalTile({
      z: 7,
      x: 63,
      y: 64,
      userId: pilot.userId,
      period: { period: 'all-time' },
    });
    expect(result.featureCount).toBe(1);
    expect(decode(result.data, 'personal-territory')).toHaveLength(1);
  });

  it('filters Following tiles to viewer and followed pilots while retaining global shared counts', async () => {
    const viewer = await createPilot();
    const followed = await createPilot();
    const outsider = await createPilot();
    await database.db.insert(pilotFollows).values({ followerUserId: viewer.userId, followedUserId: followed.userId });
    await addCompetitionClaim(viewer, { x: 0, y: 0 });
    await addCompetitionClaim(followed, { x: 0, y: 0 });
    await addCompetitionClaim(outsider, { x: 1, y: 0 });
    const result = await createTerritoryTileService(database.db, { cellSize: 1_000 }).getGlobalCompetitionTile({
      ...tile, period: { competitionMonth: '2026-07' }, currentUserId: viewer.userId, scope: 'following',
    });
    const features = decode(result.data, 'competition-coverage').map((feature) => feature.properties);
    expect(features).toEqual([expect.objectContaining({ cellId: '1000:0:0', claimantCount: 2, isShared: true })]);
    expect(features.some((feature) => feature.cellId === '1000:1:0')).toBe(false);
  });

  it('authorizes and scopes a Group tile in the same database query', async () => {
    const owner = await createPilot();
    const member = await createPilot();
    const outsider = await createPilot();
    const [group] = await database.db.insert(pilotGroups).values({
      ownerUserId: owner.userId,
      name: 'Tile pilots',
    }).returning({ id: pilotGroups.id });
    if (!group) throw new Error('Expected a group.');
    await database.db.insert(pilotGroupMemberships).values([
      { groupId: group.id, userId: owner.userId, status: 'accepted', acceptedAt: new Date() },
      { groupId: group.id, userId: member.userId, status: 'accepted', acceptedAt: new Date() },
    ]);
    await addCompetitionClaim(member, { x: 0, y: 0 });
    await addCompetitionClaim(outsider, { x: 1, y: 0 });
    const service = createTerritoryTileService(database.db, { cellSize: 1_000 });

    const authorized = await service.getGroupCompetitionTile?.({
      ...tile,
      groupId: group.id,
      currentUserId: owner.userId,
      period: { competitionMonth: '2026-07' },
    });
    expect(authorized?.authorized).toBe(true);
    expect(decode(authorized!.data, 'competition-coverage').map((feature) => feature.properties.cellId))
      .toEqual(['1000:0:0']);

    await expect(service.getGroupCompetitionTile?.({
      ...tile,
      groupId: group.id,
      currentUserId: outsider.userId,
      period: { competitionMonth: '2026-07' },
    })).resolves.toEqual({ data: Buffer.alloc(0), featureCount: 0, authorized: false });
  });
});
