import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
const singleMemberTeamUUID = '0460e2fd-4de5-4362-a6d4-5430fcf480f1';
const metaData = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
};

export const users = pgTable('users', {
  id: uuid('user_id').primaryKey().defaultRandom(),
  appleSubject: text('apple_subject').unique(),
  email: text('email'),
  lastLogin: timestamp('last_login', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  ...metaData,
});

export const userPasswords = pgTable(
  'user_passwords',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    password: text('password'),
    ...metaData,
  },
  (table) => [index('passwords_user_id_idx').on(table.userId)],
);

export const appSessions = pgTable(
  'app_sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('app_sessions_user_id_idx').on(table.userId)],
);

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'no action' })
      .unique(),
    displayName: text('display_name').notNull(),
    handedness: text('handedness'),
    avatarUrl: text('avatar_url'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'no action',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    ...metaData,
  },
  (table) => [
    index('profiles_user_id_idx').on(table.userId),
    index('profiles_created_by_user_id_idx').on(table.createdByUserId),
  ],
);

export const profileFollows = pgTable(
  'profile_follows',
  {
    sourceProfileId: uuid('source_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'no action' }),
    followedProfileId: uuid('followed_profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'no action' }),
    ...metaData,
  },
  (table) => [
    primaryKey({ columns: [table.sourceProfileId, table.followedProfileId] }),
    index('profile_follows_source_profile_id_idx').on(table.sourceProfileId),
    index('profile_follows_followed_profile_id_idx').on(table.followedProfileId),
  ],
);
