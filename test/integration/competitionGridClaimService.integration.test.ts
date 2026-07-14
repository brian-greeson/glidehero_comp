import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { competitionGridClaims, flights, igcFiles, users } from '../../src/db/schema.js';
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
};

async function persistClaim(input: PersistClaimInput): Promise<{ userId: string; flightId: string }> {
  const [user] = await database.db.insert(users).values({
    email: `pilot-${crypto.randomUUID()}@example.com`,
  }).returning({ id: users.id });
  if (!user) throw new Error('User insert returned no row.');

  const [igcFile] = await database.db.insert(igcFiles).values({
    userId: user.id,
    originalFilename: 'competition.igc',
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
    claimUser: user.id,
    claimTimestamp: input.claimTimestamp,
  });

  return { userId: user.id, flightId: flight.id };
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
    expect(july.features.flatMap((feature) => feature.geometry.coordinates).flat(2)
      .every((coordinate) => Math.abs(coordinate) <= 180)).toBe(true);
    expect(august).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
