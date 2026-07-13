import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flights, igcFiles, trackPoints, users } from '../../src/db/schema.js';
import { createFlightAreaDetectionService } from '../../src/services/flightAreaDetectionService.js';
import { resetAndPushTestDatabase } from './database.js';

type Coordinate = readonly [longitude: number, latitude: number];

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;

beforeAll(async () => {
  database = await resetAndPushTestDatabase();
});

beforeEach(async () => {
  await database.pool.query('TRUNCATE TABLE users CASCADE');
});

afterAll(async () => {
  await database.pool.end();
});

async function persistFlight(coordinates: readonly Coordinate[]): Promise<string> {
  const [user] = await database.db
    .insert(users)
    .values({ email: `pilot-${crypto.randomUUID()}@example.com` })
    .returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');

  const [igcFile] = await database.db
    .insert(igcFiles)
    .values({
      userId: user.id,
      originalFilename: 'flight.igc',
      contentType: 'application/vnd.fai.igc',
      byteSize: 1,
      bucketKey: `flights/${crypto.randomUUID()}.igc`,
    })
    .returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db
    .insert(flights)
    .values({ userId: user.id, igcFileId: igcFile.id, processingStatus: 'completed' })
    .returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  await database.db.insert(trackPoints).values(coordinates.map(([longitude, latitude], sequenceNumber) => ({
    flightId: flight.id,
    sequenceNumber,
    recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequenceNumber)),
    latitude,
    longitude,
    gpsAltitudeMeters: 1_000,
    pressureAltitudeMeters: 1_000,
  })));

  return flight.id;
}

async function storedClaims(flightId: string) {
  return database.pool.query<{
    area_square_meters: number;
    interior_ring_count: number;
    is_valid: boolean;
    srid: number;
  }>(
    `SELECT area_square_meters,
            ST_NumInteriorRings(geometry)::int AS interior_ring_count,
            ST_IsValid(geometry) AS is_valid,
            ST_SRID(geometry) AS srid
     FROM flight_areas
     WHERE flight_id = $1
     ORDER BY area_square_meters DESC`,
    [flightId],
  );
}

describe('FlightAreaDetectionService with PostGIS', () => {
  it('stores no claim for an open track', async () => {
    const flightId = await persistFlight([
      [-105, 40],
      [-104.99, 40.01],
      [-104.98, 40],
    ]);

    const result = await createFlightAreaDetectionService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 0 });
    expect((await storedClaims(flightId)).rows).toEqual([]);
  });

  it('stores no claim for a zero-distance track with identical fixes', async () => {
    const flightId = await persistFlight([
      [-105, 40],
      [-105, 40],
    ]);

    const result = await createFlightAreaDetectionService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 0 });
    expect((await storedClaims(flightId)).rows).toEqual([]);
  });

  it('merges a nested loop into its containing claim without a hole', async () => {
    const flightId = await persistFlight([
      [-105.002, 40.002],
      [-104.998, 40.002],
      [-104.998, 40.006],
      [-105.002, 40.006],
      [-105.002, 40.002],
      [-105.01, 39.99],
      [-104.98, 39.99],
      [-104.98, 40.02],
      [-105.01, 40.02],
      [-105.01, 39.99],
    ]);

    const result = await createFlightAreaDetectionService(database.db).detect({ flightId });
    const claims = await storedClaims(flightId);

    expect(result).toEqual({ flightId, detectedAreaCount: 1 });
    expect(claims.rows).toEqual([
      expect.objectContaining({ interior_ring_count: 0, is_valid: true, srid: 4326 }),
    ]);
  });

  it('keeps three spatially separate loops as three claims', async () => {
    const flightId = await persistFlight([
      [-105.03, 40], [-105.01, 40], [-105.01, 40.02], [-105.03, 40.02], [-105.03, 40],
      [-105, 40],
      [-104.995, 40], [-104.99, 40], [-104.99, 40.005], [-104.995, 40.005], [-104.995, 40],
      [-104.98, 40],
      [-104.975, 40], [-104.97, 40], [-104.97, 40.005], [-104.975, 40.005], [-104.975, 40],
    ]);

    const result = await createFlightAreaDetectionService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 3 });
    expect((await storedClaims(flightId)).rows).toHaveLength(3);
  });

  it('keeps figure-eight lobes that meet only at one point as separate claims', async () => {
    const flightId = await persistFlight([
      [-105, 40],
      [-105.01, 40.01],
      [-105.02, 40],
      [-105.01, 39.99],
      [-105, 40],
      [-104.99, 40.01],
      [-104.98, 40],
      [-104.99, 39.99],
      [-105, 40],
    ]);

    const result = await createFlightAreaDetectionService(database.db).detect({ flightId });

    expect(result).toEqual({ flightId, detectedAreaCount: 2 });
    expect((await storedClaims(flightId)).rows).toHaveLength(2);
  });

  it('filters final claims below 100 square meters', async () => {
    const flightId = await persistFlight([
      [-105, 40], [-104.99995, 40], [-104.99995, 40.00005], [-105, 40.00005], [-105, 40],
      [-104.999, 40],
      [-104.9988, 40], [-104.9988, 40.0002], [-104.999, 40.0002], [-104.999, 40],
    ]);

    const result = await createFlightAreaDetectionService(database.db).detect({ flightId });
    const claims = await storedClaims(flightId);

    expect(result).toEqual({ flightId, detectedAreaCount: 1 });
    expect(claims.rows[0]?.area_square_meters).toBeGreaterThanOrEqual(100);
  });

  it('replaces prior results when the same flight is detected again', async () => {
    const flightId = await persistFlight([
      [-105, 40], [-104.99, 40], [-104.99, 40.01], [-105, 40.01], [-105, 40],
    ]);
    const service = createFlightAreaDetectionService(database.db);

    await service.detect({ flightId });
    const rerun = await service.detect({ flightId });

    expect(rerun).toEqual({ flightId, detectedAreaCount: 1 });
    expect((await storedClaims(flightId)).rows).toHaveLength(1);
  });
});
