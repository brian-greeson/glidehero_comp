import { and, desc, eq, exists, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  pilotGroupMemberships,
  plans,
  type PlanTurnpoint,
  type StoredPlanRoute,
} from '../db/schema.js';
import type { RoutingPriority } from '../domain/thermal/thermalRoute.js';
import { validatePlanTurnpoints } from '../domain/plan/planRouteValidation.js';

export type SavedPlan = {
  planId: string;
  ownerUserId: string;
  name: string;
  turnpoints: PlanTurnpoint[];
  generatedRoute: StoredPlanRoute;
  routingPriority: RoutingPriority;
  visibility: 'private' | 'link' | 'group';
  sharedGroupId: string | null;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SavedPlanListItem = Pick<SavedPlan, 'planId' | 'name' | 'updatedAt'>;

export type SavedPlanWriteInput = {
  name: string;
  turnpoints: unknown;
  generatedRoute: unknown;
  routingPriority: unknown;
};

export type SavedPlanVisibility = SavedPlan['visibility'];

export interface SavedPlanService {
  create(input: SavedPlanWriteInput & { ownerUserId: string }): Promise<SavedPlan>;
  list(ownerUserId: string): Promise<SavedPlanListItem[]>;
  get(input: { planId: string; ownerUserId: string }): Promise<SavedPlan>;
  getForViewer(input: { planId: string; viewerUserId: string | null }): Promise<SavedPlan>;
  update(input: SavedPlanWriteInput & { planId: string; ownerUserId: string }): Promise<SavedPlan>;
  updateVisibility(input: {
    planId: string;
    ownerUserId: string;
    visibility: SavedPlanVisibility;
    sharedGroupId: string | null;
  }): Promise<SavedPlan>;
  delete(input: { planId: string; ownerUserId: string }): Promise<void>;
}

export class SavedPlanError extends Error {
  constructor(public readonly code: 'not_found' | 'validation', message: string) {
    super(message);
    this.name = 'SavedPlanError';
  }
}

const routingPriorities = new Set<RoutingPriority>(['shorter', 'balanced', 'thermal']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validation(message: string): never {
  throw new SavedPlanError('validation', message);
}

function notFound(): never {
  throw new SavedPlanError('not_found', 'Plan not found or unavailable.');
}

function cleanName(name: string): string {
  if (typeof name !== 'string') validation('Plan name must be between 1 and 80 characters.');
  const value = name.trim();
  if (!value || value.length > 80) validation('Plan name must be between 1 and 80 characters.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function point(value: unknown): PlanTurnpoint {
  if (!isRecord(value)) validation('Plan point is invalid.');
  const latitude = value.latitude;
  const longitude = value.longitude;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -85 || latitude > 85) {
    validation('Plan latitude is invalid.');
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    validation('Plan longitude is invalid.');
  }
  return { latitude, longitude };
}

function pointArray(value: unknown, label: string, minimum: number, maximum?: number): PlanTurnpoint[] {
  if (!Array.isArray(value) || value.length < minimum || (maximum !== undefined && value.length > maximum)) {
    validation(`${label} is invalid.`);
  }
  return value.map(point);
}

function nonnegativeNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    validation('Generated route metrics are invalid.');
  }
  return value;
}

function cleanGeneratedRoute(value: unknown, turnpoints: readonly PlanTurnpoint[]): StoredPlanRoute {
  if (!isRecord(value)) validation('Generated route is invalid.');
  const route = pointArray(value.route, 'Generated route', 2);
  if (!Array.isArray(value.legs) || value.legs.length !== turnpoints.length - 1) {
    validation('Generated route legs are invalid.');
  }
  const legs = value.legs.map((leg) => {
    if (!isRecord(leg)) validation('Generated route legs are invalid.');
    return {
      directDistanceMeters: nonnegativeNumber(leg, 'directDistanceMeters'),
      maximumDistanceMeters: nonnegativeNumber(leg, 'maximumDistanceMeters'),
      routeDistanceMeters: nonnegativeNumber(leg, 'routeDistanceMeters'),
    };
  });
  if (value.thermalCoverage !== 'available' && value.thermalCoverage !== 'unavailable') {
    validation('Generated route thermal coverage is invalid.');
  }

  let routeIndex = 0;
  for (const turnpoint of turnpoints) {
    routeIndex = route.findIndex(
      (routePoint, index) => index >= routeIndex
        && routePoint.latitude === turnpoint.latitude
        && routePoint.longitude === turnpoint.longitude,
    );
    if (routeIndex < 0) validation('Generated route does not contain its ordered turnpoints.');
    routeIndex += 1;
  }

  return {
    route,
    legs,
    directDistanceMeters: nonnegativeNumber(value, 'directDistanceMeters'),
    maximumRouteDistanceMeters: nonnegativeNumber(value, 'maximumRouteDistanceMeters'),
    routeDistanceMeters: nonnegativeNumber(value, 'routeDistanceMeters'),
    actualExtraDistanceMeters: nonnegativeNumber(value, 'actualExtraDistanceMeters'),
    actualDeviationPercent: nonnegativeNumber(value, 'actualDeviationPercent'),
    thermalCoverage: value.thermalCoverage,
  };
}

function cleanRoutingPriority(value: unknown): RoutingPriority {
  if (typeof value !== 'string' || !routingPriorities.has(value as RoutingPriority)) {
    validation('Routing priority is invalid.');
  }
  return value as RoutingPriority;
}

function cleanWrite(input: SavedPlanWriteInput) {
  const turnpoints = pointArray(input.turnpoints, 'Plan turnpoints', 2, 24);
  try {
    validatePlanTurnpoints(turnpoints);
  } catch (error) {
    if (error instanceof RangeError) validation(error.message);
    throw error;
  }
  return {
    name: cleanName(input.name),
    turnpoints,
    generatedRoute: cleanGeneratedRoute(input.generatedRoute, turnpoints),
    routingPriority: cleanRoutingPriority(input.routingPriority),
  };
}

type StoredPlanRow = typeof plans.$inferSelect;

function dateIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Saved Plan has an invalid timestamp.');
  return date.toISOString();
}

function savedPlan(row: StoredPlanRow, viewerUserId: string | null = row.ownerUserId): SavedPlan {
  return {
    planId: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    turnpoints: row.turnpoints,
    generatedRoute: row.generatedRoute,
    routingPriority: row.routingPriority,
    visibility: row.visibility,
    sharedGroupId: row.sharedGroupId,
    isOwner: viewerUserId === row.ownerUserId,
    createdAt: dateIso(row.createdAt),
    updatedAt: dateIso(row.updatedAt),
  };
}

function validPlanId(planId: string): boolean {
  return typeof planId === 'string' && uuidPattern.test(planId);
}

export function createSavedPlanService(database: Database): SavedPlanService {
  return {
    async create(input) {
      const values = cleanWrite(input);
      const [created] = await database.insert(plans).values({
        ownerUserId: input.ownerUserId,
        ...values,
        visibility: 'private',
        sharedGroupId: null,
      }).returning();
      if (!created) throw new Error('Saved Plan creation returned no row.');
      return savedPlan(created);
    },

    async list(ownerUserId) {
      const rows = await database.select({
        planId: plans.id,
        name: plans.name,
        updatedAt: plans.updatedAt,
      }).from(plans)
        .where(eq(plans.ownerUserId, ownerUserId))
        .orderBy(desc(plans.updatedAt), desc(plans.id));
      return rows.map((row) => ({
        planId: row.planId,
        name: row.name,
        updatedAt: dateIso(row.updatedAt),
      }));
    },

    async get({ planId, ownerUserId }) {
      if (!validPlanId(planId)) notFound();
      const [row] = await database.select().from(plans).where(and(
        eq(plans.id, planId),
        eq(plans.ownerUserId, ownerUserId),
      )).limit(1);
      if (!row) notFound();
      return savedPlan(row);
    },

    async getForViewer({ planId, viewerUserId }) {
      if (!validPlanId(planId)) notFound();
      const access = viewerUserId === null
        ? eq(plans.visibility, 'link')
        : or(
            eq(plans.ownerUserId, viewerUserId),
            eq(plans.visibility, 'link'),
            and(
              eq(plans.visibility, 'group'),
              exists(
                database.select({ one: sql`1` })
                  .from(pilotGroupMemberships)
                  .where(and(
                    eq(pilotGroupMemberships.groupId, plans.sharedGroupId),
                    eq(pilotGroupMemberships.userId, viewerUserId),
                    eq(pilotGroupMemberships.status, 'accepted'),
                  )),
              ),
            ),
          );
      const [row] = await database.select().from(plans).where(and(
        eq(plans.id, planId),
        access,
      )).limit(1);
      if (!row) notFound();
      return savedPlan(row, viewerUserId);
    },

    async update(input) {
      if (!validPlanId(input.planId)) notFound();
      const values = cleanWrite(input);
      const [updated] = await database.update(plans).set({
        ...values,
        updatedAt: new Date(),
      }).where(and(
        eq(plans.id, input.planId),
        eq(plans.ownerUserId, input.ownerUserId),
      )).returning();
      if (!updated) notFound();
      return savedPlan(updated);
    },

    async updateVisibility(input) {
      if (!validPlanId(input.planId)) notFound();
      if (input.visibility !== 'private' && input.visibility !== 'link' && input.visibility !== 'group') {
        validation('Plan visibility is invalid.');
      }
      if (input.visibility === 'group') {
        if (input.sharedGroupId === null || !validPlanId(input.sharedGroupId)) {
          validation('A valid Group is required for Group sharing.');
        }
      }

      const [owned] = await database.select({ planId: plans.id }).from(plans).where(and(
        eq(plans.id, input.planId),
        eq(plans.ownerUserId, input.ownerUserId),
      )).limit(1);
      if (!owned) notFound();

      const sharedGroupId = input.visibility === 'group' ? input.sharedGroupId : null;
      if (sharedGroupId !== null) {
        const [membership] = await database.select({ groupId: pilotGroupMemberships.groupId })
          .from(pilotGroupMemberships)
          .where(and(
            eq(pilotGroupMemberships.groupId, sharedGroupId),
            eq(pilotGroupMemberships.userId, input.ownerUserId),
            eq(pilotGroupMemberships.status, 'accepted'),
          )).limit(1);
        if (!membership) validation('The selected Group is unavailable.');
      }

      const [updated] = await database.update(plans).set({
        visibility: input.visibility,
        sharedGroupId,
        updatedAt: new Date(),
      }).where(and(
        eq(plans.id, input.planId),
        eq(plans.ownerUserId, input.ownerUserId),
      )).returning();
      if (!updated) notFound();
      return savedPlan(updated);
    },

    async delete({ planId, ownerUserId }) {
      if (!validPlanId(planId)) notFound();
      const deleted = await database.delete(plans).where(and(
        eq(plans.id, planId),
        eq(plans.ownerUserId, ownerUserId),
      )).returning({ planId: plans.id });
      if (!deleted.length) notFound();
    },
  };
}
