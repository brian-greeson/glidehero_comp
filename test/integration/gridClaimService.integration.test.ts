import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { flights, igcFiles, trackPoints, userGridClaims, users } from '../../src/db/schema.js';
import { createGridClaimService } from '../../src/services/gridClaimService.js';
import { resetAndPushTestDatabase } from './database.js';

type ProjectedCoordinate = readonly [x: number, y: number];

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  if (database) await database.pool.end();
});

async function toWgs84(coordinates: readonly ProjectedCoordinate[]) {
  const values = coordinates.map(([,], index) => `($${index * 2 + 1}::double precision, $${index * 2 + 2}::double precision)`).join(', ');
  const projected = await database.pool.query<{ x: number; y: number; longitude: number; latitude: number }>(
    `SELECT input.x, input.y,
            ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS longitude,
            ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(input.x, input.y), 6933), 4326)) AS latitude
     FROM (VALUES ${values}) AS input(x, y)`,
    coordinates.flat(),
  );
  return projected.rows;
}

async function persistFlight(
  coordinates: readonly ProjectedCoordinate[],
  recordedAt = new Date(Date.UTC(2026, 0, 1)),
): Promise<{ flightId: string; userId: string }> {
  const [user] = await database.db.insert(users).values({
    email: `pilot-${crypto.randomUUID()}@example.com`,
  }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');

  const [igcFile] = await database.db.insert(igcFiles).values({
    userId: user.id,
    originalFilename: 'flight.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flights/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db.insert(flights).values({
    userId: user.id,
    igcFileId: igcFile.id,
    processingStatus: 'completed',
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  const wgs84 = await toWgs84(coordinates);
  await database.db.insert(trackPoints).values(wgs84.map((point, sequenceNumber) => ({
    flightId: flight.id,
    sequenceNumber,
    recordedAt: new Date(recordedAt.getTime() + sequenceNumber * 1_000),
    latitude: point.latitude,
    longitude: point.longitude,
    gpsAltitudeMeters: 1_000,
    pressureAltitudeMeters: 1_000,
  })));

  return { flightId: flight.id, userId: user.id };
}

async function storedCells(cellSize: number) {
  return database.db.select({
    cellSize: userGridClaims.cellSize,
    x: userGridClaims.x,
    y: userGridClaims.y,
    claimUser: userGridClaims.claimUser,
    claimFlight: userGridClaims.claimFlight,
    claimTimestamp: userGridClaims.claimTimestamp,
  }).from(userGridClaims).where(eq(userGridClaims.cellSize, cellSize)).orderBy(userGridClaims.x, userGridClaims.y);
}

describe('GridClaimService with PostGIS', () => {
  it('claims each sparse crossed cell, including cells whose endpoints are both outside', async () => {
    const flight = await persistFlight([[-500, 500], [2_500, 500]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toEqual({
      flightId: flight.flightId,
      cellSize: 1_000,
      directCellCount: 4,
      enclosedCellCount: 0,
    });

    expect(await storedCells(1_000)).toMatchObject([
      { x: -1, y: 0, claimUser: flight.userId },
      { x: 0, y: 0, claimUser: flight.userId },
      { x: 1, y: 0, claimUser: flight.userId },
      { x: 2, y: 0, claimUser: flight.userId },
    ]);
  });

  it('claims the cells generated along a grid edge', async () => {
    const flight = await persistFlight([[100, 1_000], [2_900, 1_000]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({ directCellCount: 3, enclosedCellCount: 0 });
    expect((await storedCells(1_000)).map(({ x, y }) => [x, y])).toEqual([
      [0, 1], [1, 1], [2, 1],
    ]);
  });

  it('keeps the latest owner, retaining the existing owner on equal timestamps', async () => {
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const earlier = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    const later = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1, 0, 1, 0)));
    const equal = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1, 0, 1, 0)));

    await service.process(earlier);
    await service.process(later);
    await service.process(earlier);
    await service.process(equal);

    expect(await storedCells(1_000)).toMatchObject([{ x: 0, y: 0, claimUser: later.userId, claimFlight: later.flightId }]);
  });

  it('stores independent 1000m and 2000m grid variants', async () => {
    const flight = await persistFlight([[100, 100], [2_100, 100]]);

    await createGridClaimService(database.db, { cellSize: 1_000 }).process(flight);
    await createGridClaimService(database.db, { cellSize: 2_000 }).process(flight);

    expect(await storedCells(1_000)).toHaveLength(3);
    expect(await storedCells(2_000)).toMatchObject([
      { cellSize: 2_000, x: 0, y: 0, claimUser: flight.userId },
      { cellSize: 2_000, x: 1, y: 0, claimUser: flight.userId },
    ]);
  });

  it('returns only the requested user’s WGS84 Polygon cells', async () => {
    const first = await persistFlight([[100, 100], [900, 100]]);
    const second = await persistFlight([[2_100, 100], [2_900, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    await service.process(first);
    await service.process(second);

    const geojson = await service.get({ userId: first.userId });

    expect(geojson).toMatchObject({ type: 'FeatureCollection', features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon' },
    }] });
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0]?.geometry.coordinates[0]).toHaveLength(5);
    expect(geojson.features[0]?.geometry.coordinates[0]?.flat()).toEqual(expect.arrayContaining([
      expect.any(Number),
    ]));
    expect(geojson.features[0]?.geometry.coordinates[0]?.flat().every((coordinate) => Math.abs(coordinate) <= 180)).toBe(true);
  });
});
