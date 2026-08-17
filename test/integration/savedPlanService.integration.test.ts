import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthService } from '../../src/services/authService.js';
import { createGroupService } from '../../src/services/groupService.js';
import { createSavedPlanService, SavedPlanError } from '../../src/services/savedPlanService.js';
import { resetAndMigrateTestDatabase } from './database.js';

let database: Awaited<ReturnType<typeof resetAndMigrateTestDatabase>> | undefined;

beforeAll(async () => { database = await resetAndMigrateTestDatabase(); });
beforeEach(async () => { await database?.pool.query('TRUNCATE TABLE users CASCADE'); });
afterAll(async () => { await database?.pool.end(); });

const turnpoints = [
  { latitude: 40.012345, longitude: -105.123456 },
  { latitude: 40.112345, longitude: -105.223456 },
  { latitude: 40.212345, longitude: -105.323456 },
];

const generatedRoute = {
  route: [
    turnpoints[0],
    { latitude: 40.061111, longitude: -105.171111 },
    turnpoints[1],
    { latitude: 40.161111, longitude: -105.271111 },
    turnpoints[2],
  ],
  legs: [
    { directDistanceMeters: 14_000.125, maximumDistanceMeters: 17_500.25, routeDistanceMeters: 14_750.5 },
    { directDistanceMeters: 14_100.375, maximumDistanceMeters: 17_625.5, routeDistanceMeters: 14_900.75 },
  ],
  directDistanceMeters: 28_100.5,
  maximumRouteDistanceMeters: 35_125.75,
  routeDistanceMeters: 29_651.25,
  actualExtraDistanceMeters: 1_550.75,
  actualDeviationPercent: 5.518584,
  thermalCoverage: 'available' as const,
};

async function createPilots() {
  if (!database) throw new Error('Test database was not initialized.');
  const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
  const owner = await auth.signup({ email: 'plan-owner@example.com', password: 'correct horse battery staple', displayName: 'Plan Owner' });
  const other = await auth.signup({ email: 'plan-other@example.com', password: 'correct horse battery staple', displayName: 'Other Pilot' });
  return { owner: owner.user.userId, other: other.user.userId };
}

describe('savedPlanService', () => {
  it('creates and reopens an exact private route snapshot', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner } = await createPilots();
    const service = createSavedPlanService(database.db);

    const created = await service.create({
      ownerUserId: owner,
      name: '  Boulder triangle  ',
      turnpoints,
      generatedRoute: {
        ...generatedRoute,
        claims: { direct: [{ x: 1, y: 2 }] },
        transientClientField: 'must-not-be-persisted',
      },
      routingPriority: 'thermal',
    });

    expect(created).toMatchObject({
      ownerUserId: owner,
      name: 'Boulder triangle',
      turnpoints,
      generatedRoute,
      routingPriority: 'thermal',
      visibility: 'private',
      sharedGroupId: null,
      isOwner: true,
    });
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created.updatedAt).toBe(created.createdAt);
    expect(created.generatedRoute).not.toHaveProperty('claims');
    expect(created.generatedRoute).not.toHaveProperty('transientClientField');

    await expect(service.get({ planId: created.planId, ownerUserId: owner })).resolves.toEqual(created);
    const stored = await database.pool.query<{ visibility: string; sharedGroupId: string | null; route: typeof generatedRoute }>(
      'SELECT visibility, shared_group_id AS "sharedGroupId", generated_route AS route FROM plans WHERE plan_id = $1',
      [created.planId],
    );
    expect(stored.rows).toEqual([{ visibility: 'private', sharedGroupId: null, route: generatedRoute }]);
  });

  it('allows duplicate names, lists only the owner, and orders most recently updated first', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner, other } = await createPilots();
    const service = createSavedPlanService(database.db);
    const first = await service.create({ ownerUserId: owner, name: 'Same name', turnpoints, generatedRoute, routingPriority: 'balanced' });
    const second = await service.create({ ownerUserId: owner, name: 'Same name', turnpoints, generatedRoute, routingPriority: 'balanced' });
    await service.create({ ownerUserId: other, name: 'Other plan', turnpoints, generatedRoute, routingPriority: 'balanced' });
    await database.db.execute(sql`UPDATE plans SET updated_at = '2026-08-15T00:00:00Z' WHERE plan_id = ${first.planId}`);
    await database.db.execute(sql`UPDATE plans SET updated_at = '2026-08-16T00:00:00Z' WHERE plan_id = ${second.planId}`);

    expect(await service.list(owner)).toEqual([
      { planId: second.planId, name: 'Same name', updatedAt: '2026-08-16T00:00:00.000Z' },
      { planId: first.planId, name: 'Same name', updatedAt: '2026-08-15T00:00:00.000Z' },
    ]);
  });

  it('updates the owned snapshot and advances its timestamp', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner } = await createPilots();
    const service = createSavedPlanService(database.db);
    const created = await service.create({ ownerUserId: owner, name: 'Original', turnpoints, generatedRoute, routingPriority: 'balanced' });
    await database.db.execute(sql`UPDATE plans SET updated_at = '2020-01-01T00:00:00Z' WHERE plan_id = ${created.planId}`);
    const updatedRoute = { ...generatedRoute, thermalCoverage: 'unavailable' as const };

    const updated = await service.update({
      planId: created.planId,
      ownerUserId: owner,
      name: ' Updated ',
      turnpoints,
      generatedRoute: updatedRoute,
      routingPriority: 'shorter',
    });

    expect(updated).toMatchObject({
      planId: created.planId,
      name: 'Updated',
      generatedRoute: updatedRoute,
      routingPriority: 'shorter',
      visibility: 'private',
      sharedGroupId: null,
      isOwner: true,
    });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
  });

  it('authorizes viewer reads for owners, link sharing, and accepted Group membership', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const auth = createAuthService(database.db, { sessionTtlSeconds: 604800 });
    const owner = await auth.signup({ email: 'sharing-owner@example.com', password: 'correct horse battery staple', displayName: 'Sharing Owner' });
    const member = await auth.signup({ email: 'sharing-member@example.com', password: 'correct horse battery staple', displayName: 'Sharing Member' });
    const pending = await auth.signup({ email: 'sharing-pending@example.com', password: 'correct horse battery staple', displayName: 'Sharing Pending' });
    const unrelated = await auth.signup({ email: 'sharing-unrelated@example.com', password: 'correct horse battery staple', displayName: 'Sharing Unrelated' });
    const ownerUserId = owner.user.userId;
    const groupService = createGroupService(database.db);
    const group = await groupService.createGroup({ ownerUserId, name: 'Plan Sharers' });
    await groupService.invite({ groupId: group.groupId, actorUserId: ownerUserId, userId: member.user.userId });
    await groupService.acceptInvitation({ groupId: group.groupId, userId: member.user.userId });
    await groupService.invite({ groupId: group.groupId, actorUserId: ownerUserId, userId: pending.user.userId });
    const service = createSavedPlanService(database.db);
    const plan = await service.create({ ownerUserId, name: 'Shared route', turnpoints, generatedRoute, routingPriority: 'balanced' });

    await expect(service.getForViewer({ planId: plan.planId, viewerUserId: ownerUserId })).resolves.toMatchObject({
      visibility: 'private',
      isOwner: true,
    });
    for (const viewerUserId of [null, member.user.userId, pending.user.userId, unrelated.user.userId]) {
      await expect(service.getForViewer({ planId: plan.planId, viewerUserId })).rejects.toMatchObject({ code: 'not_found' });
    }

    const linked = await service.updateVisibility({
      planId: plan.planId,
      ownerUserId,
      visibility: 'link',
      sharedGroupId: group.groupId,
    });
    expect(linked).toMatchObject({ visibility: 'link', sharedGroupId: null, isOwner: true });
    await expect(service.getForViewer({ planId: plan.planId, viewerUserId: null })).resolves.toMatchObject({ isOwner: false });
    await expect(service.getForViewer({ planId: plan.planId, viewerUserId: unrelated.user.userId })).resolves.toMatchObject({ isOwner: false });
    await expect(service.list(unrelated.user.userId)).resolves.toEqual([]);
    await expect(service.update({
      planId: plan.planId,
      ownerUserId: unrelated.user.userId,
      name: 'Stolen link Plan',
      turnpoints,
      generatedRoute,
      routingPriority: 'balanced',
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.delete({ planId: plan.planId, ownerUserId: unrelated.user.userId })).rejects.toMatchObject({ code: 'not_found' });

    const groupShared = await service.updateVisibility({
      planId: plan.planId,
      ownerUserId,
      visibility: 'group',
      sharedGroupId: group.groupId,
    });
    expect(groupShared).toMatchObject({ visibility: 'group', sharedGroupId: group.groupId, isOwner: true });
    await expect(service.getForViewer({ planId: plan.planId, viewerUserId: member.user.userId })).resolves.toMatchObject({ isOwner: false });
    for (const viewerUserId of [null, pending.user.userId, unrelated.user.userId]) {
      await expect(service.getForViewer({ planId: plan.planId, viewerUserId })).rejects.toMatchObject({ code: 'not_found' });
    }

    await groupService.removeMember({ groupId: group.groupId, actorUserId: ownerUserId, userId: member.user.userId });
    await expect(service.getForViewer({ planId: plan.planId, viewerUserId: member.user.userId })).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.getForViewer({ planId: plan.planId, viewerUserId: ownerUserId })).resolves.toMatchObject({ isOwner: true });
    for (const unavailablePlanId of ['00000000-0000-4000-8000-000000000001', 'not-a-uuid']) {
      await expect(service.getForViewer({ planId: unavailablePlanId, viewerUserId: ownerUserId })).rejects.toMatchObject({
        code: 'not_found',
        message: 'Plan not found or unavailable.',
      });
    }
  });

  it('keeps visibility owner-only, validates accepted Group selection, and preserves sharing during content updates', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner, other } = await createPilots();
    const groupService = createGroupService(database.db);
    const ownedGroup = await groupService.createGroup({ ownerUserId: owner, name: 'Owned Group' });
    const unavailableGroup = await groupService.createGroup({ ownerUserId: other, name: 'Unavailable Group' });
    await groupService.invite({ groupId: unavailableGroup.groupId, actorUserId: other, userId: owner });
    const service = createSavedPlanService(database.db);
    const plan = await service.create({ ownerUserId: owner, name: 'Original', turnpoints, generatedRoute, routingPriority: 'balanced' });

    await expect(service.updateVisibility({
      planId: plan.planId,
      ownerUserId: other,
      visibility: 'link',
      sharedGroupId: null,
    })).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.updateVisibility({
      planId: plan.planId,
      ownerUserId: owner,
      visibility: 'group',
      sharedGroupId: null,
    })).rejects.toMatchObject({ code: 'validation' });
    await expect(service.updateVisibility({
      planId: plan.planId,
      ownerUserId: owner,
      visibility: 'group',
      sharedGroupId: unavailableGroup.groupId,
    })).rejects.toMatchObject({ code: 'validation' });

    await service.updateVisibility({
      planId: plan.planId,
      ownerUserId: owner,
      visibility: 'group',
      sharedGroupId: ownedGroup.groupId,
    });
    const updated = await service.update({
      planId: plan.planId,
      ownerUserId: owner,
      name: 'Updated content',
      turnpoints,
      generatedRoute,
      routingPriority: 'thermal',
    });
    expect(updated).toMatchObject({
      name: 'Updated content',
      visibility: 'group',
      sharedGroupId: ownedGroup.groupId,
      isOwner: true,
    });

    const madePrivate = await service.updateVisibility({
      planId: plan.planId,
      ownerUserId: owner,
      visibility: 'private',
      sharedGroupId: ownedGroup.groupId,
    });
    expect(madePrivate).toMatchObject({ visibility: 'private', sharedGroupId: null });
  });

  it('makes missing and non-owned reads, updates, and deletes indistinguishable', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner, other } = await createPilots();
    const service = createSavedPlanService(database.db);
    const created = await service.create({ ownerUserId: owner, name: 'Private', turnpoints, generatedRoute, routingPriority: 'balanced' });
    const missingId = '00000000-0000-4000-8000-000000000001';

    for (const planId of [created.planId, missingId, 'not-a-uuid']) {
      const ownerUserId = planId === created.planId ? other : owner;
      await expect(service.get({ planId, ownerUserId })).rejects.toEqual(
        expect.objectContaining({ name: 'SavedPlanError', code: 'not_found', message: 'Plan not found or unavailable.' }),
      );
      await expect(service.delete({ planId, ownerUserId })).rejects.toEqual(
        expect.objectContaining({ name: 'SavedPlanError', code: 'not_found', message: 'Plan not found or unavailable.' }),
      );
    }
    await expect(service.update({
      planId: created.planId,
      ownerUserId: other,
      name: 'Stolen',
      turnpoints,
      generatedRoute,
      routingPriority: 'balanced',
    })).rejects.toEqual(expect.objectContaining({ code: 'not_found', message: 'Plan not found or unavailable.' }));
    await expect(service.get({ planId: created.planId, ownerUserId: owner })).resolves.toMatchObject({ name: 'Private' });
  });

  it('validates names, turnpoints, generated route structure, metrics, and priority', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner } = await createPilots();
    const service = createSavedPlanService(database.db);
    const base = { ownerUserId: owner, name: 'Valid', turnpoints, generatedRoute, routingPriority: 'balanced' };
    const invalidInputs = [
      { ...base, name: '   ' },
      { ...base, name: 'x'.repeat(81) },
      { ...base, turnpoints: [turnpoints[0]] },
      { ...base, turnpoints: [{ latitude: 91, longitude: 0 }, turnpoints[1]] },
      { ...base, turnpoints: [turnpoints[0], turnpoints[0]] },
      { ...base, turnpoints: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 20 }] },
      { ...base, turnpoints: [0, 8, 16, 24, 32, 40, 48].map((longitude) => ({ latitude: 0, longitude })) },
      { ...base, generatedRoute: { ...generatedRoute, route: [turnpoints[0]] } },
      { ...base, generatedRoute: { ...generatedRoute, legs: [] } },
      { ...base, generatedRoute: { ...generatedRoute, routeDistanceMeters: -1 } },
      { ...base, generatedRoute: { ...generatedRoute, thermalCoverage: 'forecast' } },
      { ...base, routingPriority: 'fastest' },
    ];

    for (const input of invalidInputs) {
      await expect(service.create(input)).rejects.toBeInstanceOf(SavedPlanError);
      await expect(service.create(input)).rejects.toMatchObject({ code: 'validation' });
    }
    expect(await service.list(owner)).toEqual([]);
  });

  it('deletes owned plans and cascades them when their owner is deleted', async () => {
    if (!database) throw new Error('Test database was not initialized.');
    const { owner } = await createPilots();
    const service = createSavedPlanService(database.db);
    const first = await service.create({ ownerUserId: owner, name: 'Delete me', turnpoints, generatedRoute, routingPriority: 'balanced' });
    await expect(service.delete({ planId: first.planId, ownerUserId: owner })).resolves.toBeUndefined();
    await expect(service.get({ planId: first.planId, ownerUserId: owner })).rejects.toMatchObject({ code: 'not_found' });

    await service.create({ ownerUserId: owner, name: 'Cascade me', turnpoints, generatedRoute, routingPriority: 'balanced' });
    await database.pool.query('DELETE FROM users WHERE user_id = $1', [owner]);
    const count = await database.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM plans');
    expect(count.rows).toEqual([{ count: 0 }]);
  });
});
