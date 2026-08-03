import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  bulkImports,
  flights,
  pilotFollows,
  pilotGroupMemberships,
  profiles,
  regularUploadMembers,
  userOnboardingState,
} from '../db/schema.js';

type OnboardingTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type OnboardingStepKey = 'profile' | 'first-flight' | 'personal-map' | 'follow-pilots' | 'competitive-map' | 'groups' | 'glider' | 'history';

export type OnboardingState = {
  dismissed: boolean;
  completeCount: number;
  totalCount: number;
  coreComplete: boolean;
  allComplete: boolean;
  shouldPoll: boolean;
  firstFlightId: string | null;
  firstFlightStatus: 'not-started' | 'processing' | 'failed' | 'completed';
  historyStatus: 'not-started' | 'preparing' | 'processing' | 'replaying' | 'failed' | 'completed';
  steps: Partial<Record<OnboardingStepKey, boolean>>;
};

export interface OnboardingService {
  initializeInTransaction(transaction: OnboardingTransaction, userId: string): Promise<void>;
  getState(userId: string): Promise<OnboardingState | null>;
  dismiss(userId: string): Promise<boolean>;
  restore(userId: string): Promise<boolean>;
  markPersonalMapViewed(userId: string): Promise<boolean>;
  markCompetitiveMapViewed(userId: string): Promise<boolean>;
  markGroupsJoined?(userId: string): Promise<boolean>;
}

export function createOnboardingService(database: Database): OnboardingService {
  async function updateTimestamp(userId: string, values: Partial<typeof userOnboardingState.$inferInsert>) {
    await database.update(userOnboardingState).set({ ...values, updatedAt: new Date() }).where(eq(userOnboardingState.userId, userId));
  }

  return {
    async initializeInTransaction(transaction, userId) {
      await transaction.insert(userOnboardingState).values({ userId }).onConflictDoNothing();
    },

    async getState(userId) {
      const [stored] = await database.select().from(userOnboardingState).where(eq(userOnboardingState.userId, userId)).limit(1);
      if (!stored) return null;

      const [[firstFlight], [profile], [followCount], [groupMembership], [completedHistory], [activeHistory], [activeRegular], [failedRegular]] = await Promise.all([
        database.select({ id: flights.id, processedAt: flights.processedAt })
          .from(regularUploadMembers)
          .innerJoin(flights, eq(regularUploadMembers.flightId, flights.id))
          .where(and(
            eq(regularUploadMembers.userId, userId),
            eq(regularUploadMembers.status, 'completed'),
            eq(flights.processingStatus, 'completed'),
          ))
          .orderBy(asc(regularUploadMembers.startedAt), asc(regularUploadMembers.flightId))
          .limit(1),
        database.select({ gliderModelId: profiles.gliderModelId }).from(profiles).where(eq(profiles.userId, userId)).limit(1),
        database.select({ value: count() }).from(pilotFollows).where(eq(pilotFollows.followerUserId, userId)),
        database.select({ groupId: pilotGroupMemberships.groupId }).from(pilotGroupMemberships)
          .where(and(eq(pilotGroupMemberships.userId, userId), eq(pilotGroupMemberships.status, 'accepted')))
          .limit(1),
        database.select({ id: bulkImports.id }).from(bulkImports)
          .where(and(eq(bulkImports.userId, userId), eq(bulkImports.phase, 'completed')))
          .limit(1),
        database.select({ phase: bulkImports.phase }).from(bulkImports)
          .where(and(eq(bulkImports.userId, userId), inArray(bulkImports.phase, ['preparing', 'processing', 'replaying', 'failed'])))
          .orderBy(sql`${bulkImports.updatedAt} DESC`)
          .limit(1),
        database.select({ id: regularUploadMembers.id }).from(regularUploadMembers)
          .where(and(eq(regularUploadMembers.userId, userId), inArray(regularUploadMembers.status, ['pending', 'processing'])))
          .limit(1),
        database.select({ id: regularUploadMembers.id }).from(regularUploadMembers)
          .where(and(eq(regularUploadMembers.userId, userId), eq(regularUploadMembers.status, 'failed')))
          .orderBy(sql`${regularUploadMembers.updatedAt} DESC`)
          .limit(1),
      ]);

      const now = new Date();
      const reconciled = {
        firstFlightId: stored.firstFlightId ?? firstFlight?.id ?? null,
        firstFlightCompletedAt: stored.firstFlightCompletedAt ?? firstFlight?.processedAt ?? null,
        followedThreePilotsAt: stored.followedThreePilotsAt ?? (Number(followCount?.value ?? 0) >= 3 ? now : null),
        gliderAddedAt: stored.gliderAddedAt ?? (profile?.gliderModelId ? now : null),
        historyImportCompletedAt: stored.historyImportCompletedAt ?? (completedHistory ? now : null),
        groupsAt: stored.groupsAt ?? (groupMembership ? now : (stored.completedAt ? now : null)),
      };
      const steps = {
        profile: true,
        'first-flight': Boolean(reconciled.firstFlightCompletedAt),
        'personal-map': Boolean(stored.personalMapViewedAt),
        'follow-pilots': Boolean(reconciled.followedThreePilotsAt),
        'competitive-map': Boolean(stored.competitiveMapViewedAt),
        groups: Boolean(reconciled.groupsAt),
        glider: Boolean(reconciled.gliderAddedAt),
        history: Boolean(reconciled.historyImportCompletedAt),
      } satisfies Record<OnboardingStepKey, boolean>;
      const completeCount = Object.values(steps).filter(Boolean).length;
      const allComplete = completeCount === 8;
      const completedAt = stored.completedAt ?? (allComplete ? now : null);

      if (
        reconciled.firstFlightId !== stored.firstFlightId
        || reconciled.firstFlightCompletedAt !== stored.firstFlightCompletedAt
        || reconciled.followedThreePilotsAt !== stored.followedThreePilotsAt
        || reconciled.gliderAddedAt !== stored.gliderAddedAt
        || reconciled.historyImportCompletedAt !== stored.historyImportCompletedAt
        || reconciled.groupsAt !== stored.groupsAt
        || completedAt !== stored.completedAt
      ) {
        await updateTimestamp(userId, { ...reconciled, completedAt });
      }

      const firstFlightStatus = steps['first-flight']
        ? 'completed'
        : activeRegular
          ? 'processing'
          : failedRegular
            ? 'failed'
            : 'not-started';
      const historyStatus: OnboardingState['historyStatus'] = steps.history
        ? 'completed'
        : activeHistory?.phase === 'preparing'
          || activeHistory?.phase === 'processing'
          || activeHistory?.phase === 'replaying'
          || activeHistory?.phase === 'failed'
          ? activeHistory.phase
          : 'not-started';

      return {
        dismissed: Boolean(stored.dismissedAt),
        completeCount,
        totalCount: 8,
        coreComplete: steps.profile && steps['first-flight'] && steps['personal-map'],
        allComplete,
        shouldPoll: firstFlightStatus === 'processing' || ['preparing', 'processing', 'replaying'].includes(historyStatus),
        firstFlightId: reconciled.firstFlightId,
        firstFlightStatus,
        historyStatus,
        steps,
      };
    },

    async dismiss(userId) {
      const rows = await database.update(userOnboardingState)
        .set({ dismissedAt: new Date(), updatedAt: new Date() })
        .where(eq(userOnboardingState.userId, userId))
        .returning({ userId: userOnboardingState.userId });
      return rows.length > 0;
    },

    async restore(userId) {
      const rows = await database.update(userOnboardingState)
        .set({ dismissedAt: null, updatedAt: new Date() })
        .where(eq(userOnboardingState.userId, userId))
        .returning({ userId: userOnboardingState.userId });
      return rows.length > 0;
    },

    async markPersonalMapViewed(userId) {
      const rows = await database.update(userOnboardingState)
        .set({ personalMapViewedAt: sql`COALESCE(${userOnboardingState.personalMapViewedAt}, now())`, updatedAt: new Date() })
        .where(eq(userOnboardingState.userId, userId))
        .returning({ userId: userOnboardingState.userId });
      return rows.length > 0;
    },

    async markCompetitiveMapViewed(userId) {
      const rows = await database.update(userOnboardingState)
        .set({ competitiveMapViewedAt: sql`COALESCE(${userOnboardingState.competitiveMapViewedAt}, now())`, updatedAt: new Date() })
        .where(eq(userOnboardingState.userId, userId))
        .returning({ userId: userOnboardingState.userId });
      return rows.length > 0;
    },

    async markGroupsJoined(userId) {
      const rows = await database.update(userOnboardingState)
        .set({ groupsAt: sql`COALESCE(${userOnboardingState.groupsAt}, now())`, updatedAt: new Date() })
        .where(eq(userOnboardingState.userId, userId))
        .returning({ userId: userOnboardingState.userId });
      return rows.length > 0;
    },
  };
}
