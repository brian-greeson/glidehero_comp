import { appSessions, competitionGridClaims, flights, igcFiles, profiles, trackPoints, userGridClaims, userPasswords, users } from './schema.js';

export type UserRow = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserPasswordRow = typeof userPasswords.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type SessionRow = typeof appSessions.$inferSelect;
export type IgcFileRow = typeof igcFiles.$inferSelect;
export type FlightRow = typeof flights.$inferSelect;
export type TrackPointRow = typeof trackPoints.$inferSelect;
export type GridClaimRow = typeof userGridClaims.$inferSelect;
export type CompetitionGridClaimRow = typeof competitionGridClaims.$inferSelect;
export type FlightProcessingStatus = FlightRow['processingStatus'];
