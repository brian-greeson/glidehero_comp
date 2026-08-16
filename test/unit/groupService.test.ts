import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { createGroupService } from '../../src/services/groupService.js';

describe('group service member read model', () => {
  it('returns lightweight accepted group options in query order', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [
      { groupId: 'group-2', name: 'alpine' },
      { groupId: 'group-1', name: 'Weekend XC' },
    ] });
    const service = createGroupService({ execute } as unknown as Database);

    await expect(service.listAcceptedGroupOptions('pilot')).resolves.toEqual([
      { groupId: 'group-2', name: 'alpine' },
      { groupId: 'group-1', name: 'Weekend XC' },
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it('loads profile standings for every group in one aggregate query', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { groupId: 'group-1', name: 'One', ownerUserId: 'pilot', memberCount: 2, capacity: 200, rank: 1, claimedCellCount: 7, bestFivePointDistanceMeters: 42_000, trophy: true },
        { groupId: 'group-2', name: 'Two', ownerUserId: 'other', memberCount: 3, capacity: 200, rank: null, claimedCellCount: 0, bestFivePointDistanceMeters: null, trophy: false },
      ] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createGroupService({ execute } as unknown as Database);

    await expect(service.getProfileGroups('pilot', '2026-08')).resolves.toEqual({
      groups: [
        { groupId: 'group-1', name: 'One', ownerUserId: 'pilot', memberCount: 2, capacity: 200, rank: 1, claimedCellCount: 7, bestFivePointDistanceMeters: 42_000, trophy: true },
        { groupId: 'group-2', name: 'Two', ownerUserId: 'other', memberCount: 3, capacity: 200, rank: null, claimedCellCount: 0, bestFivePointDistanceMeters: null, trophy: false },
      ],
      invitations: [],
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('authorizes a non-owner group page once and does not load its management roster', async () => {
    const group = { groupId: 'group', name: 'Weekend XC', ownerUserId: 'owner', memberCount: 2, capacity: 200 };
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'owner' }] })
      .mockResolvedValueOnce({ rows: [group] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const service = createGroupService({ execute } as unknown as Database);

    await expect(service.getPage({ groupId: 'group', userId: 'member', competitionMonth: '2026-08' })).resolves.toEqual({
      group,
      standingsPage: { standings: [], nextOffset: null },
      pilots: [],
      flightPage: { flights: [], nextCursor: null },
      members: undefined,
    });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('loads the management roster as part of an owner group page', async () => {
    const group = { groupId: 'group', name: 'Weekend XC', ownerUserId: 'owner', memberCount: 2, capacity: 200 };
    const owner = { userId: 'owner', displayName: 'Owner', territoryColor: '#1769AA', status: 'accepted' as const, isOwner: true, ownerUserId: 'owner' };
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'owner' }] })
      .mockResolvedValueOnce({ rows: [group] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [owner] });
    const service = createGroupService({ execute } as unknown as Database);

    await expect(service.getPage({ groupId: 'group', userId: 'owner', competitionMonth: '2026-08' })).resolves.toEqual({
      group,
      standingsPage: { standings: [], nextOffset: null },
      pilots: [{ userId: 'owner', displayName: 'Owner', territoryColor: '#1769AA' }],
      flightPage: { flights: [], nextCursor: null },
      members: [{ userId: 'owner', displayName: 'Owner', territoryColor: '#1769AA', status: 'accepted', isOwner: true }],
    });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('returns only a standings page, a lookahead offset, and the requested current pilot', async () => {
    const first = { userId: 'first', displayName: 'First', territoryColor: '#111111', cells: 5, distance: 20_000, rank_value: 1, trophy: true, position: 1 };
    const current = { userId: 'current', displayName: 'Current', territoryColor: '#222222', cells: 1, distance: 10_000, rank_value: 30, trophy: false, position: 30 };
    const lookahead = { userId: 'lookahead', displayName: 'Lookahead', territoryColor: '#333333', cells: 0, distance: null, rank_value: 31, trophy: false, position: 26 };
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'owner' }] })
      .mockResolvedValueOnce({ rows: [first, lookahead, current] });
    const service = createGroupService({ execute } as unknown as Database);

    await expect(service.getStandingsPage({
      groupId: 'group', userId: 'current', competitionMonth: '2026-08', limit: 25, includeUserId: 'current',
    })).resolves.toEqual({
      standings: [
        expect.objectContaining({ userId: 'first', rank: 1 }),
        expect.objectContaining({ userId: 'current', rank: 30 }),
      ],
      nextOffset: 25,
    });
  });

  it('returns accepted members to an accepted member and hides pending invites', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'owner' }] })
      .mockResolvedValueOnce({ rows: [
        { userId: 'owner', displayName: 'Owner', territoryColor: '#1769AA', status: 'accepted', isOwner: true, ownerUserId: 'owner' },
        { userId: 'member', displayName: 'Member', territoryColor: '#1769AA', status: 'accepted', isOwner: false, ownerUserId: 'owner' },
      ] });
    const service = createGroupService({ execute } as unknown as Database);
    await expect(service.getMembers({ groupId: 'group', userId: 'member' })).resolves.toEqual([
      { userId: 'owner', displayName: 'Owner', territoryColor: '#1769AA', status: 'accepted', isOwner: true },
      { userId: 'member', displayName: 'Member', territoryColor: '#1769AA', status: 'accepted', isOwner: false },
    ]);
  });

  it('includes pending invitations for the owner', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'owner' }] })
      .mockResolvedValueOnce({ rows: [
        { userId: 'invitee', displayName: 'Invitee', territoryColor: '#1769AA', status: 'pending', isOwner: false, ownerUserId: 'owner' },
      ] });
    const service = createGroupService({ execute } as unknown as Database);
    await expect(service.getMembers({ groupId: 'group', userId: 'owner' })).resolves.toEqual([
      { userId: 'invitee', displayName: 'Invitee', territoryColor: '#1769AA', status: 'pending', isOwner: false },
    ]);
  });

  it('rejects non-members without leaking roster data', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const service = createGroupService({ execute } as unknown as Database);
    await expect(service.getMembers({ groupId: 'group', userId: 'outsider' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('only returns a flight cursor when a lookahead row exists', async () => {
    const first = {
      flightId: '00000000-0000-4000-8000-000000000002',
      pilotUserId: 'pilot',
      pilotName: 'Pilot',
      startedAt: new Date('2026-08-15T12:02:00Z'),
      launchTimezone: 'UTC',
      fivePointDistanceMeters: 20_000,
      durationSeconds: 3_600,
    };
    const second = { ...first, flightId: '00000000-0000-4000-8000-000000000001', startedAt: new Date('2026-08-15T12:01:00Z') };
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'pilot' }] })
      .mockResolvedValueOnce({ rows: [first, second] })
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'pilot' }] })
      .mockResolvedValueOnce({ rows: [first] });
    const service = createGroupService({ execute } as unknown as Database);

    const pageWithMore = await service.listFlights({ groupId: 'group', userId: 'pilot', competitionMonth: '2026-08', limit: 1 });
    expect(pageWithMore.flights).toEqual([first]);
    expect(pageWithMore.nextCursor).toBe(Buffer.from(`${first.startedAt.toISOString()}|${first.flightId}`).toString('base64url'));

    const exactPage = await service.listFlights({ groupId: 'group', userId: 'pilot', competitionMonth: '2026-08', limit: 1 });
    expect(exactPage).toEqual({ flights: [first], nextCursor: null });
  });

  it('maps an unknown invite pilot to not_found', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ status: 'accepted', owner_user_id: 'owner' }] })
      .mockResolvedValueOnce({ rows: [] });
    const database = {
      execute,
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ execute }),
    };
    const service = createGroupService(database as unknown as Database);
    await expect(service.invite({ groupId: 'group', actorUserId: 'owner', userId: 'missing' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });
});
