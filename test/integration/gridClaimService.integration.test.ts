import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { achievements, competitionGridClaims, flightProgress, flights, igcFiles, personalGridClaims as userGridClaims, trackPoints, users } from '../../src/db/schema.js';
import { createGridClaimService } from '../../src/services/gridClaimService.js';
import { createAdminFlightService } from '../../src/services/adminFlightService.js';
import { resetAndPushTestDatabase } from './database.js';

type ProjectedCoordinate = readonly [x: number, y: number];

let database: Awaited<ReturnType<typeof resetAndPushTestDatabase>>;
const viewport = { west: -180, south: -89, east: 180, north: 89 };

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
  launchTimezone = 'UTC',
  existingUserId?: string,
): Promise<{ flightId: string; userId: string; launchTimezone: string }> {
  const [user] = existingUserId
    ? await database.db.select({ id: users.id }).from(users).where(eq(users.id, existingUserId))
    : await database.db.insert(users).values({
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
    contentHash: igcFile.id.replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone,
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

  return { flightId: flight.id, userId: user.id, launchTimezone };
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

async function storedCompetitionCells(cellSize: number) {
  return database.db.select().from(competitionGridClaims)
    .where(eq(competitionGridClaims.cellSize, cellSize))
    .orderBy(
      competitionGridClaims.competitionMonth,
      competitionGridClaims.x,
      competitionGridClaims.y,
      competitionGridClaims.claimTimestamp,
    );
}

async function storedProgression(flightId: string) {
  const [progression] = await database.db.select().from(flightProgress).where(eq(flightProgress.flightId, flightId));
  return progression;
}

async function storedAchievements(userId: string) {
  return database.db.select().from(achievements)
    .where(eq(achievements.userId, userId))
    .orderBy(achievements.achievementKey);
}

async function persistClaimCells(
  claim: { flightId: string; userId: string },
  cells: ReadonlyArray<{ x: number; y: number }>,
  cellSize = 1_000,
) {
  await database.db.insert(userGridClaims).values(cells.map(({ x, y }) => ({
    cellSize,
    x,
    y,
    claimFlight: claim.flightId,
    claimUser: claim.userId,
    claimTimestamp: new Date(Date.UTC(2026, 0, 1)),
  })));
}

describe('GridClaimService with PostGIS', () => {
  it('stores direct, enclosed, new, and resulting lifetime counts for a first evaluation', async () => {
    const flight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500],
    ]);
    const result = await createGridClaimService(database.db, { cellSize: 1_000 }).process(flight);

    expect(result).toMatchObject({
      directCellCount: 8,
      enclosedCellCount: 1,
      newPersonalCellCount: 9,
      personalCellTotalAfter: 9,
      progressionVersion: 1,
      evaluatedAt: expect.any(Date),
    });
    expect(await storedProgression(flight.flightId)).toMatchObject({
      flightId: flight.flightId,
      userId: flight.userId,
      directCellCount: 8,
      enclosedCellCount: 1,
      newPersonalCellCount: 9,
      personalCellTotalAfter: 9,
      progressionVersion: 1,
      evaluatedAt: result.evaluatedAt,
      updatedAt: expect.any(Date),
    });
  });

  it('counts only genuinely new cells on an overlapping second flight', async () => {
    const first = await persistFlight([[100, 100], [2_100, 100]]);
    await createGridClaimService(database.db, { cellSize: 1_000 }).process(first);
    const second = await persistFlight([[1_100, 100], [3_100, 100]], new Date(Date.UTC(2026, 0, 2)), 'UTC', first.userId);

    await expect(createGridClaimService(database.db, { cellSize: 1_000 }).process(second)).resolves.toMatchObject({
      directCellCount: 3,
      enclosedCellCount: 0,
      newPersonalCellCount: 1,
      personalCellTotalAfter: 4,
    });
    expect(await storedProgression(second.flightId)).toMatchObject({
      newPersonalCellCount: 1,
      personalCellTotalAfter: 4,
    });
  });

  it('stores zero new cells when a flight adds no Personal Map cells', async () => {
    const first = await persistFlight([[100, 100], [2_100, 100]]);
    await createGridClaimService(database.db, { cellSize: 1_000 }).process(first);
    const second = await persistFlight([[100, 100], [2_100, 100]], new Date(Date.UTC(2026, 0, 2)), 'UTC', first.userId);

    await createGridClaimService(database.db, { cellSize: 1_000 }).process(second);

    expect(await storedProgression(second.flightId)).toMatchObject({
      newPersonalCellCount: 0,
      personalCellTotalAfter: 3,
    });
  });

  it('preserves first-evaluation snapshots while updating claim counts during reprocessing', async () => {
    const flight = await persistFlight([[100, 100], [2_100, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const firstResult = await service.process(flight);
    const [newPoint] = await toWgs84([[3_100, 100]]);
    if (!newPoint) throw new Error('Expected reprocessing coordinate.');
    await database.db.insert(trackPoints).values({
      flightId: flight.flightId,
      sequenceNumber: 2,
      recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)),
      latitude: newPoint.latitude,
      longitude: newPoint.longitude,
      gpsAltitudeMeters: 1_000,
      pressureAltitudeMeters: 1_000,
    });

    const reprocessed = await service.reprocess({ flightId: flight.flightId });

    expect(reprocessed).toMatchObject({
      status: 'completed',
      result: {
        directCellCount: 4,
        enclosedCellCount: 0,
        newPersonalCellCount: firstResult.newPersonalCellCount,
        personalCellTotalAfter: firstResult.personalCellTotalAfter,
        progressionVersion: 2,
        evaluatedAt: firstResult.evaluatedAt,
      },
    });
    expect(await storedProgression(flight.flightId)).toMatchObject({
      directCellCount: 4,
      enclosedCellCount: 0,
      newPersonalCellCount: 3,
      personalCellTotalAfter: 3,
      progressionVersion: 2,
      evaluatedAt: firstResult.evaluatedAt,
      updatedAt: expect.any(Date),
    });
  });

  it('reprocesses a completed flight without progression and restores its initial achievements', async () => {
    const flight = await persistFlight([[100, 100], [10_100, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    expect(await storedProgression(flight.flightId)).toBeUndefined();
    expect(await storedAchievements(flight.userId)).toEqual([]);

    const first = await service.reprocess({ flightId: flight.flightId });

    expect(first).toMatchObject({
      status: 'completed',
      result: {
        directCellCount: 11,
        enclosedCellCount: 0,
        progressionVersion: 1,
      },
    });
    expect(await storedProgression(flight.flightId)).toMatchObject({
      progressionVersion: 1,
      directCellCount: 11,
    });
    const firstAchievements = await storedAchievements(flight.userId);
    expect(firstAchievements.map((row) => row.achievementType).sort()).toEqual([
      'personal_best_total_cells',
      'unique_cells_milestone',
    ]);

    await expect(service.reprocess({ flightId: flight.flightId })).resolves.toMatchObject({
      status: 'completed',
      result: { progressionVersion: 2 },
    });
    expect(await storedAchievements(flight.userId)).toEqual(firstAchievements);
  });

  it('aggregates personal viewport stats by distinct cells and contributing flights', async () => {
    const first = await persistFlight([[100, 100], [1_100, 100]]);
    const [secondFile] = await database.db.insert(igcFiles).values({
      userId: first.userId,
      originalFilename: 'second-flight.igc',
      contentType: 'application/vnd.fai.igc',
      byteSize: 1,
      bucketKey: `flights/${crypto.randomUUID()}.igc`,
    }).returning({ id: igcFiles.id });
    if (!secondFile) throw new Error('IGC file insert returned no row.');
    const [secondFlight] = await database.db.insert(flights).values({
      userId: first.userId,
      igcFileId: secondFile.id,
      contentHash: secondFile.id.replaceAll('-', '').padEnd(64, '0'),
      processingStatus: 'completed',
      launchTimezone: 'UTC',
    }).returning({ id: flights.id });
    if (!secondFlight) throw new Error('Flight insert returned no row.');

    await persistClaimCells(first, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    await persistClaimCells(
      { flightId: secondFlight.id, userId: first.userId },
      [{ x: 1, y: 0 }],
    );
    const [southwest, northeast] = await toWgs84([[1, 1], [1_999, 999]]);
    if (!southwest || !northeast) throw new Error('Expected viewport coordinates.');

    const stats = await createGridClaimService(database.db, { cellSize: 1_000 }).getViewportStats({
      userId: first.userId,
      west: southwest.longitude,
      south: southwest.latitude,
      east: northeast.longitude,
      north: northeast.latitude,
    });

    expect(stats).toEqual({
      claimedCellCount: 2,
      claimedAreaSquareMeters: 2_000_000,
      flightCount: 2,
    });
  });

  it('claims each sparse crossed cell, including cells whose endpoints are both outside', async () => {
    const flight = await persistFlight([[-500, 500], [2_500, 500]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toEqual({
      flightId: flight.flightId,
      cellSize: 1_000,
      directCellCount: 4,
      enclosedCellCount: 0,
      newPersonalCellCount: 4,
      personalCellTotalAfter: 4,
      progressionVersion: 1,
      evaluatedAt: expect.any(Date),
    });

    expect(await storedCells(1_000)).toMatchObject([
      { x: -1, y: 0, claimUser: flight.userId },
      { x: 0, y: 0, claimUser: flight.userId },
      { x: 1, y: 0, claimUser: flight.userId },
      { x: 2, y: 0, claimUser: flight.userId },
    ]);
  });

  it('claims every crossed cell of a long sparse diagonal without expanding its full envelope', async () => {
    const flight = await persistFlight([[100, 500], [200_100, 100_500]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({
      directCellCount: 301,
      enclosedCellCount: 0,
    });
    const cells = await storedCells(1_000);

    expect(cells).toHaveLength(301);
    expect(cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 0, y: 0, claimUser: flight.userId }),
      expect.objectContaining({ x: 100, y: 50, claimUser: flight.userId }),
      expect.objectContaining({ x: 200, y: 100, claimUser: flight.userId }),
    ]));
  });

  it('claims the cells generated along a grid edge', async () => {
    const flight = await persistFlight([[100, 1_000], [2_900, 1_000]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({ directCellCount: 3, enclosedCellCount: 0 });
    expect((await storedCells(1_000)).map(({ x, y }) => [x, y])).toEqual([
      [0, 1], [1, 1], [2, 1],
    ]);
  });

  it('does not fill cells from an open path', async () => {
    const flight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500],
      [2_500, 2_500], [1_500, 2_500], [500, 2_500],
    ]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({
      directCellCount: 7,
      enclosedCellCount: 0,
    });
    expect((await storedCells(1_000)).map(({ x, y }) => [x, y])).not.toContainEqual([1, 1]);
  });

  it('fills the center of an eight-cell full-edge ring', async () => {
    const flight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500],
    ]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({
      directCellCount: 8,
      enclosedCellCount: 1,
    });
    expect((await storedCells(1_000)).find(({ x, y }) => x === 1 && y === 1)).toMatchObject({
      claimUser: flight.userId,
      claimFlight: flight.flightId,
    });
  });

  it('does not treat corner-only direct-cell contact from track data as an enclosure', async () => {
    const flight = await persistFlight([
      [500, 500], [1_500, 1_500], [2_500, 500], [1_500, -500], [500, 500],
    ]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({ enclosedCellCount: 0 });
  });

  it('fills both cells enclosed by two full-edge rings', async () => {
    const flight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500], [3_500, 500],
      [4_500, 500], [5_500, 500], [5_500, 1_500], [5_500, 2_500], [4_500, 2_500],
      [3_500, 2_500], [3_500, 1_500], [3_500, 500],
    ]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({
      directCellCount: 16,
      enclosedCellCount: 2,
    });
    const cells = await storedCells(1_000);
    expect(cells.find(({ x, y }) => x === 1 && y === 1)).toMatchObject({ claimUser: flight.userId });
    expect(cells.find(({ x, y }) => x === 4 && y === 1)).toMatchObject({ claimUser: flight.userId });
  });

  it('keeps an enclosed cell for both pilots while competition records the newer claim', async () => {
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const previousOwner = await persistFlight(
      [[1_100, 1_100], [1_900, 1_100]],
      new Date(Date.UTC(2026, 0, 1, 0, 0, 0)),
    );
    const enclosingFlight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500],
    ], new Date(Date.UTC(2026, 0, 1, 0, 1, 0)));

    await service.process(previousOwner);
    await service.process(enclosingFlight);

    expect((await storedCells(1_000)).filter(({ x, y }) => x === 1 && y === 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimUser: previousOwner.userId, claimFlight: previousOwner.flightId }),
      expect.objectContaining({ claimUser: enclosingFlight.userId, claimFlight: enclosingFlight.flightId }),
    ]));
    expect((await storedCompetitionCells(1_000)).filter(({ x, y }) => x === 1 && y === 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimUser: previousOwner.userId, claimFlight: previousOwner.flightId }),
      expect.objectContaining({ claimUser: enclosingFlight.userId, claimFlight: enclosingFlight.flightId }),
    ]));
  });

  it('keeps an enclosure timestamp at the latest boundary first-hit when a boundary is revisited', async () => {
    const recordedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const flight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500], [500, 1_500], [500, 500],
    ], recordedAt);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await service.process(flight);

    expect((await storedCells(1_000)).find(({ x, y }) => x === 1 && y === 1)).toMatchObject({
      claimTimestamp: new Date(recordedAt.getTime() + 7_000),
    });
    expect((await storedCompetitionCells(1_000)).find(({ x, y }) => x === 1 && y === 1)).toMatchObject({
      claimTimestamp: new Date(recordedAt.getTime() + 7_000),
    });
  });

  it('reprocessing an enclosing flight produces identical rows', async () => {
    const flight = await persistFlight([
      [500, 500], [1_500, 500], [2_500, 500], [2_500, 1_500], [2_500, 2_500],
      [1_500, 2_500], [500, 2_500], [500, 1_500], [500, 500],
    ]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await service.process(flight);
    const firstRows = await storedCells(1_000);
    await service.process(flight);

    await expect(storedCells(1_000)).resolves.toEqual(firstRows);
  });

  it('keeps personal contributions for every pilot while competition retains claim history', async () => {
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const earlier = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    const later = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1, 0, 1, 0)));
    const equal = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1, 0, 1, 0)));

    await service.process(earlier);
    await service.process(later);
    await service.process(earlier);
    await service.process(equal);

    expect(await storedCells(1_000)).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 0, y: 0, claimUser: earlier.userId, claimFlight: earlier.flightId }),
      expect.objectContaining({ x: 0, y: 0, claimUser: later.userId, claimFlight: later.flightId }),
      expect.objectContaining({ x: 0, y: 0, claimUser: equal.userId, claimFlight: equal.flightId }),
    ]));
    expect(await storedCompetitionCells(1_000)).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 0, y: 0, claimUser: earlier.userId, claimFlight: earlier.flightId }),
      expect.objectContaining({ x: 0, y: 0, claimUser: later.userId, claimFlight: later.flightId }),
      expect.objectContaining({ x: 0, y: 0, claimUser: equal.userId, claimFlight: equal.flightId }),
    ]));
  });

  it('stores the newest endpoint timestamp when multiple segments directly claim one cell', async () => {
    const recordedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const flight = await persistFlight([[100, 100], [900, 100], [100, 100]], recordedAt);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).resolves.toMatchObject({ directCellCount: 1, enclosedCellCount: 0 });

    expect(await storedCells(1_000)).toMatchObject([{
      x: 0,
      y: 0,
      claimFlight: flight.flightId,
      claimTimestamp: new Date(recordedAt.getTime() + 2_000),
    }]);
  });

  it('stores separate monthly history rows when one flight reclaims a cell across local midnight', async () => {
    const flight = await persistFlight(
      [[100, 100], [900, 100], [100, 100]],
      new Date('2026-02-01T06:59:58.000Z'),
      'America/Denver',
    );
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await service.process(flight);

    expect(await storedCompetitionCells(1_000)).toMatchObject([
      { competitionMonth: '2026-01-01', x: 0, y: 0, claimFlight: flight.flightId },
      { competitionMonth: '2026-02-01', x: 0, y: 0, claimFlight: flight.flightId },
    ]);
  });

  it('retains a row for each flight that claims the same competition cell', async () => {
    const earlier = await persistFlight([[100, 100], [900, 100]], new Date('2026-01-01T00:00:00Z'));
    const later = await persistFlight([[100, 100], [900, 100]], new Date('2026-01-01T00:01:00Z'));
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await service.process(earlier);
    await service.process(later);

    expect(await storedCompetitionCells(1_000)).toMatchObject([
      { competitionMonth: '2026-01-01', claimFlight: earlier.flightId, claimUser: earlier.userId },
      { competitionMonth: '2026-01-01', claimFlight: later.flightId, claimUser: later.userId },
    ]);
  });

  it('reprocessing replaces only that flight’s competition history', async () => {
    const first = await persistFlight([[100, 100], [900, 100]]);
    const second = await persistFlight([[2_100, 100], [2_900, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await service.process(first);
    await service.process(second);
    const before = await storedCompetitionCells(1_000);
    await service.process(first);

    expect(await storedCompetitionCells(1_000)).toEqual(before);
  });

  it('keeps competition history consistent during concurrent same-flight reprocessing', async () => {
    const flight = await persistFlight([[100, 100], [900, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await Promise.all([service.process(flight), service.process(flight)]);

    expect(await storedCompetitionCells(1_000)).toMatchObject([
      { competitionMonth: '2026-01-01', x: 0, y: 0, claimFlight: flight.flightId },
    ]);
  });

  it('serializes concurrent different flights for one user across personal and competition claims', async () => {
    const first = await persistFlight([[100, 100], [2_100, 100]]);
    const second = await persistFlight(
      [[3_100, 100], [5_100, 100]],
      new Date(Date.UTC(2026, 0, 2)),
      'UTC',
      first.userId,
    );
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    const results = await Promise.all([service.process(first), service.process(second)]);

    expect(results.map((result) => result.newPersonalCellCount).sort((a, b) => a - b)).toEqual([3, 3]);
    expect(results.map((result) => result.personalCellTotalAfter).sort((a, b) => a - b)).toEqual([3, 6]);
    expect(await storedCells(1_000)).toHaveLength(6);
    const competitionRows = await storedCompetitionCells(1_000);
    expect(competitionRows).toHaveLength(6);
    expect(competitionRows.filter((row) => row.claimFlight === first.flightId)).toHaveLength(3);
    expect(competitionRows.filter((row) => row.claimFlight === second.flightId)).toHaveLength(3);
    expect(new Set(competitionRows.map((row) => row.claimFlight))).toEqual(
      new Set([first.flightId, second.flightId]),
    );
    const firstProgression = await storedProgression(first.flightId);
    const secondProgression = await storedProgression(second.flightId);
    expect(firstProgression).toMatchObject({
      newPersonalCellCount: 3,
      personalCellTotalAfter: expect.any(Number),
    });
    expect(secondProgression).toMatchObject({
      newPersonalCellCount: 3,
      personalCellTotalAfter: expect.any(Number),
    });
    expect(new Set([
      firstProgression?.personalCellTotalAfter,
      secondProgression?.personalCellTotalAfter,
    ])).toEqual(new Set([3, 6]));
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

  it('rebuilds a completed flight’s claims without changing its flight data or track points', async () => {
    const flight = await persistFlight([[100, 100], [2_100, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    const originalStartedAt = new Date(Date.UTC(2026, 0, 1, 12));
    await database.db.update(flights).set({
      startedAt: originalStartedAt,
      distanceMeters: 2_000,
      durationSeconds: 60,
    }).where(eq(flights.id, flight.flightId));
    await service.process(flight);
    await createGridClaimService(database.db, { cellSize: 2_000 }).process(flight);
    const pointsBefore = await database.db.select().from(trackPoints).where(eq(trackPoints.flightId, flight.flightId));

    const adminFlights = createAdminFlightService(database.db, service);
    await expect(adminFlights.reprocessFlight({ flightId: flight.flightId })).resolves.toMatchObject({
      status: 'completed',
      result: { directCellCount: 3, enclosedCellCount: 0 },
    });

    expect(await storedCells(2_000)).toEqual([]);
    expect(await storedCompetitionCells(2_000)).toEqual([]);
    expect(await storedCells(1_000)).toMatchObject([
      { x: 0, y: 0, claimFlight: flight.flightId },
      { x: 1, y: 0, claimFlight: flight.flightId },
      { x: 2, y: 0, claimFlight: flight.flightId },
    ]);
    expect(await database.db.select().from(trackPoints).where(eq(trackPoints.flightId, flight.flightId))).toEqual(pointsBefore);
    const [storedFlight] = await database.db.select({
      startedAt: flights.startedAt,
      distanceMeters: flights.distanceMeters,
      durationSeconds: flights.durationSeconds,
      processingStatus: flights.processingStatus,
    }).from(flights).where(eq(flights.id, flight.flightId));
    expect(storedFlight).toEqual({
      startedAt: originalStartedAt,
      distanceMeters: 2_000,
      durationSeconds: 60,
      processingStatus: 'completed',
    });
  });

  it('rolls back both claim sets when competition rebuilding fails', async () => {
    const flight = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1)), 'Invalid/Timezone');
    const claimTimestamp = new Date(Date.UTC(2026, 0, 1));
    await database.db.insert(userGridClaims).values({
      cellSize: 1_000,
      x: 99,
      y: 99,
      claimFlight: flight.flightId,
      claimUser: flight.userId,
      claimTimestamp,
    });
    await database.db.insert(competitionGridClaims).values({
      competitionMonth: '2026-01-01',
      cellSize: 1_000,
      x: 99,
      y: 99,
      claimFlight: flight.flightId,
      claimUser: flight.userId,
      claimTimestamp,
    });
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.reprocess({ flightId: flight.flightId })).rejects.toThrow();

    expect(await database.db.select().from(userGridClaims).where(eq(userGridClaims.claimFlight, flight.flightId))).toMatchObject([
      { cellSize: 1_000, x: 99, y: 99, claimUser: flight.userId },
    ]);
    expect(await database.db.select().from(competitionGridClaims).where(eq(competitionGridClaims.claimFlight, flight.flightId))).toMatchObject([
      { competitionMonth: '2026-01-01', cellSize: 1_000, x: 99, y: 99, claimUser: flight.userId },
    ]);
  });

  it('atomically rolls back normal processing when competition month calculation fails', async () => {
    const flight = await persistFlight([[100, 100], [900, 100]]);
    const service = createGridClaimService(database.db, { cellSize: 1_000 });
    await service.process(flight);
    const personalBefore = await storedCells(1_000);
    const competitionBefore = await storedCompetitionCells(1_000);
    const progressionBefore = await storedProgression(flight.flightId);

    await expect(service.process({ ...flight, launchTimezone: 'Invalid/Timezone' })).rejects.toThrow();

    expect(await storedCells(1_000)).toEqual(personalBefore);
    expect(await storedCompetitionCells(1_000)).toEqual(competitionBefore);
    expect(await storedProgression(flight.flightId)).toEqual(progressionBefore);
  });

  it('rolls back Personal claims and progression when Competition rebuilding fails', async () => {
    const flight = await persistFlight([[100, 100], [900, 100]], new Date(Date.UTC(2026, 0, 1)), 'Invalid/Timezone');
    const service = createGridClaimService(database.db, { cellSize: 1_000 });

    await expect(service.process(flight)).rejects.toThrow();

    expect(await database.db.select().from(userGridClaims).where(eq(userGridClaims.claimFlight, flight.flightId))).toEqual([]);
    expect(await database.db.select().from(flightProgress).where(eq(flightProgress.flightId, flight.flightId))).toEqual([]);
    expect(await database.db.select().from(competitionGridClaims).where(eq(competitionGridClaims.claimFlight, flight.flightId))).toEqual([]);
  });

});
