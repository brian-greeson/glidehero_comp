import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/client.js';
import { createGroupService } from '../../src/services/groupService.js';

describe('group service member read model', () => {
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
