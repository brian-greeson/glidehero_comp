import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createGroupService, GroupError } from '../../src/services/groupService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database?.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

async function addClaimedFlight(input: {
  userId: string;
  sequence: number;
  month: string;
  distanceMeters: number;
  cells: Array<[number, number]>;
}) {
  if (!database) throw new Error('Test database was not initialized.');
  const file = await database.db.execute<{ id: string }>(sql`
    INSERT INTO igc_files (user_id, original_filename, content_type, byte_size, bucket_key)
    VALUES (${input.userId}, ${`flight-${input.sequence}.igc`}, 'application/octet-stream', 10, ${`groups-test/${input.sequence}.igc`})
    RETURNING igc_file_id AS id
  `);
  const flight = await database.db.execute<{ id: string }>(sql`
    INSERT INTO flights (
      user_id, igc_file_id, content_hash, processing_status, processed_at,
      started_at, ended_at, duration_seconds, launch_timezone
    ) VALUES (
      ${input.userId}, ${file.rows[0]!.id}, ${`groups-test-hash-${input.sequence}`}, 'completed', now(),
      ${new Date(`${input.month.slice(0, 7)}-15T12:${String(input.sequence).padStart(2, '0')}:00Z`)},
      ${new Date(`${input.month.slice(0, 7)}-15T13:${String(input.sequence).padStart(2, '0')}:00Z`)}, 3600, 'UTC'
    ) RETURNING flight_id AS id
  `);
  const flightId = flight.rows[0]!.id;
  await database.db.execute(sql`
    INSERT INTO flight_scores (
      flight_id, total_distance_meters, total_distance_metadata,
      five_point_distance_meters, five_point_distance_calc_version, five_point_distance_metadata
    ) VALUES (${flightId}, ${input.distanceMeters}, ${JSON.stringify({})}::jsonb,
      ${input.distanceMeters}, 1, ${JSON.stringify({ points: [] })}::jsonb)
  `);
  for (const [x, y] of input.cells) {
    await database.db.execute(sql`
      INSERT INTO competition_grid_claims (competition_month, x, y, claim_flight, claim_user, claim_timestamp)
      VALUES (${input.month}::date, ${x}, ${y}, ${flightId}, ${input.userId}, now())
    `);
  }
  return flightId;
}

describe('groupService', () => {
  it('enforces invitation lifecycle, full roster counts, owner rules, and deletion cascades', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const owner = await auth.signup({ email: 'owner@example.com', password: 'correct horse battery staple', displayName: 'Owner Pilot' });
    const member = await auth.signup({ email: 'member@example.com', password: 'correct horse battery staple', displayName: 'Member Pilot' });
    const pending = await auth.signup({ email: 'pending@example.com', password: 'correct horse battery staple', displayName: 'Pending Pilot' });
    const service = createGroupService(database.db);

    const group = await service.createGroup({ ownerUserId: owner.user.userId, name: 'Weekend Crew' });
    await service.invite({ groupId: group.groupId, actorUserId: owner.user.userId, userId: member.user.userId });
    await service.invite({ groupId: group.groupId, actorUserId: owner.user.userId, userId: pending.user.userId });

    expect((await service.getProfileGroups(owner.user.userId, '2026-08')).groups[0]?.memberCount).toBe(3);
    expect((await service.getProfileGroups(pending.user.userId, '2026-08')).invitations[0]?.memberCount).toBe(3);
    expect(await service.canView({ groupId: group.groupId, userId: member.user.userId })).toBe(false);

    await service.acceptInvitation({ groupId: group.groupId, userId: member.user.userId });
    expect(await service.canView({ groupId: group.groupId, userId: member.user.userId })).toBe(true);
    await expect(service.acceptInvitation({ groupId: group.groupId, userId: member.user.userId })).rejects.toBeInstanceOf(GroupError);
    await expect(service.leave({ groupId: group.groupId, userId: owner.user.userId })).rejects.toMatchObject({ code: 'conflict' });

    const onboarding = await database.db.execute<{ groupsAt: Date | null }>(sql`
      SELECT groups_at AS "groupsAt" FROM user_onboarding_state WHERE user_id=${member.user.userId}
    `);
    expect(onboarding.rows[0]?.groupsAt).toBeTruthy();

    await service.deleteGroup({ groupId: group.groupId, actorUserId: owner.user.userId });
    expect(await service.canView({ groupId: group.groupId, userId: member.user.userId })).toBe(false);
    const memberships = await database.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM pilot_group_memberships WHERE group_id=${group.groupId}
    `);
    expect(memberships.rows[0]?.count).toBe(0);
  });

  it('counts accepted and pending pilots toward the 200-person capacity', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const owner = await auth.signup({ email: 'capacity-owner@example.com', password: 'correct horse battery staple', displayName: 'Capacity Owner' });
    const extra = await auth.signup({ email: 'capacity-extra@example.com', password: 'correct horse battery staple', displayName: 'Capacity Extra' });
    const service = createGroupService(database.db);
    const group = await service.createGroup({ ownerUserId: owner.user.userId, name: 'Full Group' });
    await database.db.execute(sql`
      WITH added_users AS (
        INSERT INTO users (email)
        SELECT 'capacity-' || value || '@example.com' FROM generate_series(1, 199) AS value
        RETURNING user_id, email
      ), added_profiles AS (
        INSERT INTO profiles (user_id, display_name)
        SELECT user_id, email FROM added_users
        RETURNING user_id
      )
      INSERT INTO pilot_group_memberships (group_id, user_id, status)
      SELECT ${group.groupId}, user_id, 'pending' FROM added_profiles
    `);

    expect((await service.getGroup({ groupId: group.groupId, userId: owner.user.userId })).memberCount).toBe(200);
    await expect(service.invite({ groupId: group.groupId, actorUserId: owner.user.userId, userId: extra.user.userId })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('ranks by claimed cells, breaks ties by longest five-point flight, and recalculates after removal', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const owner = await auth.signup({ email: 'rank-owner@example.com', password: 'correct horse battery staple', displayName: 'Alpine One' });
    const member = await auth.signup({ email: 'rank-member@example.com', password: 'correct horse battery staple', displayName: 'Alpine Two' });
    const service = createGroupService(database.db);
    const group = await service.createGroup({ ownerUserId: owner.user.userId, name: 'Alpine League' });
    await service.invite({ groupId: group.groupId, actorUserId: owner.user.userId, userId: member.user.userId });
    await service.acceptInvitation({ groupId: group.groupId, userId: member.user.userId });
    const month = '2026-08-01';

    await addClaimedFlight({ userId: owner.user.userId, sequence: 1, month, distanceMeters: 20_000, cells: [[1, 1], [1, 2]] });
    const memberFlight = await addClaimedFlight({ userId: member.user.userId, sequence: 2, month, distanceMeters: 30_000, cells: [[2, 1], [2, 2]] });

    const standings = await service.getStandings({ groupId: group.groupId, userId: owner.user.userId, competitionMonth: month });
    expect(standings.map((standing) => ({ name: standing.displayName, rank: standing.rank, cells: standing.claimedCellCount, trophy: standing.trophy }))).toEqual([
      { name: 'Alpine Two', rank: 1, cells: 2, trophy: true },
      { name: 'Alpine One', rank: 2, cells: 2, trophy: false },
    ]);
    expect((await service.listFlights({ groupId: group.groupId, userId: owner.user.userId, competitionMonth: month })).flights.map((flight) => flight.flightId)).toContain(memberFlight);
    await expect(service.listFlights({ groupId: group.groupId, userId: owner.user.userId, competitionMonth: month, cursor: Buffer.from('date|not-a-uuid').toString('base64url') })).rejects.toMatchObject({ code: 'validation' });

    await service.removeMember({ groupId: group.groupId, actorUserId: owner.user.userId, userId: member.user.userId });
    const recalculated = await service.getStandings({ groupId: group.groupId, userId: owner.user.userId, competitionMonth: month });
    expect(recalculated).toEqual([expect.objectContaining({ userId: owner.user.userId, rank: 1, claimedCellCount: 2 })]);
  });
});
