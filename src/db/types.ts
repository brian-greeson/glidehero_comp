import {
  activityFeedItems,
  activityFeedItemSources,
  appSessions,
  facilities,
  facilityFollows,
  games,
  profileClaims,
  profileFollows,
  profiles,
  swings,
  teams,
  users,
} from './schema.js';

export type InsertUser = typeof users.$inferInsert;
export type UserRow = typeof users.$inferSelect;

export type InsertProfile = typeof profiles.$inferInsert;
export type ProfileRow = typeof profiles.$inferSelect;

export type InsertProfileClaim = typeof profileClaims.$inferInsert;
export type ProfileClaimRow = typeof profileClaims.$inferSelect;

export type InsertGame = typeof games.$inferInsert;
export type GameRow = typeof games.$inferSelect;

export type InsertActivityFeedItem = typeof activityFeedItems.$inferInsert;
export type ActivityFeedItemRow = typeof activityFeedItems.$inferSelect;

export type InsertActivityFeedItemSource = typeof activityFeedItemSources.$inferInsert;
export type ActivityFeedItemSourceRow = typeof activityFeedItemSources.$inferSelect;

export type InsertProfileFollow = typeof profileFollows.$inferInsert;
export type ProfileFollowRow = typeof profileFollows.$inferSelect;

export type InsertFacilityFollow = typeof facilityFollows.$inferInsert;
export type FacilityFollowRow = typeof facilityFollows.$inferSelect;

export type InsertFacility = typeof facilities.$inferInsert;
export type FacilityRow = typeof facilities.$inferSelect;

export type InsertTeam = typeof teams.$inferInsert;
export type TeamRow = typeof teams.$inferSelect;

export type InsertSwing = typeof swings.$inferInsert;
export type SwingRow = typeof swings.$inferSelect;
