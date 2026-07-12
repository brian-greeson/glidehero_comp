import { appSessions, profiles, userPasswords, users } from './schema.js';

export type UserRow = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type UserPasswordRow = typeof userPasswords.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type SessionRow = typeof appSessions.$inferSelect;
