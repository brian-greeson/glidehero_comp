import { appSessions, flightAreas, flights, igcFiles, profiles, trackPoints, userPasswords, users } from './schema.js';

export type UserRow = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserPasswordRow = typeof userPasswords.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type SessionRow = typeof appSessions.$inferSelect;
export type IgcFileRow = typeof igcFiles.$inferSelect;
export type FlightRow = typeof flights.$inferSelect;
export type TrackPointRow = typeof trackPoints.$inferSelect;
export type FlightAreaRow = typeof flightAreas.$inferSelect;
export type FlightProcessingStatus = FlightRow['processingStatus'];
