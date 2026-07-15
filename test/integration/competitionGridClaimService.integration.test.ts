import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { competitionGridClaims, flights, igcFiles, profiles, users } from '../../src/db/schema.js';
import { createCompetitionGridClaimService } from '../../src/services/competitionGridClaimService.js';
import { resetAndPushTestDatabase } from './database.js';

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

type PersistClaimInput = {
  competitionMonth: string;
  claimTimestamp: Date;
  flightCreatedAt: Date;
  x: number;
  y: number;
  cellSize?: number;
  pilot?: { userId: string; displayName: string };
  displayName?: string;
};

async function persistClaim(input: PersistClaimInput): Promise<{ userId: string; flightId: string; displayName: string }> {
  let pilot = input.pilot;
  if (!pilot) {
    const [user] = await database.db.insert(users).values({
      email: `pilot-${crypto.randomUUID()}@example.com`,
    }).returning({ id: users.id });
    if (!user) throw new Error('User insert returned no row.');

    pilot = { userId: user.id, displayName: input.displayName ?? `Pilot ${crypto.randomUUID()}` };
    await database.db.insert(profiles).values({
      userId: pilot.userId,
      displayName: pilot.displayName,
    });
  }

  const [igcFile] = await database.db.insert(igcFiles).values({
    userId: pilot.userId,
    originalFilename: 'competition.igc',
    contentType: 'application/vnd.fai.igc',
    byteSize: 1,
    bucketKey: `flights/${crypto.randomUUID()}.igc`,
  }).returning({ id: igcFiles.id });
  if (!igcFile) throw new Error('IGC file insert returned no row.');

  const [flight] = await database.db.insert(flights).values({
    userId: pilot.userId,
    igcFileId: igcFile.id,
    contentHash: igcFile.id.replaceAll('-', '').padEnd(64, '0'),
    processingStatus: 'completed',
    launchTimezone: 'UTC',
    createdAt: input.flightCreatedAt,
  }).returning({ id: flights.id });
  if (!flight) throw new Error('Flight insert returned no row.');

  await database.db.insert(competitionGridClaims).values({
    competitionMonth: input.competitionMonth,
    cellSize: input.cellSize ?? 1_000,
    x: input.x,
    y: input.y,
    claimFlight: flight.id,
    claimUser: pilot.userId,
    claimTimestamp: input.claimTimestamp,
  });

  return { userId: pilot.userId, flightId: flight.id, displayName: pilot.displayName };
}

describe('CompetitionGridClaimService with PostGIS', () => {
  it('normalizes an in-month date and returns the newest IGC claimant', async () => {
    const older = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-12T12:00:00Z'),
      x: 0,
      y: 0,
    });
    const newer = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-11T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-11T12:00:00Z'),
      x: 0,
      y: 0,
    });

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getCurrent({ competitionMonth: '2026-07-19' });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties.ownerUserId).toBe(newer.userId);
    expect(result.features[0]?.properties.ownerUserId).not.toBe(older.userId);
  });

  it('uses later flight processing when IGC claim timestamps are equal', async () => {
    const first = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: 0,
      y: 0,
    });
    const laterProcessed = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T14:00:00Z'),
      x: 0,
      y: 0,
    });

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getCurrent({ competitionMonth: '2026-07-01' });

    expect(result.features[0]?.properties.ownerUserId).toBe(laterProcessed.userId);
    expect(result.features[0]?.properties.ownerUserId).not.toBe(first.userId);
  });

  it('uses descending flight id as the final deterministic tie-breaker', async () => {
    const timestamp = new Date('2026-07-10T12:00:00Z');
    const first = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: timestamp,
      flightCreatedAt: timestamp,
      x: 0,
      y: 0,
    });
    const second = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: timestamp,
      flightCreatedAt: timestamp,
      x: 0,
      y: 0,
    });
    const expected = first.flightId > second.flightId ? first : second;

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getCurrent({ competitionMonth: '2026-07-01' });

    expect(result.features[0]?.properties.ownerUserId).toBe(expected.userId);
  });

  it('isolates ownership by competition month and configured cell size', async () => {
    const july = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: 0,
      y: 0,
    });
    await persistClaim({
      competitionMonth: '2026-08-01',
      claimTimestamp: new Date('2026-08-01T12:00:00Z'),
      flightCreatedAt: new Date('2026-08-01T13:00:00Z'),
      x: 0,
      y: 0,
    });
    await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-11T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-11T13:00:00Z'),
      x: 0,
      y: 0,
      cellSize: 2_000,
    });

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getCurrent({ competitionMonth: '2026-07-31' });

    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.properties.ownerUserId).toBe(july.userId);
  });

  it('returns deterministic WGS84 polygons and an empty collection for an unclaimed month', async () => {
    await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: 1,
      y: 0,
    });
    await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: 0,
      y: 0,
    });
    const service = createCompetitionGridClaimService(database.db, { cellSize: 1_000 });

    const july = await service.getCurrent({ competitionMonth: '2026-07-01' });
    const august = await service.getCurrent({ competitionMonth: '2026-08-17' });

    expect(july.features).toHaveLength(2);
    expect(july.features.every((feature) => feature.geometry.type === 'Polygon')).toBe(true);
    expect(july.features.map((feature) => feature.properties.cellId)).toEqual([
      '2026-07-01:1000:0:0',
      '2026-07-01:1000:1:0',
    ]);
    expect(july.features.flatMap((feature) => feature.geometry.coordinates).flat(2)
      .every((coordinate) => Math.abs(coordinate) <= 180)).toBe(true);
    expect(august).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('counts full intersecting cells, ranks current owners, and returns an absent current pilot with zero area', async () => {
    const alpha = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: 0,
      y: 0,
      displayName: 'Alpha',
    });
    await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:01:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:01:00Z'),
      x: 1,
      y: 0,
      pilot: alpha,
    });
    const currentPilot = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: 20,
      y: 20,
      displayName: 'Current Pilot',
    });

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getViewportLeaderboard({
        competitionMonth: '2026-07',
        west: -0.01,
        south: -0.01,
        east: 0.0001,
        north: 0.0001,
        currentUserId: currentPilot.userId,
      });

    expect(result.leaders).toEqual([{
      userId: alpha.userId,
      displayName: 'Alpha',
      claimedCellCount: 1,
      claimedAreaSquareMeters: 1_000_000,
      rank: 1,
    }]);
    expect(result.currentPilot).toEqual({
      userId: currentPilot.userId,
      displayName: 'Current Pilot',
      claimedCellCount: 0,
      claimedAreaSquareMeters: 0,
      rank: null,
    });
  });

  it('shares ranks, orders ties alphabetically, caps leaders at ten, and returns the excluded current pilot', async () => {
    const pilots = [];
    for (let index = 0; index < 11; index += 1) {
      pilots.push(await persistClaim({
        competitionMonth: '2026-07-01',
        claimTimestamp: new Date('2026-07-10T12:00:00Z'),
        flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
        x: index,
        y: 0,
        displayName: `Pilot ${String(index).padStart(2, '0')}`,
      }));
    }

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getViewportLeaderboard({
        competitionMonth: '2026-07',
        west: -0.01,
        south: -0.01,
        east: 1,
        north: 0.1,
        currentUserId: pilots[10]!.userId,
      });

    expect(result.leaders).toHaveLength(10);
    expect(result.leaders.map((pilot) => pilot.displayName)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Pilot ${String(index).padStart(2, '0')}`),
    );
    expect(result.leaders.every((pilot) => pilot.rank === 1)).toBe(true);
    expect(result.currentPilot).toMatchObject({ displayName: 'Pilot 10', rank: 1, claimedCellCount: 1 });
  });

  it('includes cells across an international-date-line-crossing viewport', async () => {
    const indexes = await database.pool.query<{ x: number; y: number }>(`
      SELECT
        floor(ST_X(ST_Transform(ST_SetSRID(ST_Point(179.95, 0), 4326), 6933)) / 1000)::integer AS x,
        floor(ST_Y(ST_Transform(ST_SetSRID(ST_Point(179.95, 0), 4326), 6933)) / 1000)::integer AS y
    `);
    const cell = indexes.rows[0];
    if (!cell) throw new Error('Expected projected grid coordinates.');
    const pilot = await persistClaim({
      competitionMonth: '2026-07-01',
      claimTimestamp: new Date('2026-07-10T12:00:00Z'),
      flightCreatedAt: new Date('2026-07-10T13:00:00Z'),
      x: cell.x,
      y: cell.y,
      displayName: 'Date Line Pilot',
    });

    const result = await createCompetitionGridClaimService(database.db, { cellSize: 1_000 })
      .getViewportLeaderboard({
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
});
