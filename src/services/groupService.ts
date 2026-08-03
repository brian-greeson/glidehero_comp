import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

type Executor = Pick<Database, 'execute'>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type GroupSummary = { groupId: string; name: string; ownerUserId: string; memberCount: number; capacity: number };
export type GroupInvitation = GroupSummary & { invitedAt: Date; ownerDisplayName: string };
export type GroupStanding = {
  userId: string; displayName: string; territoryColor: string; claimedCellCount: number; bestFivePointDistanceMeters: number | null;
  rank: number | null; trophy: boolean;
};
export type GroupMember = { userId: string; displayName: string; territoryColor: string; status: 'accepted'|'pending'; isOwner: boolean };
export type GroupFlight = {
  flightId: string; pilotUserId: string; pilotName: string; startedAt: Date;
  launchTimezone: string | null; fivePointDistanceMeters: number | null; durationSeconds: number | null;
};

export interface GroupService {
  createGroup(input: { ownerUserId: string; name: string }): Promise<GroupSummary>;
  deleteGroup(input: { groupId: string; actorUserId: string }): Promise<void>;
  invite(input: { groupId: string; actorUserId: string; userId: string }): Promise<void>;
  cancelInvitation(input: { groupId: string; actorUserId: string; userId: string }): Promise<void>;
  acceptInvitation(input: { groupId: string; userId: string }): Promise<void>;
  declineInvitation(input: { groupId: string; userId: string }): Promise<void>;
  leave(input: { groupId: string; userId: string }): Promise<void>;
  removeMember(input: { groupId: string; actorUserId: string; userId: string }): Promise<void>;
  searchPilots(input: { query: string; excludeUserId?: string; excludeGroupId?: string; limit?: number }): Promise<Array<{ userId: string; displayName: string }>>;
  canView(input: { groupId: string; userId: string }): Promise<boolean>;
  getProfileGroups(userId: string, competitionMonth?: string): Promise<{ groups: Array<GroupSummary & { rank: number | null; claimedCellCount: number; bestFivePointDistanceMeters: number | null; trophy: boolean }>; invitations: GroupInvitation[] }>;
  getGroup(input: { groupId: string; userId: string }): Promise<GroupSummary>;
  getMembers(input: { groupId: string; userId: string }): Promise<GroupMember[]>;
  getStandings(input: { groupId: string; userId: string; competitionMonth: string }): Promise<GroupStanding[]>;
  listFlights(input: { groupId: string; userId: string; competitionMonth: string; pilotUserId?: string; cursor?: string; limit?: number }): Promise<{ flights: GroupFlight[]; nextCursor: string | null }>;
  getFlightTrack(input: { groupId: string; userId: string; flightId: string; competitionMonth: string }): Promise<Record<string, unknown> | null>;
}

export class GroupError extends Error { constructor(public readonly code: 'not_found'|'forbidden'|'conflict'|'validation', message: string) { super(message); this.name='GroupError'; } }
function denied(): never { throw new GroupError('forbidden', 'Group access denied.'); }
function cleanName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 80) throw new GroupError('validation', 'Group name must be between 1 and 80 characters.');
  return value;
}
function canonicalMonth(value: string): string {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value);
  if (!match) throw new GroupError('validation', 'Competition month must be YYYY-MM-01.');
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new GroupError('validation', 'Competition month is invalid.');
  return `${match[1]}-${match[2]}-01`;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createGroupService(database: Database): GroupService {
  async function membership(executor: Executor, groupId: string, userId: string, acceptedOnly = false) {
    const result = await executor.execute<{ status: string; owner_user_id: string }>(sql`
      SELECT m.status, g.owner_user_id FROM pilot_group_memberships m
      JOIN pilot_groups g ON g.group_id = m.group_id
      WHERE m.group_id = ${groupId} AND m.user_id = ${userId}
      ${acceptedOnly ? sql`AND m.status = 'accepted'` : sql``}
    `);
    return result.rows[0];
  }
  async function requireOwner(executor: Executor, groupId: string, userId: string) {
    const row = await membership(executor, groupId, userId);
    if (!row || row.owner_user_id !== userId) denied();
  }
  async function requireMember(executor: Executor, groupId: string, userId: string) {
    if (!(await membership(executor, groupId, userId, true))) denied();
  }
  async function summary(executor: Executor, groupId: string): Promise<GroupSummary> {
    const result = await executor.execute<GroupSummary>(sql`
      SELECT g.group_id AS "groupId", g.name, g.owner_user_id AS "ownerUserId",
        COUNT(*) FILTER (WHERE m.status IN ('accepted','pending'))::int AS "memberCount", 200 AS capacity
      FROM pilot_groups g LEFT JOIN pilot_group_memberships m ON m.group_id = g.group_id
      WHERE g.group_id = ${groupId} GROUP BY g.group_id
    `);
    if (!result.rows[0]) throw new GroupError('not_found', 'Group not found.');
    return result.rows[0];
  }
  const service: GroupService = {
    async createGroup({ ownerUserId, name }) {
      return database.transaction(async (tx) => {
        const rows = await tx.execute<{ group_id: string }>(sql`INSERT INTO pilot_groups (owner_user_id,name) VALUES (${ownerUserId},${cleanName(name)}) RETURNING group_id`);
        const groupId = rows.rows[0]!.group_id;
        await tx.execute(sql`INSERT INTO pilot_group_memberships (group_id,user_id,status,accepted_at) VALUES (${groupId},${ownerUserId},'accepted',now())`);
        await tx.execute(sql`INSERT INTO user_onboarding_state (user_id,groups_at,created_at,updated_at) VALUES (${ownerUserId},now(),now(),now()) ON CONFLICT (user_id) DO UPDATE SET groups_at=COALESCE(user_onboarding_state.groups_at,now()),updated_at=now()`);
        return summary(tx, groupId);
      });
    },
    async deleteGroup({ groupId, actorUserId }) { await database.transaction(async tx => { await requireOwner(tx, groupId, actorUserId); await tx.execute(sql`DELETE FROM pilot_groups WHERE group_id=${groupId}`); }); },
    async invite({ groupId, actorUserId, userId }) {
      await database.transaction(async tx => {
        await requireOwner(tx, groupId, actorUserId);
        if (actorUserId === userId) throw new GroupError('conflict', 'Owner is already a member.');
        const user = await tx.execute(sql`SELECT user_id FROM users WHERE user_id=${userId}`); if (!user.rows[0]) throw new GroupError('not_found', 'Pilot not found.');
        await tx.execute(sql`SELECT group_id FROM pilot_groups WHERE group_id=${groupId} FOR UPDATE`);
        const existing = await tx.execute(sql`SELECT status FROM pilot_group_memberships WHERE group_id=${groupId} AND user_id=${userId}`); if (existing.rows[0]) throw new GroupError('conflict', 'Pilot already belongs to or is invited to this group.');
        const count = await tx.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM pilot_group_memberships WHERE group_id=${groupId}`);
        if (Number(count.rows[0]?.count ?? 0) >= 200) throw new GroupError('conflict', 'Group is full.');
        await tx.execute(sql`INSERT INTO pilot_group_memberships (group_id,user_id,status) VALUES (${groupId},${userId},'pending')`);
      });
    },
    async cancelInvitation({ groupId, actorUserId, userId }) { await database.transaction(async tx => { await requireOwner(tx, groupId, actorUserId); await tx.execute(sql`DELETE FROM pilot_group_memberships WHERE group_id=${groupId} AND user_id=${userId} AND status='pending'`); }); },
    async acceptInvitation({ groupId, userId }) { await database.transaction(async tx => { const accepted = await tx.execute(sql`UPDATE pilot_group_memberships SET status='accepted',accepted_at=now(),updated_at=now() WHERE group_id=${groupId} AND user_id=${userId} AND status='pending' RETURNING group_id`); if (!accepted.rows[0]) denied(); await tx.execute(sql`INSERT INTO user_onboarding_state (user_id,groups_at,created_at,updated_at) VALUES (${userId},now(),now(),now()) ON CONFLICT (user_id) DO UPDATE SET groups_at=COALESCE(user_onboarding_state.groups_at,now()),updated_at=now()`); }); },
    async declineInvitation({ groupId, userId }) { await database.execute(sql`DELETE FROM pilot_group_memberships WHERE group_id=${groupId} AND user_id=${userId} AND status='pending'`); },
    async leave({ groupId, userId }) { await database.transaction(async tx => { const row = await membership(tx, groupId, userId, true); if (!row) denied(); if (row.owner_user_id === userId) throw new GroupError('conflict', 'Group owner cannot leave.'); await tx.execute(sql`DELETE FROM pilot_group_memberships WHERE group_id=${groupId} AND user_id=${userId}`); }); },
    async removeMember({ groupId, actorUserId, userId }) { await database.transaction(async tx => { await requireOwner(tx, groupId, actorUserId); if (actorUserId === userId) throw new GroupError('conflict', 'Owner cannot be removed.'); await tx.execute(sql`DELETE FROM pilot_group_memberships WHERE group_id=${groupId} AND user_id=${userId}`); }); },
    async searchPilots({ query, excludeUserId, excludeGroupId, limit = 10 }) { const result = await database.execute<{ userId: string; displayName: string }>(sql`SELECT p.user_id AS "userId", p.display_name AS "displayName" FROM profiles p WHERE p.display_name ILIKE ${`%${query.trim()}%`} ${excludeUserId ? sql`AND p.user_id <> ${excludeUserId}` : sql``} ${excludeGroupId ? sql`AND NOT EXISTS (SELECT 1 FROM pilot_group_memberships m WHERE m.group_id=${excludeGroupId} AND m.user_id=p.user_id)` : sql``} ORDER BY lower(p.display_name), p.user_id LIMIT ${Math.min(limit, 25)}`); return result.rows; },
    async canView({ groupId, userId }) { return Boolean(await membership(database, groupId, userId, true)); },
    async getProfileGroups(userId, competitionMonth = new Date().toISOString().slice(0, 7)) {
      const groups = await database.execute(sql`SELECT g.group_id AS "groupId",g.name,g.owner_user_id AS "ownerUserId",(SELECT COUNT(*)::int FROM pilot_group_memberships roster WHERE roster.group_id=g.group_id) AS "memberCount",200 AS capacity FROM pilot_group_memberships m JOIN pilot_groups g ON g.group_id=m.group_id WHERE m.user_id=${userId} AND m.status='accepted'`);
      const invitations = await database.execute(sql`SELECT g.group_id AS "groupId",g.name,g.owner_user_id AS "ownerUserId",owner.display_name AS "ownerDisplayName",(SELECT COUNT(*)::int FROM pilot_group_memberships roster WHERE roster.group_id=g.group_id) AS "memberCount",200 AS capacity,m.invited_at AS "invitedAt" FROM pilot_group_memberships m JOIN pilot_groups g ON g.group_id=m.group_id JOIN profiles owner ON owner.user_id=g.owner_user_id WHERE m.user_id=${userId} AND m.status='pending'`);
      const enriched = await Promise.all((groups.rows as GroupSummary[]).map(async g => { const rows = await service.getStandings({ groupId:g.groupId,userId,competitionMonth }); const me=rows.find(r=>r.userId===userId); return {...g,rank:me?.rank??null,claimedCellCount:me?.claimedCellCount??0,bestFivePointDistanceMeters:me?.bestFivePointDistanceMeters??null,trophy:me?.trophy??false}; }));
      return { groups: enriched, invitations: invitations.rows as GroupInvitation[] };
    },
    async getGroup({ groupId, userId }) { await requireMember(database, groupId, userId); return summary(database, groupId); },
    async getMembers({ groupId, userId }) {
      const actor = await membership(database, groupId, userId, true);
      if (!actor) denied();
      const result = await database.execute<GroupMember & { ownerUserId: string }>(sql`
        SELECT m.user_id AS "userId", p.display_name AS "displayName", p.territory_color AS "territoryColor", m.status,
          (m.user_id = g.owner_user_id) AS "isOwner", g.owner_user_id AS "ownerUserId"
        FROM pilot_group_memberships m
        JOIN pilot_groups g ON g.group_id = m.group_id
        JOIN profiles p ON p.user_id = m.user_id
        WHERE m.group_id = ${groupId} AND (m.status = 'accepted' OR g.owner_user_id = ${userId})
        ORDER BY CASE WHEN m.status = 'accepted' THEN 0 ELSE 1 END, lower(p.display_name), m.user_id
      `);
      return result.rows.map((row) => ({ userId: row.userId, displayName: row.displayName, territoryColor: row.territoryColor, status: row.status, isOwner: row.isOwner }));
    },
    async getStandings({ groupId, userId, competitionMonth }) {
      await requireMember(database, groupId, userId);
      competitionMonth = canonicalMonth(competitionMonth);
      const result = await database.execute<GroupStanding & { cells: number; distance: number | null; rank_value: number | null }>(sql`
        WITH members AS (SELECT m.user_id FROM pilot_group_memberships m WHERE m.group_id=${groupId} AND m.status='accepted'),
        cells AS (SELECT c.claim_user AS user_id,COUNT(DISTINCT (c.x,c.y))::int AS cells FROM competition_grid_claims c JOIN members m ON m.user_id=c.claim_user WHERE c.competition_month=${competitionMonth}::date GROUP BY c.claim_user),
        distances AS (SELECT f.user_id,MAX(s.five_point_distance_meters)::double precision AS distance FROM flights f JOIN flight_scores s ON s.flight_id=f.flight_id JOIN members m ON m.user_id=f.user_id WHERE f.processing_status='completed' AND f.started_at IS NOT NULL AND EXISTS (SELECT 1 FROM competition_grid_claims c WHERE c.claim_flight=f.flight_id AND c.competition_month=${competitionMonth}::date) GROUP BY f.user_id),
        ranked AS (SELECT m.user_id,COALESCE(c.cells,0)::int AS cells,d.distance,RANK() OVER (ORDER BY COALESCE(c.cells,0) DESC,d.distance DESC NULLS LAST)::int AS rank_value FROM members m LEFT JOIN cells c ON c.user_id=m.user_id LEFT JOIN distances d ON d.user_id=m.user_id)
        SELECT r.user_id AS "userId",p.display_name AS "displayName",p.territory_color AS "territoryColor",r.cells,r.distance,r.rank_value, (r.distance IS NOT NULL AND r.distance=(MAX(r.distance) OVER ())) AS trophy FROM ranked r JOIN profiles p ON p.user_id=r.user_id ORDER BY r.rank_value NULLS LAST,lower(p.display_name),r.user_id
      `);
      return result.rows.map((r:any)=>({userId:r.userId,displayName:r.displayName,territoryColor:r.territoryColor,claimedCellCount:r.cells,bestFivePointDistanceMeters:r.distance,rank:r.cells===0&&r.distance===null?null:r.rank_value,trophy:Boolean(r.trophy)}));
    },
    async listFlights({ groupId, userId, competitionMonth, pilotUserId, cursor, limit = 25 }) {
      competitionMonth = canonicalMonth(competitionMonth);
      await requireMember(database, groupId, userId);
      let cursorDate: Date | undefined;
      let cursorId: string | undefined;
      if (cursor) {
        const [date, id, ...extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
        if (!date || !id || extra.length || Number.isNaN(Date.parse(date)) || !uuidPattern.test(id)) {
          throw new GroupError('validation', 'Invalid flight cursor.');
        }
        cursorDate = new Date(date);
        cursorId = id;
      }
      const result = await database.execute<GroupFlight>(sql`SELECT f.flight_id AS "flightId",f.user_id AS "pilotUserId",p.display_name AS "pilotName",f.started_at AS "startedAt",f.launch_timezone AS "launchTimezone",s.five_point_distance_meters AS "fivePointDistanceMeters",f.duration_seconds AS "durationSeconds" FROM flights f JOIN profiles p ON p.user_id=f.user_id LEFT JOIN flight_scores s ON s.flight_id=f.flight_id WHERE f.processing_status='completed' AND f.started_at IS NOT NULL AND EXISTS (SELECT 1 FROM pilot_group_memberships m WHERE m.group_id=${groupId} AND m.user_id=f.user_id AND m.status='accepted') AND EXISTS (SELECT 1 FROM competition_grid_claims c WHERE c.claim_flight=f.flight_id AND c.competition_month=${competitionMonth}::date) ${pilotUserId ? sql`AND f.user_id=${pilotUserId}` : sql``} ${cursorDate ? sql`AND (f.started_at, f.flight_id) < (${cursorDate},${cursorId}::uuid)` : sql``} ORDER BY f.started_at DESC,f.flight_id DESC LIMIT ${Math.min(limit,100)}`);
      const rows = result.rows;
      const last = rows.at(-1);
      return {
        flights: rows,
        nextCursor: rows.length === Math.min(limit, 100) && last?.startedAt && last?.flightId
          ? Buffer.from(`${new Date(last.startedAt).toISOString()}|${last.flightId}`).toString('base64url')
          : null,
      };
    },
    async getFlightTrack({ groupId,userId,flightId,competitionMonth }) { competitionMonth=canonicalMonth(competitionMonth); await requireMember(database,groupId,userId); const result=await database.execute(sql`SELECT f.flight_id AS "flightId",f.user_id AS "pilotUserId",ST_AsGeoJSON(ST_MakeLine(ST_SetSRID(ST_MakePoint(tp.longitude,tp.latitude),4326) ORDER BY tp.sequence_number))::jsonb AS geometry FROM flights f JOIN track_points tp ON tp.flight_id=f.flight_id WHERE f.flight_id=${flightId} AND EXISTS (SELECT 1 FROM pilot_group_memberships m WHERE m.group_id=${groupId} AND m.user_id=f.user_id AND m.status='accepted') AND EXISTS (SELECT 1 FROM competition_grid_claims c WHERE c.claim_flight=f.flight_id AND c.competition_month=${competitionMonth}::date) GROUP BY f.flight_id,f.user_id`); return (result.rows[0] as Record<string,unknown>|undefined)??null; },
  };
  return service;
}
