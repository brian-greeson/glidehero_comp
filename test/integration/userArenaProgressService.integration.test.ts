import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { flights, igcFiles, personalGridClaims, userArenaProgress, users } from '../../src/db/schema.js';
import { createUserArenaProgressService } from '../../src/services/userArenaProgressService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>>;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database.pool.query('TRUNCATE TABLE arenas, users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function createArena(
  sourceId: number,
  arenaType: 'launch' | 'general' | 'state' | 'country',
  wkt: string,
  externalId: string | null = null,
) {
  const result = await database.pool.query<{ id: string }>(`INSERT INTO arenas
    (source_id, name, country, country_code, area, arena_type, external_id, claimable_cell_count)
    VALUES ($1, $2, 'Testland', 'TT', ST_Multi(ST_GeomFromText($3, 6933)), $4, $5, $6)
    RETURNING id`, [sourceId, `${arenaType}-${sourceId}`, wkt, arenaType, externalId, arenaType === 'state' || arenaType === 'country' ? null : 4]);
  return result.rows[0]!.id;
}

async function createFlight(userId: string, processingStatus: 'processing' | 'completed' = 'completed') {
  const [file] = await database.db.insert(igcFiles).values({
    userId, originalFilename: 'arena-progress.igc', contentType: 'application/octet-stream', byteSize: 1,
    bucketKey: `arena-progress/${crypto.randomUUID()}`,
  }).returning({ id: igcFiles.id });
  const [flight] = await database.db.insert(flights).values({
    userId, igcFileId: file!.id, contentHash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    processingStatus, launchLatitude: 0, launchLongitude: 0, launchTimezone: 'UTC',
  }).returning({ id: flights.id });
  return flight!.id;
}

describe('userArenaProgressService', () => {
  it('finds affected users for canonical cells and completed Launch origins', async () => {
    const [cellUser, launchUser, unrelatedUser] = await database.db.insert(users).values([
      { email: `arena-progress-affected-cell-${crypto.randomUUID()}@example.com` },
      { email: `arena-progress-affected-launch-${crypto.randomUUID()}@example.com` },
      { email: `arena-progress-affected-unrelated-${crypto.randomUUID()}@example.com` },
    ]).returning({ id: users.id });
    const cellUserId = cellUser!.id;
    const launchUserId = launchUser!.id;
    const unrelatedUserId = unrelatedUser!.id;
    const cellFlightId = await createFlight(cellUserId, 'processing');
    const launchFlightId = await createFlight(launchUserId);
    await database.db.insert(personalGridClaims).values({
      claimUser: cellUserId, claimFlight: cellFlightId, x: 0, y: 0, claimTimestamp: new Date(),
    });

    const generalId = await createArena(20, 'general', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))');
    const stateA = await createArena(21, 'state', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 'state-a');
    const stateB = await createArena(22, 'state', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 'state-b');
    const launchId = await createArena(23, 'launch', 'POLYGON((-100 -100,100 -100,100 100,-100 100,-100 -100))');
    const launchCellId = await createArena(24, 'launch', 'POLYGON((400 400,600 400,600 600,400 600,400 400))');

    const service = createUserArenaProgressService(database.db, { cellSize: 1_000 });
    await database.db.transaction(async (transaction) => {
      expect(await service.findUsersAffectedByArenasInTransaction(transaction, [])).toEqual([]);
      expect(await service.findUsersAffectedByArenasInTransaction(transaction, [stateB])).toEqual([]);
      expect(await service.findUsersAffectedByArenasInTransaction(transaction, [stateA, generalId])).toEqual([cellUserId]);
      expect(await service.findUsersAffectedByArenasInTransaction(transaction, [launchId])).toEqual([launchUserId]);
      expect(await service.findUsersAffectedByArenasInTransaction(transaction, [launchCellId])).toEqual([cellUserId]);
      expect(await service.findUsersAffectedByArenasInTransaction(transaction, [launchId, generalId, launchId])).toEqual([cellUserId, launchUserId].sort());
    });
    expect(unrelatedUserId).not.toBe(cellUserId);
  });

  it('deduplicates rebuild users and rebuilds all users while removing stale rows', async () => {
    const [first, second] = await database.db.insert(users).values([
      { email: `arena-progress-rebuild-first-${crypto.randomUUID()}@example.com` },
      { email: `arena-progress-rebuild-second-${crypto.randomUUID()}@example.com` },
    ]).returning({ id: users.id });
    const firstId = first!.id;
    const secondId = second!.id;
    const staleId = await createArena(24, 'general', 'POLYGON((5000 5000,6000 5000,6000 6000,5000 6000,5000 5000))');
    await database.db.insert(userArenaProgress).values([
      { userId: firstId, arenaId: staleId, claimedCellCount: 2, visited: false },
      { userId: secondId, arenaId: staleId, claimedCellCount: 3, visited: false },
    ]);
    const service = createUserArenaProgressService(database.db, { cellSize: 1_000 });

    const rebuilt = await database.db.transaction((transaction) => service.rebuildUsersInTransaction(transaction, [secondId, firstId, secondId]));
    expect(rebuilt.map((entry) => entry.userId)).toEqual([firstId, secondId].sort());
    expect(rebuilt.every((entry) => entry.snapshot.rows.length === 0)).toBe(true);
    expect(await database.db.select().from(userArenaProgress)).toHaveLength(0);

    await database.db.insert(userArenaProgress).values({ userId: firstId, arenaId: staleId, claimedCellCount: 1, visited: false });
    const all = await database.db.transaction((transaction) => service.rebuildAllInTransaction(transaction));
    expect(all.map((entry) => entry.userId)).toEqual([firstId, secondId].sort());
    expect(await database.db.select().from(userArenaProgress)).toHaveLength(0);
  });

  it('rebuilds canonical claims and visits, resolves State/Country overlap, and removes stale rows', async () => {
    const [user] = await database.db.insert(users).values({ email: `arena-progress-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const userId = user!.id;
    const flightId = await createFlight(userId);
    const duplicateFlightId = await createFlight(userId);
    const launchId = await createArena(1, 'launch', 'POLYGON((-100 -100,100 -100,100 100,-100 100,-100 -100))');
    const generalId = await createArena(2, 'general', 'POLYGON((0 0,2000 0,2000 2000,0 2000,0 0))');
    const stateA = await createArena(3, 'state', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 'state-a');
    const stateB = await createArena(4, 'state', 'POLYGON((-500 -500,1500 -500,1500 1500,-500 1500,-500 -500))', 'state-b');
    const countryA = await createArena(5, 'country', 'POLYGON((0 0,1000 0,1000 1000,0 1000,0 0))', 'country-a');
    const countryB = await createArena(6, 'country', 'POLYGON((-500 -500,1500 -500,1500 1500,-500 1500,-500 -500))', 'country-b');
    const staleId = await createArena(7, 'general', 'POLYGON((5000 5000,6000 5000,6000 6000,5000 6000,5000 5000))');

    await database.db.insert(personalGridClaims).values([
      { claimUser: userId, claimFlight: flightId, x: 0, y: 0, claimTimestamp: new Date() },
      { claimUser: userId, claimFlight: duplicateFlightId, x: 0, y: 0, claimTimestamp: new Date() },
    ]);
    await database.db.insert(userArenaProgress).values({ userId, arenaId: staleId, claimedCellCount: 12, visited: false });

    const service = createUserArenaProgressService(database.db, { cellSize: 1_000 });
    const snapshot = await database.db.transaction((transaction) => service.rebuildInTransaction(transaction, userId));
    expect(snapshot.lifetimeUniqueCellCount).toBe(1);
    expect(snapshot.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: launchId, claimedCells: 0, visited: true, firstFromLaunch: false, tagged: false }),
      expect.objectContaining({ id: generalId, claimedCells: 1, visited: false }),
      expect.objectContaining({ id: stateA, claimedCells: 1 }),
      expect.objectContaining({ id: countryA, claimedCells: 1 }),
    ]));
    expect(snapshot.rows.some((row) => row.id === stateB || row.id === countryB || row.id === staleId)).toBe(false);

    const read = await service.getSnapshot(userId);
    expect(read).toEqual(snapshot);
    const rows = await database.pool.query('SELECT arena_id FROM user_arena_progress WHERE user_id = $1', [userId]);
    expect(rows.rows.map((row) => row.arena_id).sort()).toEqual([generalId, launchId, stateA, countryA].sort());
  });

  it('increments only new Personal cells, preserves exclusive regional ownership, and returns current-flight facts', async () => {
    const [user] = await database.db.insert(users).values({ email: `arena-progress-increment-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    const userId = user!.id;
    const firstFlightId = await createFlight(userId, 'processing');
    const secondFlightId = await createFlight(userId);
    const repeatedFlightId = await createFlight(userId);
    const launchId = await createArena(10, 'launch', 'POLYGON((0 0,3000 0,3000 3000,0 3000,0 0))');
    const generalId = await createArena(11, 'general', 'POLYGON((0 0,4000 0,4000 4000,0 4000,0 0))');
    const stateA = await createArena(12, 'state', 'POLYGON((0 0,3000 0,3000 3000,0 3000,0 0))', 'state-a');
    const stateB = await createArena(13, 'state', 'POLYGON((0 0,3000 0,3000 3000,0 3000,0 0))', 'state-b');
    const countryA = await createArena(14, 'country', 'POLYGON((0 0,3000 0,3000 3000,0 3000,0 0))', 'country-a');
    const countryB = await createArena(15, 'country', 'POLYGON((0 0,3000 0,3000 3000,0 3000,0 0))', 'country-b');

    await database.db.insert(personalGridClaims).values([
      { claimUser: userId, claimFlight: firstFlightId, x: 0, y: 0, claimTimestamp: new Date() },
      { claimUser: userId, claimFlight: firstFlightId, x: 1, y: 0, claimTimestamp: new Date() },
    ]);

    const service = createUserArenaProgressService(database.db, { cellSize: 1_000 });
    const first = await database.db.transaction((transaction) => service.applyFlightInTransaction(transaction, {
      userId,
      flightId: firstFlightId,
      previousLifetimeUniqueCellCount: 0,
      lifetimeUniqueCellCount: 2,
    }));
    expect(first.before.lifetimeUniqueCellCount).toBe(0);
    expect(first.after.lifetimeUniqueCellCount).toBe(2);
    expect(first.after.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: launchId, claimedCells: 2, visited: true, firstFromLaunch: true, tagged: true }),
      expect.objectContaining({ id: generalId, claimedCells: 2 }),
      expect.objectContaining({ id: stateA, claimedCells: 2 }),
      expect.objectContaining({ id: countryA, claimedCells: 2 }),
    ]));
    expect(first.after.rows.some((row) => row.id === stateB || row.id === countryB)).toBe(false);

    await database.db.insert(personalGridClaims).values([
      { claimUser: userId, claimFlight: secondFlightId, x: 0, y: 0, claimTimestamp: new Date() },
      { claimUser: userId, claimFlight: secondFlightId, x: 2, y: 0, claimTimestamp: new Date() },
    ]);

    const second = await database.db.transaction((transaction) => service.applyFlightInTransaction(transaction, {
      userId,
      flightId: secondFlightId,
      previousLifetimeUniqueCellCount: 2,
      lifetimeUniqueCellCount: 3,
    }));
    expect(second.before.lifetimeUniqueCellCount).toBe(2);
    expect(second.before.rows.find((row) => row.id === launchId)?.firstFromLaunch).toBe(false);
    expect(second.after.lifetimeUniqueCellCount).toBe(3);
    expect(second.after.rows.find((row) => row.id === generalId)?.claimedCells).toBe(3);

    await database.db.insert(personalGridClaims).values([
      { claimUser: userId, claimFlight: repeatedFlightId, x: 0, y: 0, claimTimestamp: new Date() },
    ]);

    const repeated = await database.db.transaction((transaction) => service.applyFlightInTransaction(transaction, {
      userId,
      flightId: repeatedFlightId,
      previousLifetimeUniqueCellCount: 3,
      lifetimeUniqueCellCount: 3,
    }));
    expect(repeated.after.rows.find((row) => row.id === generalId)?.claimedCells).toBe(3);

    const rebuilt = await database.db.transaction((transaction) => service.rebuildInTransaction(transaction, userId));
    expect(rebuilt.lifetimeUniqueCellCount).toBe(repeated.after.lifetimeUniqueCellCount);
    expect(rebuilt.rows.map(({ id, claimedCells, visited }) => ({ id, claimedCells, visited })))
      .toEqual(repeated.after.rows.map(({ id, claimedCells, visited }) => ({ id, claimedCells, visited })));
  });
});
